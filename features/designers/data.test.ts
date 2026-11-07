import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const server = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => server)

import { assignmentDetail, designerWorkspace } from './data'

type Call = { table: string; filters: [string, string, unknown][] }
let calls: Call[]
let rpc: ReturnType<typeof vi.fn>

/** A tiny query builder that records every filter it was given. */
function from(table: string) {
  const call: Call = { table, filters: [] }
  calls.push(call)
  const builder = {
    select: () => builder,
    eq: (col: string, value: unknown) => {
      call.filters.push(['eq', col, value])
      return builder
    },
    neq: (col: string, value: unknown) => {
      call.filters.push(['neq', col, value])
      return builder
    },
    order: () => builder,
    limit: () => builder,
    then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null })
  }
  return builder
}

beforeEach(() => {
  vi.stubEnv('AUTH_MODE', 'supabase')
  calls = []
  rpc = vi.fn()
  auth.requireRequestContext.mockResolvedValue({
    userId: 'user-d1',
    designerId: 'designer-1'
  })
  server.createClient.mockResolvedValue({ from, rpc })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('designerWorkspace', () => {
  it('requires a designer and loads only their own live briefs', async () => {
    const result = await designerWorkspace()
    expect(auth.requireRequestContext).toHaveBeenCalledWith('designer')
    const assignments = calls.find((c) => c.table === 'designer_assignments')!
    expect(assignments.filters).toContainEqual([
      'eq',
      'designer_id',
      'designer-1'
    ])
    expect(assignments.filters).toContainEqual(['neq', 'state', 'cancelled'])
    const notices = calls.find((c) => c.table === 'notifications')!
    expect(notices.filters).toContainEqual(['eq', 'recipient_id', 'user-d1'])
    expect(result.error).toBeNull()
  })

  it('says so when the briefs cannot load', async () => {
    server.createClient.mockResolvedValue({
      from: (table: string) => {
        const b = from(table)
        return {
          ...b,
          select: () => ({
            ...b,
            eq: () => ({
              neq: () => ({
                order: async () => ({ data: null, error: { message: 'x' } })
              }),
              order: () => ({
                limit: async () => ({ data: [], error: null })
              })
            })
          })
        }
      },
      rpc
    })
    const result = await designerWorkspace()
    expect(result.assignments).toEqual([])
    expect(result.error).toBe('Assigned work is unavailable. Refresh to retry.')
  })

  it('shows nothing in demo mode, with a reason', async () => {
    vi.stubEnv('AUTH_MODE', 'demo')
    const result = await designerWorkspace()
    expect(result.assignments).toEqual([])
    expect(result.error).toMatch(/Sign in through local Supabase/)
  })
})

describe('assignmentDetail', () => {
  it('returns nothing for a brief this designer cannot open', async () => {
    // The database refuses another designer's brief; the page then 404s.
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    expect(
      await assignmentDetail('33333333-3333-4333-8333-333333333333')
    ).toBeNull()
    expect(rpc).toHaveBeenCalledWith('assignment_brief', {
      assignment: '33333333-3333-4333-8333-333333333333'
    })
  })

  it('returns nothing when the brief does not match the expected shape', async () => {
    rpc.mockResolvedValue({ data: { brief: { title: 1 } }, error: null })
    expect(
      await assignmentDetail('33333333-3333-4333-8333-333333333333')
    ).toBeNull()
  })
})
