import { beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

vi.mock('server-only', () => ({}))
import { conversationReferenceChoices } from './reference-choices'

type Subscription = {
  id: string
  tenant_id: string
  active: boolean
  capture_id: string
}
type Email = {
  id: string
  subject: string
  capture_id: string
  received_at: string
}
type Request = {
  table: string
  filters: Record<string, unknown>
  orders: { key: string; ascending: boolean }[]
  range?: number[]
  limit?: number
}
const tenantId = crypto.randomUUID(),
  otherTenantId = crypto.randomUUID(),
  requests: Request[] = []
let subscriptions: Subscription[],
  emails: Email[],
  subscriptionFailure: { code: string } | null,
  emailFailure: { code: string } | null

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
    return this.eq(key, value)
  }
  order(key: string, options?: { ascending?: boolean }) {
    this.request.orders.push({ key, ascending: options?.ascending ?? true })
    return this
  }
  scopedRows<T extends Subscription | Email>(rows: T[]) {
    return rows
      .filter((row) =>
        Object.entries(this.request.filters).every(([key, value]) => {
          const actual = row[key as keyof T]
          return Array.isArray(value)
            ? value.includes(actual)
            : value === actual
        })
      )
      .sort((a, b) => {
        for (const { key, ascending } of this.request.orders) {
          const comparison = String(a[key as keyof T]).localeCompare(
            String(b[key as keyof T])
          )
          if (comparison) return ascending ? comparison : -comparison
        }
        return 0
      })
  }
  range(from: number, to: number) {
    this.request.range = [from, to]
    return Promise.resolve({
      data: subscriptionFailure
        ? null
        : this.scopedRows(subscriptions).slice(from, to + 1),
      error: subscriptionFailure
    })
  }
  limit(limit: number) {
    this.request.limit = limit
    return Promise.resolve({
      data: emailFailure
        ? null
        : this.scopedRows(emails)
            .slice(0, limit)
            .map(({ id, subject }) => ({ id, subject })),
      error: emailFailure
    })
  }
}
const db = {
  from: (table: string) => new Query(table)
} as unknown as SupabaseClient<Database>

beforeEach(() => {
  requests.length = 0
  subscriptions = [
    { id: 'a', tenant_id: tenantId, active: true, capture_id: 'current' },
    { id: 'b', tenant_id: otherTenantId, active: true, capture_id: 'other' },
    { id: 'c', tenant_id: tenantId, active: false, capture_id: 'inactive' }
  ]
  emails = [
    {
      id: 'ours',
      subject: 'Current workspace',
      capture_id: 'current',
      received_at: '2026-10-01'
    },
    {
      id: 'foreign',
      subject: 'Other membership',
      capture_id: 'other',
      received_at: '2026-10-04'
    },
    {
      id: 'inactive',
      subject: 'Inactive source',
      capture_id: 'inactive',
      received_at: '2026-10-03'
    }
  ]
  subscriptionFailure = null
  emailFailure = null
})

it('limits reference choices to the current tenant active subscriptions even when other membership emails are readable', async () => {
  expect((await conversationReferenceChoices(db, tenantId)).data).toEqual([
    { id: 'ours', subject: 'Current workspace' }
  ])
  expect(requests[0]?.filters).toEqual({ tenant_id: tenantId, active: true })
  expect(requests[1]?.filters).toEqual({ capture_id: ['current'] })
})

it('pages active subscriptions in stable ID order and retains only the latest twenty scoped emails', async () => {
  subscriptions = Array.from({ length: 501 }, (_, index) => ({
    id: String(index).padStart(4, '0'),
    tenant_id: tenantId,
    active: true,
    capture_id: `capture-${index}`
  }))
  emails = Array.from({ length: 25 }, (_, index) => ({
    id: String(index).padStart(2, '0'),
    subject: `Scoped ${index}`,
    capture_id: 'capture-500',
    received_at: '2026-10-01'
  }))
  emails.push({
    id: 'foreign',
    subject: 'Unrelated newer email',
    capture_id: 'other',
    received_at: '2026-10-04'
  })
  const result = await conversationReferenceChoices(db, tenantId)
  expect(result.data).toHaveLength(20)
  expect(result.data?.map((email) => email.id)).toEqual(
    Array.from({ length: 20 }, (_, index) => String(index).padStart(2, '0'))
  )
  expect(requests[0]?.orders).toEqual([{ key: 'id', ascending: true }])
  expect(requests[1]?.range).toEqual([500, 999])
  expect(requests[2]?.orders).toEqual([
    { key: 'received_at', ascending: false },
    { key: 'id', ascending: true }
  ])
  expect(requests[2]?.limit).toBe(20)
})

it('does not query actor-wide emails when the current tenant has no active subscriptions', async () => {
  subscriptions = subscriptions.filter(
    (subscription) =>
      subscription.tenant_id !== tenantId || !subscription.active
  )
  expect(await conversationReferenceChoices(db, tenantId)).toEqual({
    data: [],
    error: null
  })
  expect(
    requests.some((request) => request.table === 'competitor_emails')
  ).toBe(false)
})

it('surfaces subscription read failure without falling back to unrelated emails', async () => {
  subscriptionFailure = { code: '42501' }
  expect(await conversationReferenceChoices(db, tenantId)).toEqual({
    data: null,
    error: subscriptionFailure
  })
  expect(
    requests.some((request) => request.table === 'competitor_emails')
  ).toBe(false)
})

it('surfaces a scoped email read failure', async () => {
  emailFailure = { code: '42501' }
  expect(await conversationReferenceChoices(db, tenantId)).toEqual({
    data: null,
    error: emailFailure
  })
})
