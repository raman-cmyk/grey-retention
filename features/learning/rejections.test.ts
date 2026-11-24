// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  findRejections,
  rejectionDays,
  rejectionKey,
  rejectionWords,
  type CopyFallback
} from './rejections'
import { learnAfterBuild, learnFromRejections } from './run'

const tenant = '00000000-0000-4000-8000-000000000101'
const now = Date.parse('2026-11-24T12:00:00Z')
const day = 86_400_000
let n = 0
const fb = (rules: string[], daysAgo = 3): CopyFallback => ({
  id: `f${++n}`,
  rules,
  lastSeenAt: new Date(now - daysAgo * day).toISOString()
})

describe('rules from the checks’ rejections (LRN-002b, D22)', () => {
  it('makes a check the copy of three emails kept failing a don’t for the writers', () => {
    const found = findRejections(
      [
        fb(['shipping_claim', 'spam_words']),
        fb(['shipping_claim']),
        fb(['shipping_claim', 'shipping_claim']),
        fb(['spam_words'])
      ],
      now
    )
    expect(found).toEqual([
      {
        check: 'shipping_claim',
        rule: "Never write shipping claims the brand facts do not support: the checks kept rejecting it in this brand's emails.",
        why: `The copy of 3 emails in the last ${rejectionDays} days kept failing this check until plain copy was used.`,
        appliesTo: ['copywriter', 'letter-writer'],
        evidence: [
          { fallbackId: expect.any(String) },
          { fallbackId: expect.any(String) },
          { fallbackId: expect.any(String) }
        ],
        confidence: 0.55
      }
    ])
  })

  it('ignores old rejections and checks that are not about the writing', () => {
    expect(
      findRejections(
        [
          fb(['spam_words'], rejectionDays + 1),
          fb(['spam_words']),
          fb(['spam_words']),
          fb(['writer_output']),
          fb(['writer_output']),
          fb(['writer_output'])
        ],
        now
      )
    ).toEqual([])
    expect(rejectionWords).not.toHaveProperty('writer_output')
  })
})

function database(opts: {
  fallbacks?: { id: string; detail: unknown; last_seen_at: string }[]
  rules?: Record<string, unknown>[]
  fail?: boolean
}) {
  const rpc = vi.fn(async () => ({ data: 'ok', error: null }))
  const filters: [string, unknown][] = []
  const from = (table: string) => {
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => (filters.push([c, v]), chain),
      in: (c: string, v: unknown) => (filters.push([c, v]), chain),
      gte: () => chain,
      limit: async () =>
        opts.fail
          ? { data: null, error: { code: 'XX000' } }
          : {
              data:
                table === 'agent_fallbacks'
                  ? (opts.fallbacks ?? [])
                  : (opts.rules ?? []),
              error: null
            }
    }
    return chain
  }
  return { db: { from, rpc } as never, rpc, filters }
}
const row = (rules: unknown) => ({
  id: `f${++n}`,
  detail: { rules },
  last_seen_at: new Date(now - day).toISOString()
})

describe('learnFromRejections (LRN-002b)', () => {
  it('adds a check’s rule once, as the workspace’s own, source inspector', async () => {
    const { db, rpc, filters } = database({
      fallbacks: [
        row(['spam_words']),
        row(['spam_words']),
        row(['spam_words', 7]),
        row('not a list')
      ]
    })
    expect(await learnFromRejections(db, tenant, now)).toEqual({
      added: 1,
      updated: 0,
      retired: 0,
      conflicts: 0
    })
    expect(rpc).toHaveBeenCalledWith('add_memory_rule', {
      r: expect.objectContaining({
        tenantId: tenant,
        kind: 'dont',
        source: 'inspector',
        evidenceCount: 3,
        idempotencyKey: rejectionKey(tenant, 'spam_words'),
        expiresAt: new Date(now + 90 * day).toISOString()
      })
    })
    expect(filters).toContainEqual(['tenant_id', tenant])
    expect(filters).toContainEqual([
      'reason_code',
      ['copy_plain_fallback', 'copy_failed', 'copy_check_failed']
    ])
  })

  it('moves a stored rule’s confidence with more evidence, never brings back an ended one, and reads nothing more when nothing repeats', async () => {
    const six = Array.from({ length: 6 }, () => row(['spam_words']))
    const stored = {
      id: 'r1',
      revision: 2,
      idempotency_key: rejectionKey(tenant, 'spam_words'),
      status: 'active',
      confidence: 0.55
    }
    const more = database({ fallbacks: six, rules: [stored] })
    expect(await learnFromRejections(more.db, tenant, now)).toMatchObject({
      updated: 1
    })
    expect(more.rpc).toHaveBeenCalledWith('update_memory_rule', {
      rule_id: 'r1',
      expected_revision: 2,
      new_status: 'active',
      new_confidence: 0.7
    })
    const ended = database({
      fallbacks: six,
      rules: [{ ...stored, status: 'expired' }]
    })
    await learnFromRejections(ended.db, tenant, now)
    expect(ended.rpc).not.toHaveBeenCalled()
    const quiet = database({ fallbacks: [row(['spam_words'])] })
    expect(await learnFromRejections(quiet.db, tenant, now)).toMatchObject({
      added: 0
    })
  })

  it('after a build, never throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      await learnAfterBuild(database({ fail: true }).db, tenant, now)
    ).toBe(null)
  })
})
