import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const campaignWorkspace = vi.fn()
const klaviyoData = vi.fn()
const createClient = vi.fn()
vi.mock('@/features/campaigns/data', () => ({ campaignWorkspace }))
vi.mock('@/features/klaviyo-data/reader', () => ({ klaviyoData }))
vi.mock('@/lib/supabase/server', () => ({ createClient }))
const { klaviyoLine, plannerView } = await import('./load')

const context = {
  tenantId: 'tenant-a',
  timezone: 'America/New_York',
  tenantRole: 'owner'
}

/** A Supabase-like builder that records the holiday query. */
function holidayDb(result: { data: unknown; error: unknown }) {
  const calls: [string, ...unknown[]][] = []
  const builder: Record<string, unknown> = {}
  for (const name of ['from', 'select', 'eq', 'gte', 'lte', 'order'])
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args])
      return builder
    }
  builder.then = (resolve: (value: unknown) => unknown) => resolve(result)
  // The client itself must not be thenable, or `await createClient()`
  // would unwrap it.
  const db = { from: builder.from }
  return { db, calls }
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('AUTH_MODE', 'supabase')
  campaignWorkspace.mockReset().mockResolvedValue({
    context,
    data: { campaigns: [], products: [], offers: [], audiences: [] },
    error: null
  })
  klaviyoData.mockReset().mockResolvedValue({ state: 'unavailable' })
})

describe('planner loader', () => {
  it('says plainly where Klaviyo sends come from', () => {
    expect(
      klaviyoLine({
        state: 'sample',
        snapshot: {} as never,
        shopify: 'missing'
      })
    ).toBe('Klaviyo sends here are sample data, not from a real account.')
    expect(klaviyoLine({ state: 'not_connected', reason: 'expired' })).toMatch(
      /^Klaviyo is not connected, so only this workspace's campaigns/
    )
    expect(klaviyoLine({ state: 'unavailable' })).toMatch(
      /^Klaviyo sends aren't available yet/
    )
  })

  it("reads only this tenant's holidays for the visible weeks", async () => {
    const { db, calls } = holidayDb({
      data: [{ id: 'h1', name: 'Leap day sale', event_date: '2024-02-29' }],
      error: null
    })
    createClient.mockResolvedValue(db)
    const view = await plannerView({ m: '2024-02' })
    expect(calls).toEqual(
      expect.arrayContaining([
        ['from', 'holidays'],
        ['eq', 'tenant_id', 'tenant-a'],
        ['gte', 'event_date', '2024-01-28'],
        ['lte', 'event_date', '2024-03-02']
      ])
    )
    expect(
      view.month.days.find((d) => d.date === '2024-02-29')?.holidays
    ).toEqual([{ id: 'h1', name: 'Leap day sale', date: '2024-02-29' }])
    expect(view.holidaysFailed).toBe(false)
    expect(view.owner).toBe(true)
    expect(klaviyoData).toHaveBeenCalledWith(
      'tenant-a',
      'America/New_York',
      expect.any(Number)
    )
  })

  it('reports a holiday failure instead of hiding it', async () => {
    createClient.mockResolvedValue(
      holidayDb({ data: null, error: { message: 'boom' } }).db
    )
    const view = await plannerView({})
    expect(view.holidaysFailed).toBe(true)
    expect(view.month.days.every((d) => d.holidays.length === 0)).toBe(true)
  })

  it('still shows Klaviyo sends when workspace campaigns cannot load', async () => {
    campaignWorkspace.mockResolvedValue({
      context: { ...context, tenantRole: 'staff' },
      data: null,
      error: 'Workspace data is unavailable.'
    })
    klaviyoData.mockResolvedValue({
      state: 'sample',
      shopify: 'missing',
      snapshot: {
        campaigns: [
          {
            id: 'K1',
            name: 'Sample send',
            status: 'scheduled',
            // Now is always inside the month the planner opens on.
            sendTime: new Date().toISOString()
          }
        ]
      }
    })
    createClient.mockResolvedValue(null)
    const view = await plannerView({})
    expect(view.owner).toBe(false)
    expect(view.month.monthEntries.map((e) => e.source)).toEqual(['klaviyo'])
    expect(view.klaviyoLine).toContain('sample data')
    // The month is not "1 campaign": this workspace's own are missing.
    expect(view.campaignsFailed).toBe(true)
    expect(view.summary).toBe(
      'Your campaigns could not load, so this month is not complete.'
    )
  })

  it('counts the whole month, whatever the filters', async () => {
    campaignWorkspace.mockResolvedValue({
      context,
      data: { campaigns: [], products: [], offers: [], audiences: [] },
      error: null
    })
    klaviyoData.mockResolvedValue({
      state: 'sample',
      shopify: 'missing',
      snapshot: {
        campaigns: [
          {
            id: 'K1',
            name: 'Sample send',
            status: 'scheduled',
            sendTime: new Date().toISOString()
          },
          // A cancelled campaign without a time is not a draft to schedule.
          { id: 'K2', name: 'Old idea', status: 'cancelled', sendTime: null },
          { id: 'K3', name: 'Next idea', status: 'draft', sendTime: null }
        ]
      }
    })
    createClient.mockResolvedValue(null)
    const view = await plannerView({})
    expect(view.campaignsFailed).toBe(false)
    expect(view.summary).toBe('1 campaign (1 Klaviyo sample) · 1 scheduled')
    expect(view.unscheduled.map((c) => c.id)).toEqual(['K3'])
    const filtered = await plannerView({ status: 'sent' })
    expect(filtered.month.monthEntries).toEqual([])
    expect(filtered.summary).toBe('1 campaign (1 Klaviyo sample) · 1 scheduled')
  })
})
