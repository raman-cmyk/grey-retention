// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { workspaceFallbacks } from './read'

const tenant = '00000000-0000-4000-8000-000000000101'
/** A query that records its calls and answers once awaited. */
function fakeDb(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = []
  const query: Record<string, unknown> = {
    then: (done: (r: unknown) => unknown) => Promise.resolve(result).then(done)
  }
  for (const name of ['select', 'eq', 'order', 'limit'])
    query[name] = (...args: unknown[]) => {
      calls.push([name, args])
      return query
    }
  const db = {
    from: (table: string) => {
      calls.push(['from', [table]])
      return query
    }
  }
  return { db: db as never, calls }
}

describe('the workspace fallback log (REL-084)', () => {
  it('reads the workspace’s own lines, newest first, in the owner’s words', async () => {
    const { db, calls } = fakeDb({
      data: [
        {
          id: 'f1',
          agent: 'content-locker',
          reason_code: 'content_replaced',
          reason: 'a planned product is no longer in the catalog.',
          fallback: 'used another product.',
          occurrences: 2,
          last_seen_at: '2026-11-15T00:00:00Z'
        },
        {
          id: 'f2',
          agent: 'design-critic',
          reason_code: 'email_critic_answer_invalid',
          reason: 'The Design critic kept answering in the wrong shape.',
          fallback: 'Drew the email with its coded blocks.',
          occurrences: 1,
          last_seen_at: '2026-11-14T00:00:00Z'
        }
      ],
      error: null
    })
    expect(await workspaceFallbacks(db, tenant, 500)).toEqual({
      ok: true,
      entries: [
        {
          id: 'f1',
          agent: 'content-locker',
          who: 'Choosing the email’s content',
          reason: 'a planned product is no longer in the catalog.',
          instead: 'used another product.',
          times: 2,
          lastSeen: '2026-11-15T00:00:00Z'
        },
        {
          id: 'f2',
          agent: 'design-critic',
          who: 'The design studio',
          reason: 'The AI kept giving answers we could not use.',
          instead: 'Drew the email with its coded blocks.',
          times: 1,
          lastSeen: '2026-11-14T00:00:00Z'
        }
      ]
    })
    expect(calls).toEqual([
      ['from', ['agent_fallbacks']],
      [
        'select',
        ['id,agent,reason_code,reason,fallback,occurrences,last_seen_at']
      ],
      ['eq', ['tenant_id', tenant]],
      ['order', ['last_seen_at', { ascending: false }]],
      ['order', ['id']],
      // At most 100 lines.
      ['limit', [100]]
    ])
  })

  it('says when the log cannot be read', async () => {
    const { db } = fakeDb({ data: null, error: { code: '42501' } })
    expect(await workspaceFallbacks(db, tenant)).toEqual({ ok: false })
  })
})
