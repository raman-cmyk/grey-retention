import { describe, expect, it } from 'vitest'
import { siteDomain } from './flow-model'
import {
  progressFrom,
  readOnboardingProgress,
  readerKinds,
  targetSeconds,
  type JobRow,
  type PlanRow
} from './progress'

const signedUpAt = '2026-11-15T10:00:00.000Z'
const at = (min: number, sec = 0) =>
  new Date(Date.parse(signedUpAt) + (min * 60 + sec) * 1000).toISOString()
const job = (
  kind: string,
  status: string,
  from: number,
  to: number = from,
  checkpoint: unknown = {}
): JobRow => ({
  kind,
  status,
  checkpoint,
  created_at: at(from),
  updated_at: at(to)
})
const plan = (
  state: string,
  from: number,
  to: number = from,
  start_on = '2026-11-16'
): PlanRow => ({ state, start_on, created_at: at(from), updated_at: at(to) })
const progress = (
  over: Partial<Parameters<typeof progressFrom>[0]> & { nowMin?: number } = {}
) =>
  progressFrom({
    signedUpAt,
    jobs: [],
    firstPlanned: null,
    newestPlan: null,
    today: '2026-11-15',
    now: new Date(at(over.nowMin ?? 5)),
    ...over
  })
const states = (p: ReturnType<typeof progressFrom>) =>
  Object.fromEntries(p.steps.map((s) => [s.key, s.state]))

describe('progressFrom (ONB-066)', () => {
  it('shows nothing started right after sign-up', () => {
    const p = progress({ nowMin: 1 })
    expect(p.steps.map((s) => [s.key, s.label])).toEqual([
      ['site', 'Reading your website'],
      ['catalog', 'Reading your products'],
      ['history', 'Reading what you sent in Klaviyo'],
      ['ads', 'Reading your ads'],
      ['reviews', 'Reading your reviews'],
      ['plan', 'Your first 15-day plan']
    ])
    expect(p).toMatchObject({
      done: 0,
      elapsedSeconds: 60,
      firstPlanSeconds: null,
      onTarget: null
    })
    expect(
      p.steps.every((s) => s.state === 'not_started' && s.seconds === null)
    ).toBe(true)
  })

  it('follows each reader, its states and times', () => {
    const p = progress({
      jobs: [
        job(readerKinds.site, 'succeeded', 2, 3),
        job(readerKinds.catalog, 'running', 1),
        job(readerKinds.history, 'retry_wait', 1),
        job(readerKinds.ads, 'queued', 4),
        job(readerKinds.reviews, 'failed', 1, 2),
        job('email.rewrite', 'running', 1)
      ]
    })
    expect(states(p)).toEqual({
      site: 'done',
      catalog: 'working',
      history: 'working',
      ads: 'waiting',
      reviews: 'failed',
      plan: 'not_started'
    })
    const step = (key: string) => p.steps.find((s) => s.key === key)!
    expect(step('site')).toMatchObject({
      startedAt: at(2),
      finishedAt: at(3),
      seconds: 60
    })
    // Still working: the time so far.
    expect(step('catalog').seconds).toBe(240)
    // Queued is not started.
    expect(step('ads')).toMatchObject({ startedAt: null, seconds: null })
    expect(p.done).toBe(1)
    expect(
      states(progress({ jobs: [job(readerKinds.site, 'leased', 1)] })).site
    ).toBe('working')
  })

  it('never lets a later re-read undo a finished read', () => {
    const p = progress({
      jobs: [
        job(readerKinds.site, 'succeeded', 1, 2),
        // Day 9: a re-read waiting, and one that failed.
        job(readerKinds.site, 'queued', 60 * 24 * 8),
        job(readerKinds.catalog, 'succeeded', 1, 3),
        job(readerKinds.catalog, 'failed', 60 * 24 * 8, 60 * 24 * 8 + 1)
      ],
      nowMin: 60 * 24 * 8 + 2
    })
    expect(states(p)).toMatchObject({ site: 'done', catalog: 'done' })
    expect(p.steps[0]).toMatchObject({ startedAt: at(1), finishedAt: at(2) })
    // Before any success, the newest read says where it is.
    expect(
      states(
        progress({
          jobs: [
            job(readerKinds.site, 'failed', 1, 2),
            job(readerKinds.site, 'running', 3)
          ]
        })
      ).site
    ).toBe('working')
  })

  it('says skipped when a read finished without reading anything', () => {
    const p = progress({
      jobs: [
        job(readerKinds.ads, 'succeeded', 1, 2, { state: 'skipped' }),
        job(readerKinds.reviews, 'succeeded', 1, 2, {
          reviews: 'skipped',
          social: 'skipped'
        })
      ]
    })
    expect(states(p)).toMatchObject({ ads: 'skipped', reviews: 'skipped' })
    expect(p.done).toBe(0)
    // One source read is a read.
    expect(
      states(
        progress({
          jobs: [
            job(readerKinds.reviews, 'succeeded', 1, 2, {
              reviews: 'ready',
              social: 'skipped'
            }),
            job(readerKinds.ads, 'succeeded', 1, 2, { state: 'none' })
          ]
        })
      )
    ).toMatchObject({ reviews: 'done', ads: 'done' })
  })

  it('times the first plan against the ten-minute target', () => {
    const quick = progress({
      firstPlanned: plan('planned', 6, 8),
      newestPlan: plan('planned', 20, 21),
      nowMin: 30
    })
    expect(quick.steps.at(-1)).toMatchObject({
      state: 'done',
      startedAt: at(6),
      finishedAt: at(8),
      seconds: 120
    })
    expect(quick).toMatchObject({ firstPlanSeconds: 480, onTarget: true })
    const exact = progress({ firstPlanned: plan('planned', 8, 10), nowMin: 30 })
    expect(exact).toMatchObject({
      firstPlanSeconds: targetSeconds,
      onTarget: true
    })
    const slow = progress({ firstPlanned: plan('planned', 9, 11), nowMin: 30 })
    expect(slow).toMatchObject({ firstPlanSeconds: 660, onTarget: false })
  })

  it('shows the plan working, waiting for the owner, failed or out of date', () => {
    const last = (newestPlan: PlanRow, nowMin = 9) =>
      progress({ newestPlan, nowMin }).steps.at(-1)!
    expect(last(plan('pulse_queued', 4))).toMatchObject({
      state: 'working',
      seconds: 300
    })
    expect(last(plan('plan_queued', 4)).state).toBe('working')
    expect(last(plan('offers_ready', 4)).state).toBe('needs_you')
    expect(last(plan('failed', 2, 3))).toMatchObject({
      state: 'failed',
      finishedAt: at(3)
    })
    // Its 15 days began yesterday: it never finishes.
    expect(last(plan('offers_ready', 4, 4, '2026-11-14')).state).toBe('failed')
    expect(
      progress({ newestPlan: plan('failed', 2, 3), nowMin: 12 }).onTarget
    ).toBe(false)
    expect(
      progress({ newestPlan: plan('plan_queued', 2), nowMin: 9 }).onTarget
    ).toBeNull()
  })

  it('counts only the saved website’s own reads (ONB-SITEa)', () => {
    const read = (
      domain: string,
      status: string,
      from: number,
      to = from
    ): JobRow => ({ ...job(readerKinds.site, status, from, to), domain })
    const site = (jobs: JobRow[], site: string) =>
      progress({ jobs, site, nowMin: 30 }).steps[0]!
    // Website A read, then changed to B: B's read waits, A's is not B's.
    const a = read('cedar-lane.example', 'succeeded', 1, 2)
    expect(
      site([a, read('north-loft.example', 'queued', 3)], 'north-loft.example')
    ).toMatchObject({ state: 'waiting', startedAt: null })
    // No read of B at all: not read yet, though A's is newer than nothing.
    expect(site([a], 'north-loft.example').state).toBe('not_started')
    // A newer read of another website never stands in for this one's.
    expect(
      site(
        [a, read('north-loft.example', 'succeeded', 10, 11)],
        'cedar-lane.example'
      )
    ).toMatchObject({ state: 'done', startedAt: at(1), finishedAt: at(2) })
    // A, then B, then A again: A's own read counts again.
    expect(
      site(
        [
          a,
          read('north-loft.example', 'queued', 3),
          read('cedar-lane.example', 'queued', 4)
        ],
        'cedar-lane.example'
      ).state
    ).toBe('done')
    // The job keeps the domain as `private.site_domain` wrote it, and the
    // saved website comes through the same rule (`siteDomain`): compared
    // as they are. "www.www.example.com" is kept as "www.example.com", which
    // normalising again would wrongly turn into "example.com".
    const twice = siteDomain('www.www.example.com')!
    expect(twice).toBe('www.example.com')
    expect(site([read('www.example.com', 'running', 1)], twice).state).toBe(
      'working'
    )
    expect(site([read('example.com', 'succeeded', 1, 2)], twice).state).toBe(
      'not_started'
    )
    // A read that names no website is no website's.
    expect(
      site([job(readerKinds.site, 'succeeded', 1, 2)], 'cedar-lane.example')
        .state
    ).toBe('not_started')
    // The website's ads and reviews too: A's reads are not B's, B's own
    // are. The Klaviyo readers keep no website and are as before.
    const of = (kind: string, domain: string | null, status = 'succeeded') => ({
      ...job(kind, status, 1, 2),
      domain
    })
    const statesForB = (jobs: JobRow[]) =>
      states(progress({ jobs, site: 'north-loft.example' }))
    expect(
      statesForB([
        of(readerKinds.ads, 'cedar-lane.example'),
        of(readerKinds.reviews, 'cedar-lane.example'),
        of(readerKinds.catalog, null)
      ])
    ).toMatchObject({
      ads: 'not_started',
      reviews: 'not_started',
      catalog: 'done'
    })
    expect(
      statesForB([
        of(readerKinds.ads, 'cedar-lane.example'),
        of(readerKinds.ads, 'north-loft.example', 'queued'),
        of(readerKinds.reviews, 'cedar-lane.example'),
        of(readerKinds.reviews, 'north-loft.example')
      ])
    ).toMatchObject({ ads: 'waiting', reviews: 'done' })
    // Without the website, every site read counts, as before.
    expect(states(progress({ jobs: [a] })).site).toBe('done')
  })

  it('never counts negative time', () => {
    const p = progressFrom({
      signedUpAt,
      jobs: [job(readerKinds.site, 'running', 3)],
      firstPlanned: null,
      newestPlan: null,
      today: '2026-11-15',
      now: new Date(at(1))
    })
    expect(p.steps[0]!.seconds).toBe(0)
  })
})

describe('readOnboardingProgress (ONB-066)', () => {
  const tenantId = '00000000-0000-4000-8000-000000000101'
  type Call = { table: string; eq: [string, unknown][] }
  function db(answer: (call: Call) => { data: unknown; error: unknown }) {
    const calls: Call[] = []
    const client = {
      from(table: string) {
        const call: Call = { table, eq: [] }
        calls.push(call)
        const chain = {
          select: () => chain,
          eq: (c: string, v: unknown) => (call.eq.push([c, v]), chain),
          order: () => chain,
          limit: async () => answer(call),
          maybeSingle: async () => answer(call)
        }
        return chain
      }
    }
    return { client: client as never, calls }
  }
  const rows = (call: Call) => {
    if (call.table === 'tenants')
      return {
        data: { created_at: signedUpAt, timezone: 'America/New_York' },
        error: null
      }
    if (call.table === 'strategy_runs')
      return {
        data: call.eq.some(([c]) => c === 'state')
          ? [plan('planned', 5, 7)]
          : [plan('planned', 5, 7)],
        error: null
      }
    const kind = call.eq.find(([c]) => c === 'kind')?.[1]
    return {
      data:
        kind === readerKinds.site
          ? [
              {
                ...job(readerKinds.site, 'succeeded', 0, 2),
                domain: 'cedar-lane.example'
              }
            ]
          : [],
      error: null
    }
  }

  it('reads only this workspace, one query per reader', async () => {
    const { client, calls } = db(rows)
    const p = await readOnboardingProgress(client, tenantId, new Date(at(9)))
    expect(p).toMatchObject({ done: 2, firstPlanSeconds: 420, onTarget: true })
    expect(calls.find((c) => c.table === 'tenants')!.eq).toEqual([
      ['id', tenantId]
    ])
    for (const c of calls.filter((c) => c.table !== 'tenants'))
      expect(c.eq[0]).toEqual(['tenant_id', tenantId])
    expect(
      calls
        .filter((c) => c.table === 'job_runs')
        .map((c) => c.eq.find(([k]) => k === 'kind')?.[1])
    ).toEqual(Object.values(readerKinds))
  })

  it('given the website, asks only for its readers’ own reads (ONB-SITEa)', async () => {
    const { client, calls } = db(rows)
    const p = await readOnboardingProgress(
      client,
      tenantId,
      new Date(at(9)),
      'cedar-lane.example'
    )
    // The database's answer, checked again: the read is this website's.
    expect(p!.steps[0]!.state).toBe('done')
    const reads = calls.filter((c) => c.table === 'job_runs')
    const of = (kind: string) =>
      reads.find((c) => c.eq.some(([k, v]) => k === 'kind' && v === kind))!
    // The website, its ads and its reviews: this website's reads only.
    for (const kind of [readerKinds.site, readerKinds.ads, readerKinds.reviews])
      expect(of(kind).eq).toContainEqual([
        'input->>domain',
        'cedar-lane.example'
      ])
    // The Klaviyo readers keep no website.
    for (const kind of [readerKinds.catalog, readerKinds.history])
      expect(of(kind).eq.some(([k]) => k === 'input->>domain')).toBe(false)
    // Without it, no website is asked for.
    const plain = db(rows)
    await readOnboardingProgress(plain.client, tenantId, new Date(at(9)))
    expect(JSON.stringify(plain.calls)).not.toContain('input->>domain')
  })

  it('is null when any read fails or the workspace is not there', async () => {
    for (const fails of ['tenants', 'strategy_runs', 'job_runs']) {
      const { client } = db((call) =>
        call.table === fails
          ? { data: null, error: { code: '42501' } }
          : rows(call)
      )
      expect([fails, await readOnboardingProgress(client, tenantId)]).toEqual([
        fails,
        null
      ])
    }
    const { client } = db((call) =>
      call.table === 'tenants' ? { data: null, error: null } : rows(call)
    )
    expect(await readOnboardingProgress(client, tenantId)).toBeNull()
  })
})
