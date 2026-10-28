import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ context: vi.fn(), client: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext: mocks.context
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
import { referenceEmailDetail } from './data'

type Request = {
  table: string
  filters: Record<string, unknown>
  orders: string[]
  single?: boolean
}
const context = {
    kind: 'client',
    tenantId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    tenantRole: 'owner'
  },
  requests: Request[] = []
let captureId: string,
  emailId: string,
  subscriptionError: { code: string } | null,
  subscriptions: { capture_id: string }[]
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
  in(key: string, value: unknown) {
    this.request.filters[key] = value
    return this
  }
  order(key: string) {
    this.request.orders.push(key)
    return this
  }
  range() {
    return Promise.resolve({ data: subscriptions, error: subscriptionError })
  }
  maybeSingle() {
    this.request.single = true
    const ids = this.request.filters.capture_id as string[]
    return Promise.resolve({
      data: ids.includes(captureId)
        ? { id: emailId, capture_id: captureId }
        : null,
      error: null
    })
  }
}
beforeEach(() => {
  requests.length = 0
  captureId = crypto.randomUUID()
  emailId = crypto.randomUUID()
  subscriptions = [{ capture_id: captureId }]
  subscriptionError = null
  mocks.context.mockResolvedValue(context)
  mocks.client.mockResolvedValue({ from: (table: string) => new Query(table) })
})

it('reads an email directly by ID within the active tenant subscription set', async () => {
  const result = await referenceEmailDetail(emailId)
  expect(result.email?.id).toBe(emailId)
  expect(requests[0]?.filters).toEqual({
    tenant_id: context.tenantId,
    active: true
  })
  expect(requests[1]?.filters).toEqual({ id: emailId, capture_id: [captureId] })
  expect(requests[1]?.single).toBe(true)
})

it('cannot read an email subscribed through another tenant or an inactive source', async () => {
  subscriptions = [{ capture_id: crypto.randomUUID() }]
  expect((await referenceEmailDetail(emailId)).email).toBeNull()
  subscriptions = []
  requests.length = 0
  expect((await referenceEmailDetail(emailId)).email).toBeNull()
  expect(requests.some((r) => r.table === 'competitor_emails')).toBe(false)
})

it('stops and surfaces a subscription authorization error before looking up the email', async () => {
  subscriptionError = { code: '42501' }
  const result = await referenceEmailDetail(emailId)
  expect(result.email).toBeNull()
  expect(result.error).toContain('Reference evidence unavailable')
  expect(requests.some((r) => r.table === 'competitor_emails')).toBe(false)
})
