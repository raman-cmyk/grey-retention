import { beforeEach, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ client: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
import { renderData } from './data'

type Request = {
  table: string
  filters: Record<string, unknown>
  single?: boolean
}
const tenantId = crypto.randomUUID(),
  campaignId = crypto.randomUUID(),
  captureId = crypto.randomUUID(),
  selectedId = crypto.randomUUID(),
  requests: Request[] = []
let subscriptions: { capture_id: string }[], failure: { code: string } | null
class Query implements PromiseLike<{ data: never[]; error: null }> {
  request: Request
  constructor(table: string) {
    this.request = { table, filters: {} }
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
  order() {
    return this
  }
  range() {
    return Promise.resolve({ data: subscriptions, error: failure })
  }
  limit() {
    return Promise.resolve({ data: [], error: null })
  }
  maybeSingle() {
    this.request.single = true
    const ids = this.request.filters.capture_id as string[]
    return Promise.resolve({
      data: ids.includes(captureId)
        ? { id: selectedId, subject: 'Permitted older structure' }
        : null,
      error: null
    })
  }
  then<T = { data: never[]; error: null }, E = never>(
    onfulfilled?:
      ((value: { data: never[]; error: null }) => T | PromiseLike<T>) | null,
    onrejected?: ((reason: unknown) => E | PromiseLike<E>) | null
  ): PromiseLike<T | E> {
    return Promise.resolve({ data: [], error: null }).then(
      onfulfilled,
      onrejected
    )
  }
}
beforeEach(() => {
  requests.length = 0
  subscriptions = [{ capture_id: captureId }]
  failure = null
  mocks.client.mockResolvedValue({ from: (table: string) => new Query(table) })
})

it('scopes recent and selected rendering sources to current active tenant subscriptions', async () => {
  const result = await renderData(tenantId, campaignId, selectedId)
  expect(result?.references).toEqual([
    { id: selectedId, subject: 'Permitted older structure' }
  ])
  expect(requests[0]?.filters).toEqual({ tenant_id: tenantId, active: true })
  for (const request of requests.filter((r) => r.table === 'competitor_emails'))
    expect(request.filters.capture_id).toEqual([captureId])
  expect(requests.find((r) => r.single)?.filters.id).toBe(selectedId)
})

it('excludes a selected structure from an unsubscribed source and fails on subscription denial', async () => {
  subscriptions = [{ capture_id: crypto.randomUUID() }]
  expect(
    (await renderData(tenantId, campaignId, selectedId))?.references
  ).toEqual([])
  requests.length = 0
  failure = { code: '42501' }
  expect(await renderData(tenantId, campaignId, selectedId)).toBeNull()
  expect(requests.some((r) => r.table === 'competitor_emails')).toBe(false)
})
