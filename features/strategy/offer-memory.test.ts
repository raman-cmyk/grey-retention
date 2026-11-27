// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { maxLookups, readOfferPercents } from './offer-memory'

/**
 * PLN-040b: the percent of the code GROS drafted for a Klaviyo campaign,
 * from this workspace's own builds and plans only.
 */
const tenantId = '00000000-0000-4000-8000-000000000101'
type Answer = { data: unknown[] | null; error: unknown }
type Call = { table: string; select: string; filters: unknown[][] }

function fakeDb(answers: Record<string, Answer>) {
  const calls: Call[] = []
  const db = {
    from(table: string) {
      const call: Call = { table, select: '', filters: [] }
      calls.push(call)
      const chain = {
        select(columns: string) {
          call.select = columns
          return chain
        },
        eq(column: string, value: unknown) {
          call.filters.push(['eq', column, value])
          return chain
        },
        in(column: string, values: unknown[]) {
          call.filters.push(['in', column, values])
          return chain
        },
        order(column: string, options: unknown) {
          call.filters.push(['order', column, options])
          return chain
        },
        then(resolve: (a: Answer) => unknown, reject: (e: unknown) => void) {
          return Promise.resolve(
            answers[table] ?? { data: [], error: null }
          ).then(resolve, reject)
        }
      }
      return chain
    }
  }
  return { db: db as never, calls }
}

const build = (over: Record<string, unknown> = {}) => ({
  run_id: 'run-1',
  slot: 0,
  klaviyo_campaign_id: 'C1',
  code: 'BIG25',
  offer: { percent: 25, expiresAt: null },
  ...over
})

describe('readOfferPercents (PLN-040b)', () => {
  it('reads only this workspace’s drafted builds of these campaigns, from the same Klaviyo', async () => {
    const { db, calls } = fakeDb({
      email_builds: { data: [build()], error: null }
    })
    const found = await readOfferPercents(db, tenantId, {
      campaignIds: ['C1', 'C1', 'C2', ''],
      live: true
    })
    expect([...found]).toEqual([['C1', 25]])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.table).toBe('email_builds')
    expect(calls[0]!.filters).toEqual([
      ['eq', 'tenant_id', tenantId],
      ['eq', 'state', 'drafted'],
      // A live history never matches a fake draft.
      ['eq', 'sample_draft', false],
      ['in', 'klaviyo_campaign_id', ['C1', 'C2']],
      ['order', 'created_at', { ascending: false }]
    ])
    await readOfferPercents(db, tenantId, { campaignIds: ['C1'], live: false })
    expect(calls[1]!.filters).toContainEqual(['eq', 'sample_draft', true])
  })

  it('asks nothing for no campaigns, and at most the plan’s 200', async () => {
    const { db, calls } = fakeDb({})
    expect(
      (await readOfferPercents(db, tenantId, { campaignIds: [], live: true }))
        .size
    ).toBe(0)
    expect(calls).toHaveLength(0)
    await readOfferPercents(db, tenantId, {
      campaignIds: Array.from({ length: 300 }, (_, i) => `C${i}`),
      live: true
    })
    const ids = calls[0]!.filters.find((f) => f[0] === 'in')![2] as string[]
    expect(ids).toHaveLength(maxLookups)
  })

  it('takes the newest drafted build; a draft with no code gives no percent', async () => {
    const { db } = fakeDb({
      email_builds: {
        data: [
          // Newest first (the read orders them).
          build({ offer: { percent: 15, expiresAt: null }, code: 'MID15' }),
          build(),
          build({ klaviyo_campaign_id: 'C2', code: null, offer: null }),
          // Broken rows are skipped, never trusted.
          build({ klaviyo_campaign_id: 'C3', offer: { percent: 250 } }),
          { klaviyo_campaign_id: 'C4' }
        ],
        error: null
      }
    })
    const found = await readOfferPercents(db, tenantId, {
      campaignIds: ['C1', 'C2', 'C3', 'C4'],
      live: true
    })
    // C3's percent is broken: its planned offer is looked up instead (none).
    expect([...found]).toEqual([['C1', 15]])
  })

  it('falls back to the planned email’s offer, in this workspace, when it names the same code', async () => {
    const { db, calls } = fakeDb({
      email_builds: {
        data: [
          // Built before the email kept its percent.
          build({ offer: undefined }),
          build({ klaviyo_campaign_id: 'C2', slot: 1, offer: undefined }),
          build({
            klaviyo_campaign_id: 'C3',
            run_id: 'run-2',
            offer: undefined
          })
        ],
        error: null
      },
      strategy_runs: {
        data: [
          {
            id: 'run-1',
            slots: [
              { offer: { id: 'o', code: 'BIG25', percent: 25 } },
              // Another code than the email's: not trusted.
              { offer: { id: 'o', code: 'MID15', percent: 15 } }
            ]
          },
          { id: 'run-2', slots: null }
        ],
        error: null
      }
    })
    const found = await readOfferPercents(db, tenantId, {
      campaignIds: ['C1', 'C2', 'C3'],
      live: true
    })
    expect([...found]).toEqual([['C1', 25]])
    expect(calls[1]).toEqual({
      table: 'strategy_runs',
      select: 'id,slots:plan->slots',
      filters: [
        ['eq', 'tenant_id', tenantId],
        ['in', 'id', ['run-1', 'run-2']]
      ]
    })
  })

  it('throws a failed read (the caller plans without it)', async () => {
    const { db } = fakeDb({
      email_builds: { data: null, error: { code: 'PGRST000' } }
    })
    await expect(
      readOfferPercents(db, tenantId, { campaignIds: ['C1'], live: true })
    ).rejects.toMatchObject({ code: 'PGRST000' })
    const second = fakeDb({
      email_builds: { data: [build({ offer: undefined })], error: null },
      strategy_runs: { data: null, error: { code: '42501' } }
    })
    await expect(
      readOfferPercents(second.db, tenantId, {
        campaignIds: ['C1'],
        live: true
      })
    ).rejects.toMatchObject({ code: '42501' })
  })
})
