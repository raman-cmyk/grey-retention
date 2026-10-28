import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ context: vi.fn(), client: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext: mocks.context
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
import { campaignDetail, campaignWorkspace } from './data'

type Request = {
  table: string
  filters: Record<string, unknown>
  orders: string[]
  from?: number
  to?: number
  single?: boolean
}
const requests: Request[] = []
let campaign: { id: string; tenant_id: string; copy_revision: number } | null
let failure: { code: string } | null
const context = {
  kind: 'client',
  tenantId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  tenantRole: 'owner',
  timezone: 'UTC'
}
class Query {
  request: Request
  constructor(table: string) {
    this.request = { table, filters: {}, orders: [] }
    requests.push(this.request)
  }
  select() {
    return this
  }
  eq(key: string, value: unknown) {
    this.request.filters[key] = value
    return this
  }
  order(key: string) {
    this.request.orders.push(key)
    return this
  }
  range(from: number, to: number) {
    this.request.from = from
    this.request.to = to
    return Promise.resolve({ data: [], error: null })
  }
  limit() {
    return Promise.resolve({ data: [], error: null })
  }
  maybeSingle() {
    this.request.single = true
    return Promise.resolve(
      this.request.table === 'campaigns'
        ? { data: campaign, error: failure }
        : { data: null, error: null }
    )
  }
}
beforeEach(() => {
  requests.length = 0
  campaign = null
  failure = null
  mocks.context.mockResolvedValue(context)
  mocks.client.mockResolvedValue({ from: (table: string) => new Query(table) })
})

it('finds a permitted campaign directly by ID even when it is absent from the workspace list', async () => {
  campaign = {
    id: crypto.randomUUID(),
    tenant_id: context.tenantId,
    copy_revision: 4
  }
  const result = await campaignDetail(campaign.id)
  expect(result.data?.campaigns).toEqual([])
  expect(result.campaign).toEqual(campaign)
  expect(
    requests.find((r) => r.table === 'campaigns' && r.single)?.filters
  ).toEqual({ tenant_id: context.tenantId, id: campaign.id })
  expect(requests.find((r) => r.table === 'campaign_content')?.filters).toEqual(
    { tenant_id: context.tenantId, campaign_id: campaign.id, revision: 4 }
  )
})

it('returns a missing campaign without reading its history when the scoped lookup denies it', async () => {
  const result = await campaignDetail(crypto.randomUUID())
  expect(result.campaign).toBeNull()
  expect(result.error).toBeNull()
  expect(requests.some((r) => r.table === 'campaign_content')).toBe(false)
})

it('surfaces a failed direct read separately from a missing record', async () => {
  failure = { code: '42501' }
  const result = await campaignDetail(crypto.randomUUID())
  expect(result.campaign).toBeNull()
  expect(result.error).toContain('Campaign data is unavailable')
})

it('scopes each workspace collection and gives every paged query a unique ordering', async () => {
  await campaignWorkspace()
  const pages = requests.filter((r) => r.from !== undefined)
  expect(pages).toHaveLength(4)
  for (const request of pages) {
    expect(request.filters.tenant_id).toBe(context.tenantId)
    expect(request.orders.at(-1)).toBe('id')
    expect([request.from, request.to]).toEqual([0, 499])
  }
})
