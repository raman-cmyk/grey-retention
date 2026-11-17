import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }))
const loaders = vi.hoisted(() => ({
  settingsReadModel: vi.fn(),
  brandTimezone: vi.fn(),
  feedbackPage: vi.fn()
}))
vi.mock('@/features/feedback/data', () => ({
  feedbackPage: loaders.feedbackPage,
  requestLimit: 200
}))
vi.mock('./read-model', () => ({
  settingsReadModel: loaders.settingsReadModel
}))
vi.mock('./timezone', () => ({ brandTimezone: loaders.brandTimezone }))

import { settingsPageModel, settingsView } from './page-model'

const context = {
  kind: 'client' as const,
  userId: 'p1',
  tenantId: '00000000-0000-4000-8000-000000000101',
  tenantRole: 'owner' as const,
  tenantName: 'Cedar Lane',
  tenantSlug: 'cedar-lane',
  timezone: 'Asia/Kathmandu'
}
const now = new Date('2026-11-16T12:00:00Z')
const read = {
  state: 'ready' as const,
  offers: {
    maxDiscountPercent: 20,
    grossMarginPercent: null,
    marginFloorPercent: null,
    revision: 3,
    codes: []
  },
  klaviyo: {
    status: 'connected' as const,
    mode: 'sample' as const,
    keyStatus: null,
    accountLabel: 'Cedar Lane (sample)',
    keyHint: 'pk_abcde••••••••1234',
    checkedAt: null,
    missingLater: []
  },
  team: {
    members: 2,
    openInvites: 0,
    canManage: true,
    roster: [],
    invites: [],
    now: 0
  },
  account: { name: 'Sam', email: 'owner@cedarlane.example' },
  changes: {
    items: [{ id: 'e1', text: 'Code WELCOME15 added', by: 'you', at: '' }],
    partial: false
  },
  brandKit: { available: false as const, reason: '' }
}
const zone = {
  saved: 'Asia/Kathmandu',
  source: 'klaviyo' as const,
  klaviyoTimezone: 'Europe/London',
  klaviyoDiffers: true,
  options: ['Asia/Kathmandu', 'Europe/London']
}

/** The support threads (UI-SETd), as `feedbackPage` reads them. */
const thread = {
  id: 't1',
  subject: 'Klaviyo drafts',
  category: null,
  status: 'open' as const,
  revision: 2,
  createdAt: '2026-11-16T10:00:00Z',
  by: 'You',
  details: 'Where do my drafts go?',
  replies: []
}
const support = {
  requests: Array.from({ length: 10 }, (_, i) => ({ ...thread, id: `t${i}` })),
  more: true,
  team: 'Grey Retention team',
  now: 0,
  state: 'ready' as const
}

beforeEach(() => {
  vi.unstubAllEnvs()
  loaders.settingsReadModel.mockResolvedValue(read)
  loaders.brandTimezone.mockResolvedValue(zone)
  loaders.feedbackPage.mockResolvedValue(support)
})

describe('Settings page model (UI-SETa)', () => {
  it('gives the owner every part, with the store’s time and Klaviyo’s zone', () => {
    const view = settingsView({
      context,
      now,
      read,
      zone,
      support,
      requests: support,
      liveKeys: false
    })
    expect(view).toMatchObject({
      demo: false,
      owner: true,
      editor: true,
      offers: read.offers,
      klaviyo: read.klaviyo,
      team: read.team,
      account: read.account,
      changes: read.changes,
      unread: []
    })
    // The threads as read, whether older ones exist, and the workspace for
    // a reply.
    expect(view.support?.threads).toHaveLength(10)
    expect(view.support?.more).toBe(true)
    expect(view.support).toMatchObject({
      team: 'Grey Retention team',
      tenantId: context.tenantId
    })
    // And the ten newest feature requests.
    expect(view.requests?.items).toHaveLength(10)
    expect(view.timezone).toEqual({
      saved: 'Asia/Kathmandu',
      label: 'Asia/Kathmandu (UTC+05:45)',
      source: 'klaviyo',
      at: '2026-11-16T12:00:00.000Z',
      localTime: 'Mon, Nov 16 2026 · 5:45 PM',
      klaviyo: { zone: 'Europe/London', label: 'Europe/London (UTC+00:00)' },
      options: zone.options
    })
    // The same zone in Klaviyo is not offered again.
    expect(
      settingsView({
        context,
        now,
        read,
        zone: { ...zone, klaviyoDiffers: false },
        support,
        requests: support,
        liveKeys: false
      }).timezone?.klaviyo
    ).toBeNull()
  })

  it('follows the actions’ roles: admins change offers, staff nothing', () => {
    const as = (tenantRole: 'admin' | 'staff') =>
      settingsView({
        context: { tenantRole, tenantId: context.tenantId },
        now,
        read,
        zone,
        support,
        requests: support,
        liveKeys: false
      })
    expect(as('admin')).toMatchObject({ owner: false, editor: true })
    expect(as('staff')).toMatchObject({ owner: false, editor: false })
    // Staff do not see the changes, so they are never missing for them.
    const staff = settingsView({
      context: { tenantRole: 'staff', tenantId: context.tenantId },
      now,
      read: { ...read, changes: null },
      zone,
      support,
      requests: support,
      liveKeys: false
    })
    expect(staff.unread).toEqual([])
  })

  it('marks each part that could not be read, and the demo', () => {
    const view = settingsView({
      context,
      now,
      read: { ...read, klaviyo: null, account: null },
      zone: null,
      support,
      requests: support,
      liveKeys: false
    })
    expect(view.unread).toEqual(['klaviyo', 'timezone', 'account'])
    // Support that could not be read (or the demo's) is missing too.
    for (const state of ['demo', 'load_failed'] as const)
      expect(
        settingsView({
          context,
          now,
          read,
          zone,
          support: { ...support, requests: [], state },
          requests: support,
          liveKeys: false
        }).unread
      ).toEqual(['support'])
    expect(
      settingsView({
        context,
        now,
        read,
        zone,
        support,
        requests: { ...support, requests: [], state: 'load_failed' },
        liveKeys: false
      }).unread
    ).toEqual(['requests'])
    expect(view.offers).toEqual(read.offers)
    expect(
      settingsView({
        context,
        now,
        read: {
          ...read,
          state: 'demo',
          offers: null,
          klaviyo: null,
          team: null,
          account: null,
          changes: null
        },
        zone,
        support,
        requests: support,
        liveKeys: false
      })
    ).toMatchObject({
      demo: true,
      unread: ['offers', 'klaviyo', 'team', 'account', 'changes']
    })
  })

  it('reads each part alone: one that fails hides only itself', async () => {
    loaders.brandTimezone.mockRejectedValue(new Error('down'))
    const noZone = await settingsPageModel(context, now)
    expect(noZone.unread).toEqual(['timezone'])
    expect(noZone.offers).toEqual(read.offers)
    expect(loaders.settingsReadModel).toHaveBeenCalledWith(context)
    // Ten threads by latest activity, read in the query; all with Show older.
    expect(loaders.feedbackPage).toHaveBeenCalledWith(context, now.getTime(), {
      kind: 'support',
      order: 'activity',
      limit: 10
    })
    loaders.feedbackPage.mockClear()
    await settingsPageModel(context, now, { allSupport: true })
    expect(loaders.feedbackPage).toHaveBeenCalledWith(context, now.getTime(), {
      kind: 'support',
      order: 'activity',
      limit: 200
    })
    expect(loaders.feedbackPage).toHaveBeenCalledWith(context, now.getTime())

    loaders.brandTimezone.mockResolvedValue(zone)
    loaders.settingsReadModel.mockRejectedValue(new Error('down'))
    const noRead = await settingsPageModel(context, now)
    expect(noRead.unread).toEqual([
      'offers',
      'klaviyo',
      'team',
      'account',
      'changes'
    ])
    expect(noRead.timezone?.saved).toBe('Asia/Kathmandu')
  })

  it('says whether keys are checked with Klaviyo itself', async () => {
    expect((await settingsPageModel(context, now)).liveKeys).toBe(false)
    vi.stubEnv('KLAVIYO_MODE', 'live')
    expect((await settingsPageModel(context, now)).liveKeys).toBe(true)
  })
})
