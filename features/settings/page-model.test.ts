import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }))
const loaders = vi.hoisted(() => ({
  settingsReadModel: vi.fn(),
  brandTimezone: vi.fn()
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
  team: { members: 2, openInvites: 0, canManage: true },
  account: { name: 'Sam', email: 'owner@cedarlane.example' },
  history: [],
  brandKit: { available: false as const, reason: '' }
}
const zone = {
  saved: 'Asia/Kathmandu',
  source: 'klaviyo' as const,
  klaviyoTimezone: 'Europe/London',
  klaviyoDiffers: true,
  options: ['Asia/Kathmandu', 'Europe/London']
}

beforeEach(() => {
  vi.unstubAllEnvs()
  loaders.settingsReadModel.mockResolvedValue(read)
  loaders.brandTimezone.mockResolvedValue(zone)
})

describe('Settings page model (UI-SETa)', () => {
  it('gives the owner every part, with the store’s time and Klaviyo’s zone', () => {
    const view = settingsView({ context, now, read, zone, liveKeys: false })
    expect(view).toMatchObject({
      demo: false,
      owner: true,
      editor: true,
      offers: read.offers,
      klaviyo: read.klaviyo,
      team: read.team,
      account: read.account,
      unread: []
    })
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
        liveKeys: false
      }).timezone?.klaviyo
    ).toBeNull()
  })

  it('follows the actions’ roles: admins change offers, staff nothing', () => {
    const as = (tenantRole: 'admin' | 'staff') =>
      settingsView({
        context: { tenantRole },
        now,
        read,
        zone,
        liveKeys: false
      })
    expect(as('admin')).toMatchObject({ owner: false, editor: true })
    expect(as('staff')).toMatchObject({ owner: false, editor: false })
  })

  it('marks each part that could not be read, and the demo', () => {
    const view = settingsView({
      context,
      now,
      read: { ...read, klaviyo: null, account: null },
      zone: null,
      liveKeys: false
    })
    expect(view.unread).toEqual(['klaviyo', 'timezone', 'account'])
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
          account: null
        },
        zone,
        liveKeys: false
      })
    ).toMatchObject({
      demo: true,
      unread: ['offers', 'klaviyo', 'team', 'account']
    })
  })

  it('reads each part alone: one that fails hides only itself', async () => {
    loaders.brandTimezone.mockRejectedValue(new Error('down'))
    const noZone = await settingsPageModel(context, now)
    expect(noZone.unread).toEqual(['timezone'])
    expect(noZone.offers).toEqual(read.offers)
    expect(loaders.settingsReadModel).toHaveBeenCalledWith(context)

    loaders.brandTimezone.mockResolvedValue(zone)
    loaders.settingsReadModel.mockRejectedValue(new Error('down'))
    const noRead = await settingsPageModel(context, now)
    expect(noRead.unread).toEqual(['offers', 'klaviyo', 'team', 'account'])
    expect(noRead.timezone?.saved).toBe('Asia/Kathmandu')
  })

  it('says whether keys are checked with Klaviyo itself', async () => {
    expect((await settingsPageModel(context, now)).liveKeys).toBe(false)
    vi.stubEnv('KLAVIYO_MODE', 'live')
    expect((await settingsPageModel(context, now)).liveKeys).toBe(true)
  })
})
