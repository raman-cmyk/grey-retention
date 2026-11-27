// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { listEmailResults, type EmailResult } from '@/features/results/read'
import { ruleKey } from './patterns'
import {
  learnFromRecentResults,
  learnFromResults,
  sentEmail,
  tenantsPerRun,
  weeklyLearningFor,
  workspacesToLearn
} from './run'

const tenant = '00000000-0000-4000-8000-000000000101'
const now = Date.parse('2026-11-24T12:00:00Z')
let n = 0
const email = (over: Partial<EmailResult> = {}): EmailResult => ({
  buildId: `b${++n}`,
  runId: 'run',
  slot: 1,
  sample: false,
  campaignId: 'c',
  planned: { emailType: 'story' },
  status: 'sent',
  changed: false,
  designChanged: false,
  designEvidence: false,
  scheduledFor: null,
  sendStrategy: null,
  sentAt: new Date(now - 5 * 86_400_000).toISOString(),
  pulls: 3,
  results: [
    {
      variation: null,
      name: null,
      design: null,
      statistics: {
        recipients: 1000,
        delivered: 1000,
        opens_unique: 300,
        clicks_unique: 20,
        unsubscribe_uniques: 1
      }
    }
  ],
  clicks: [
    {
      variation: null,
      design: null,
      url: 'https://x',
      section: 1,
      block: 'hero_product',
      clicks: 12,
      unique: 10
    }
  ],
  complete: true,
  final: true,
  paused: null,
  checkedAt: null,
  ...over
})
/** A stored results row, as `listEmailResults` reads it. */
const row = (e: EmailResult) => ({
  build_id: e.buildId,
  run_id: e.runId,
  slot: e.slot,
  sample: e.sample,
  campaign_id: e.campaignId,
  planned: e.planned,
  status: e.status,
  changed: e.changed,
  design_changed: e.designChanged,
  design_evidence: e.designEvidence
    ? {
        variation: 'VarA01',
        recorded: '0123456789abcdef',
        current: 'fedcba9876543210',
        firstSeenAt: e.sentAt,
        lastSeenAt: e.sentAt,
        checks: 1
      }
    : null,
  sent_at: e.sentAt,
  pulls: e.pulls,
  results: e.results,
  clicks: e.clicks,
  complete: e.complete,
  final: e.final,
  paused: e.paused,
  checked_at: e.checkedAt
})

describe('sentEmail (LRN-002)', () => {
  it('reads a final, real, sent email: people, clicks, unsubscribes, its top section', () => {
    expect(sentEmail(email({ buildId: 'x' }))).toEqual({
      buildId: 'x',
      emailType: 'story',
      sentAt: email().sentAt,
      recipients: 1000,
      clicks: 20,
      unsubscribes: 1,
      spamComplaints: null,
      topBlock: 'hero_product',
      edited: false
    })
  })

  it('reads spam complaints when Klaviyo counted them (#76)', () => {
    const counted = email({
      results: [
        {
          variation: 'va',
          name: null,
          design: 'A',
          statistics: {
            recipients: 500,
            delivered: 500,
            clicks_unique: 10,
            spam_complaints: 2
          }
        },
        {
          variation: 'vb',
          name: null,
          design: 'B',
          statistics: {
            recipients: 500,
            delivered: 500,
            clicks_unique: 10,
            spam_complaints: 1
          }
        }
      ]
    })
    expect(sentEmail(counted)?.spamComplaints).toBe(3)
    const zero = email({
      results: [
        {
          variation: null,
          name: null,
          design: null,
          statistics: {
            recipients: 1000,
            delivered: 1000,
            clicks_unique: 20,
            spam_complaints: 0
          }
        }
      ]
    })
    expect(sentEmail(zero)?.spamComplaints).toBe(0)
  })

  it('marks an email the owner edited in Klaviyo, and learns nothing from its sections (PICK-99)', () => {
    for (const over of [{ changed: true }, { designChanged: true }])
      expect(sentEmail(email(over))).toMatchObject({
        edited: true,
        topBlock: null,
        clicks: 20
      })
    // Deleted, cancelled or never sent: no send at all.
    for (const status of ['deleted', 'cancelled', 'stale', 'draft'] as const)
      expect(sentEmail(email({ status }))).toBeNull()
  })

  it('counts a design edit first seen at the send check as the owner’s, before a second check confirms it (PICK-97, #673 review)', () => {
    expect(sentEmail(email({ designEvidence: true }))).toMatchObject({
      edited: true,
      topBlock: null,
      clicks: 20
    })
    expect(sentEmail(email())).toMatchObject({ edited: false })
  })

  it('leaves out samples, unfinished or unsent emails, and an unknown count stays unknown', () => {
    for (const over of [
      { sample: true },
      { final: false },
      { status: 'scheduled' as const },
      { sentAt: null },
      { results: [] }
    ])
      expect(sentEmail(email(over))).toBeNull()
    const noUnsubscribes = email({
      results: [
        {
          variation: null,
          name: null,
          design: null,
          statistics: { recipients: 1000, delivered: 1000, clicks_unique: 20 }
        }
      ]
    })
    expect(sentEmail(noUnsubscribes)?.unsubscribes).toBeNull()
  })
})

type Call = { table: string; filters: [string, string, unknown][] }
function database(opts: {
  emails?: EmailResult[]
  rules?: Record<string, unknown>[]
  recent?: { tenant_id: string }[]
  failRpc?: string
  failRead?: boolean
}) {
  const calls: Call[] = []
  const rpc = vi.fn(async (name: string) =>
    name === opts.failRpc
      ? { data: null, error: { code: 'PT409' } }
      : { data: 'ok', error: null }
  )
  const from = (table: string) => {
    const call: Call = { table, filters: [] }
    calls.push(call)
    const chain = {
      select: () => chain,
      eq: (c: string, v: unknown) => (call.filters.push(['eq', c, v]), chain),
      gte: (c: string, v: unknown) => (call.filters.push(['gte', c, v]), chain),
      or: (v: string) => (call.filters.push(['or', '', v]), chain),
      order: () => chain,
      limit: async () =>
        opts.failRead
          ? { data: null, error: { code: 'XX000' } }
          : {
              data:
                table === 'agent_memory_rules'
                  ? (opts.rules ?? [])
                  : call.filters.some(([, c]) => c === 'final')
                    ? (opts.recent ?? [])
                    : (opts.emails ?? []).map(row),
              error: null
            }
    }
    return chain
  }
  return { db: { from, rpc } as never, rpc, calls }
}
const sends = (k: number, over: Partial<EmailResult>) =>
  Array.from({ length: k }, () => email(over))
const clicks = (c: number) => [
  {
    variation: null,
    name: null,
    design: null,
    statistics: {
      recipients: 1000,
      delivered: 1000,
      clicks_unique: c,
      unsubscribe_uniques: 1
    }
  }
]

describe('listEmailResults (PICK-97, #673 review)', () => {
  it('reads stored design evidence as an edit not yet confirmed', async () => {
    const { db } = database({
      emails: [email({ designEvidence: true }), email()]
    })
    const read = await listEmailResults(db, tenant)
    expect(read.map((e) => e.designEvidence)).toEqual([true, false])
    expect(read.map((e) => sentEmail(e)?.edited)).toEqual([true, false])
  })
})

describe('learnFromResults (LRN-002)', () => {
  const emails = [
    ...sends(3, { planned: { emailType: 'launch' }, results: clicks(40) }),
    ...sends(3, { planned: { emailType: 'story' }, results: clicks(20) })
  ]

  it('writes each new rule once, as the workspace’s own, through the service-only command', async () => {
    const { db, rpc, calls } = database({ emails })
    expect(await learnFromResults(db, tenant, now)).toEqual({
      added: 3,
      updated: 0,
      retired: 0,
      conflicts: 0
    })
    expect(rpc).toHaveBeenCalledWith('add_memory_rule', {
      r: expect.objectContaining({
        tenantId: tenant,
        industry: null,
        kind: 'do',
        source: 'results',
        evidenceCount: 3,
        idempotencyKey: ruleKey(tenant, {
          dimension: 'email_type',
          value: 'launch',
          kind: 'do'
        })
      })
    })
    // Its own rules only.
    expect(
      calls.find((c) => c.table === 'agent_memory_rules')!.filters
    ).toEqual([
      ['eq', 'tenant_id', tenant],
      ['eq', 'source', 'results']
    ])
  })

  it('retires a rule that turned, with the revision it read, and counts a refused write', async () => {
    const turned = [
      ...sends(3, { planned: { emailType: 'launch' }, results: clicks(5) }),
      ...sends(3, { planned: { emailType: 'story' }, results: clicks(20) })
    ]
    const rules = [
      {
        id: 'r1',
        revision: 4,
        idempotency_key: ruleKey(tenant, {
          dimension: 'email_type',
          value: 'launch',
          kind: 'do'
        }),
        status: 'active',
        confidence: 0.6
      }
    ]
    const { db, rpc } = database({ emails: turned, rules })
    expect(await learnFromResults(db, tenant, now)).toMatchObject({
      retired: 1
    })
    expect(rpc).toHaveBeenCalledWith('update_memory_rule', {
      rule_id: 'r1',
      expected_revision: 4,
      new_status: 'retired',
      new_confidence: 0.6
    })
    const refused = database({
      emails: turned,
      rules,
      failRpc: 'update_memory_rule'
    })
    expect(await learnFromResults(refused.db, tenant, now)).toMatchObject({
      retired: 0,
      conflicts: 1
    })
  })

  it('throws a failed read', async () => {
    await expect(
      learnFromResults(database({ failRead: true }).db, tenant, now)
    ).rejects.toMatchObject({ code: 'XX000' })
  })
})

describe('learnFromRecentResults (LRN-002)', () => {
  it('learns for the workspaces whose real results turned final lately, at most a few, and never throws', async () => {
    const recent = [
      ...Array.from({ length: 8 }, (_, i) => ({ tenant_id: `t${i}` })),
      { tenant_id: 't0' }
    ]
    const { db, calls } = database({ recent })
    expect(await workspacesToLearn(db, now)).toHaveLength(tenantsPerRun)
    expect(calls[0]!.filters).toEqual([
      ['eq', 'final', true],
      ['eq', 'sample', false],
      ['gte', 'results_at', new Date(now - 2 * 86_400_000).toISOString()]
    ])
    expect(await learnFromRecentResults(db, now)).toMatchObject({
      workspaces: tenantsPerRun,
      failed: 0
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(
      await learnFromRecentResults(database({ failRead: true }).db, now)
    ).toMatchObject({ workspaces: 0, added: 0 })
  })
})

describe('weeklyLearningFor (#74)', () => {
  it('reads this workspace’s rules changed this week and sums them up', async () => {
    const { db, calls } = database({
      rules: [
        {
          kind: 'do',
          rule: 'Plan more launch emails.',
          status: 'active',
          created_at: new Date(now - 86_400_000).toISOString(),
          updated_at: new Date(now - 86_400_000).toISOString()
        }
      ]
    })
    expect(await weeklyLearningFor(db, tenant, now)).toMatchObject({
      dos: ['Plan more launch emails.'],
      summary: '1 new do'
    })
    expect(calls[0]!.filters[0]).toEqual(['eq', 'tenant_id', tenant])
  })
})
