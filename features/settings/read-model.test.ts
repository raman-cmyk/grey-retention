import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }))
const env = vi.hoisted(() => ({ AUTH_MODE: 'supabase' }))
const loaders = vi.hoisted(() => ({
  offersPage: vi.fn(),
  profilePageData: vi.fn(),
  teamPage: vi.fn(),
  createClient: vi.fn()
}))
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env }))
vi.mock('@/features/offers/data', () => ({ offersPage: loaders.offersPage }))
vi.mock('@/features/profile/data', () => ({
  profilePageData: loaders.profilePageData
}))
vi.mock('@/features/team/data', () => ({ teamPage: loaders.teamPage }))
vi.mock('@/lib/supabase/server', () => ({ createClient: loaders.createClient }))

import { klaviyoState, settingsReadModel } from './read-model'

const tenant = '00000000-0000-4000-8000-000000000101'
const context = {
  kind: 'client' as const,
  userId: 'p1',
  tenantId: tenant,
  tenantRole: 'owner' as const,
  tenantName: 'Cedar',
  tenantSlug: 'cedar',
  timezone: 'America/Los_Angeles'
}
const now = Date.parse('2026-11-14T12:00:00Z')

/** A database answering each table from `rows`, recording every filter. */
function database(rows: Record<string, unknown>, failing: string[] = []) {
  const filters: [string, string, unknown][] = []
  const from = vi.fn((table: string) => {
    const answer = failing.includes(table)
      ? { data: null, error: { code: '42501' } }
      : { data: rows[table] ?? null, error: null }
    const chain = {
      select: () => chain,
      eq: (column: string, value: unknown) => (
        filters.push([table, column, value]),
        chain
      ),
      in: () => chain,
      order: () => chain,
      limit: async () => answer,
      maybeSingle: async () => answer
    }
    return chain
  })
  return { db: { from } as never, filters }
}

beforeEach(() => {
  env.AUTH_MODE = 'supabase'
  loaders.offersPage.mockResolvedValue({
    maxDiscountPercent: 20,
    revision: 3,
    codes: []
  })
  loaders.profilePageData.mockResolvedValue({
    name: 'Raman',
    email: 'owner@shop.example',
    jobTitle: '',
    phone: ''
  })
  loaders.teamPage.mockResolvedValue({
    state: 'ready',
    canManage: true,
    now,
    members: [
      {
        id: 'm1',
        profileId: 'p1',
        name: 'Raman',
        email: 'owner@shop.example',
        role: 'owner',
        status: 'active',
        updatedAt: '',
        isMe: true
      },
      {
        id: 'm2',
        profileId: 'p2',
        name: '',
        email: 'gone@shop.example',
        role: 'staff',
        status: 'inactive',
        updatedAt: '',
        isMe: false
      }
    ],
    invites: [
      {
        id: 'i1',
        email: 'new@shop.example',
        role: 'staff',
        expiresAt: '2026-11-20T00:00:00Z'
      },
      {
        id: 'i2',
        email: 'old@shop.example',
        role: 'staff',
        expiresAt: '2026-11-01T00:00:00Z'
      }
    ],
    events: []
  })
})

describe('the Klaviyo connection for Settings', () => {
  it('is "none" before anything is connected', async () => {
    const { db } = database({})
    expect(await klaviyoState(db, tenant)).toEqual({
      status: 'none',
      mode: 'sample',
      keyStatus: null,
      accountLabel: null,
      keyHint: null,
      checkedAt: null,
      missingLater: []
    })
  })

  it('shows a live key by its hint, when it was checked and what later steps lack', async () => {
    const { db, filters } = database({
      workspace_connections: {
        status: 'connected',
        mode: 'live',
        account_label: 'Cedar Lane',
        credential_hint: 'pk_abcde••••••••wxyz'
      },
      klaviyo_credentials: {
        key_hint: 'pk_abcde••••••••wxyz',
        status: 'active',
        checked_at: '2026-11-14T10:00:00Z',
        later_missing: ['templates:write']
      }
    })
    expect(await klaviyoState(db, tenant)).toEqual({
      status: 'connected',
      mode: 'live',
      keyStatus: 'active',
      accountLabel: 'Cedar Lane',
      keyHint: 'pk_abcde••••••••wxyz',
      checkedAt: '2026-11-14T10:00:00Z',
      missingLater: ['templates:write']
    })
    // Only this workspace's rows are asked for.
    expect(
      filters.filter(([, c]) => c === 'tenant_id').map(([, , v]) => v)
    ).toEqual([tenant, tenant])
  })

  it('treats a sample connection as sample data, and an unknown status as a problem', async () => {
    const { db } = database({
      workspace_connections: {
        status: 'odd',
        mode: 'fixture',
        account_label: 'Sample',
        credential_hint: 'pk_SAMPL••••••••ghij'
      }
    })
    expect(await klaviyoState(db, tenant)).toMatchObject({
      status: 'error',
      mode: 'sample',
      keyStatus: null,
      keyHint: 'pk_SAMPL••••••••ghij',
      checkedAt: null
    })
  })

  it('shows a key Klaviyo refused, by the stored key’s own hint', async () => {
    const { db } = database({
      workspace_connections: {
        status: 'expired',
        mode: 'live',
        account_label: 'Cedar Lane',
        credential_hint: 'pk_older••••••••0000'
      },
      klaviyo_credentials: {
        key_hint: 'pk_abcde••••••••wxyz',
        status: 'revoked',
        checked_at: '2026-11-14T10:00:00Z',
        later_missing: ['templates:write']
      }
    })
    expect(await klaviyoState(db, tenant)).toEqual({
      status: 'expired',
      mode: 'live',
      keyStatus: 'refused',
      accountLabel: 'Cedar Lane',
      keyHint: 'pk_abcde••••••••wxyz',
      checkedAt: '2026-11-14T10:00:00Z',
      missingLater: []
    })
  })

  it('is null when it cannot be read', async () => {
    const { db } = database({}, ['klaviyo_credentials'])
    expect(await klaviyoState(db, tenant)).toBeNull()
  })
})

describe('the Settings read model', () => {
  it('brings the parts together for the signed-in workspace', async () => {
    const { db, filters } = database({
      workspace_events: [
        {
          id: 'e1',
          kind: 'max_discount_changed',
          actor_id: 'p1',
          detail: { from: 15, to: 20 },
          created_at: '2026-11-14T09:00:00Z'
        }
      ]
    })
    loaders.createClient.mockResolvedValue(db)
    const model = await settingsReadModel(context)
    expect(model).toMatchObject({
      state: 'ready',
      offers: { maxDiscountPercent: 20 },
      klaviyo: { status: 'none' },
      // Active members and invites not expired; the lists for the card.
      team: {
        members: 1,
        openInvites: 1,
        canManage: true,
        roster: [
          { id: 'm1', role: 'owner' },
          { id: 'm2', status: 'inactive' }
        ],
        invites: [{ id: 'i1' }, { id: 'i2' }],
        now
      },
      account: { name: 'Raman', email: 'owner@shop.example' },
      history: [{ text: 'Max discount changed from 15% to 20%', by: 'you' }],
      brandKit: { available: false }
    })
    expect(loaders.offersPage).toHaveBeenCalledWith(context)
    expect(loaders.teamPage).toHaveBeenCalledWith(context, expect.any(Number), {
      events: false
    })
    // Every table read is for the signed-in workspace only.
    const tenants = filters.filter(([, c]) => c === 'tenant_id')
    expect(tenants.map(([t]) => t).sort()).toEqual([
      'klaviyo_credentials',
      'workspace_connections',
      'workspace_events'
    ])
    expect(new Set(tenants.map(([, , v]) => v))).toEqual(new Set([tenant]))
  })

  it('does not count or list invites for staff, who do not see them', async () => {
    const { db } = database({})
    loaders.createClient.mockResolvedValue(db)
    loaders.teamPage.mockResolvedValue({
      state: 'ready',
      canManage: false,
      now,
      members: [],
      invites: [],
      events: null
    })
    expect((await settingsReadModel(context)).team).toEqual({
      members: 0,
      openInvites: null,
      canManage: false,
      roster: [],
      invites: null,
      now
    })
    // A manager whose invites could not be read still gets the team.
    loaders.teamPage.mockResolvedValue({
      state: 'ready',
      canManage: true,
      now,
      members: [],
      invites: null,
      events: null
    })
    expect((await settingsReadModel(context)).team).toMatchObject({
      openInvites: null,
      canManage: true,
      invites: null
    })
  })

  it('keeps the rest when one part fails', async () => {
    const { db } = database({}, ['workspace_connections'])
    loaders.createClient.mockResolvedValue(db)
    loaders.offersPage.mockRejectedValue(new Error('down'))
    loaders.teamPage.mockResolvedValue({
      state: 'load_failed',
      canManage: false,
      members: [],
      invites: null,
      events: null,
      now
    })
    const model = await settingsReadModel(context)
    expect(model).toMatchObject({
      state: 'ready',
      offers: null,
      klaviyo: null,
      team: null,
      // The changes still show without the team.
      history: [],
      account: { name: 'Raman' }
    })
  })

  it('reads nothing in the demo', async () => {
    env.AUTH_MODE = 'demo'
    const model = await settingsReadModel(context)
    expect(model).toMatchObject({ state: 'demo', offers: null, account: null })
    expect(loaders.createClient).not.toHaveBeenCalled()
  })
})
