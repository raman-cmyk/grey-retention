// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleAsk, type Ask } from '@/features/intelligence/passes'
import { sampleSiteFetcher, type SiteFetcher } from './fetch'
import { readBrandSite, siteRunMs } from './worker'

type Db = Parameters<typeof readBrandSite>[0]
type Job = Parameters<typeof readBrandSite>[1]
const jobFor = (domain = 'cedar-lane.example') =>
  ({
    id: 'job-1',
    tenant_id: 'tenant-1',
    lease_token: 'lease-1',
    kind: 'brand.read_site',
    input: { domain }
  }) as unknown as Job
const job = jobFor()

function database() {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({
      data: { brand_name: 'Cedar Lane' },
      error: null
    })
  }
  return {
    calls,
    db: {
      from: () => chain,
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { data: { findings: 0 }, error: null }
      })
    } as unknown as Db
  }
}
const recorded = (calls: ReturnType<typeof database>['calls']) =>
  calls.find((c) => c.name === 'record_site_findings')!.args as {
    findings: { topic: string; evidence: { url: string; quote: string } }[]
    pages: { url: string; kind: string; state: string; reason?: string }[]
    live: boolean
  }

describe('readBrandSite', () => {
  it('reads the sample site and stores its facts once each, with the pages read, and finishes the job', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db, calls } = database()
    const run = await readBrandSite(db, job, {
      fetcher: sampleSiteFetcher,
      askFor: () => sampleAsk
    })
    const args = recorded(calls)
    expect(
      calls.find((c) => c.name === 'record_site_findings')!.args
    ).toMatchObject({
      job: 'job-1',
      lease: 'lease-1',
      live: false
    })
    expect(args.pages.map((p) => [p.kind, p.state])).toEqual([
      ['home', 'read'],
      ['shipping', 'read'],
      ['returns', 'read'],
      ['faq', 'read'],
      ['about', 'read'],
      ['product', 'read'],
      ['product', 'read']
    ])
    const topics = args.findings.map((f) => f.topic)
    for (const topic of [
      'free_shipping',
      'returns',
      'guarantee',
      'delivery_days',
      'locale',
      'price_band',
      'claim',
      'offering'
    ])
      expect(topics, topic).toContain(topic)
    // The footer's free-shipping line is on every page: kept once.
    expect(topics.filter((t) => t === 'free_shipping')).toHaveLength(1)
    for (const f of args.findings)
      expect(f.evidence.url).toMatch(/^https:\/\/cedar-lane\.example\//)
    expect(run).toMatchObject({ findings: args.findings.length, live: false })
  })

  it('logs and skips a page it cannot read, and keeps the rest', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const sample = sampleSiteFetcher('cedar-lane.example')
    const fetcher: SiteFetcher = {
      live: false,
      fetch: async (url) =>
        url.endsWith('/pages/returns')
          ? { ok: false, failure: 'timeout' }
          : sample.fetch(url)
    }
    const { db, calls } = database()
    await readBrandSite(db, job, {
      fetcher: () => fetcher,
      askFor: () => sampleAsk
    })
    const args = recorded(calls)
    expect(args.pages).toContainEqual({
      url: 'https://cedar-lane.example/pages/returns',
      kind: 'returns',
      state: 'skipped',
      reason: 'timeout'
    })
    expect(args.findings.map((f) => f.topic)).not.toContain('returns')
    expect(args.findings.map((f) => f.topic)).toContain('guarantee')
  })

  it('stores nothing, and replaces nothing, when the home page cannot be read or there is no website', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const down = database()
    await readBrandSite(down.db, jobFor('shop.com'), {
      fetcher: sampleSiteFetcher,
      askFor: () => sampleAsk
    })
    expect(recorded(down.calls)).toMatchObject({
      findings: [],
      pages: [
        {
          url: 'https://shop.com/',
          kind: 'home',
          state: 'skipped',
          reason: 'not_found'
        }
      ]
    })
    const none = database()
    await readBrandSite(none.db, jobFor(''), {
      fetcher: sampleSiteFetcher,
      askFor: () => sampleAsk
    })
    expect(recorded(none.calls).pages).toEqual([
      expect.objectContaining({ state: 'skipped', reason: 'no_domain' })
    ])
  })

  it('skips the pages left when the time is up', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let now = 0
    const sample = sampleSiteFetcher('cedar-lane.example')
    const fetcher: SiteFetcher = {
      live: false,
      fetch: async (url) => {
        // The home page alone uses up the run's time.
        if (url === 'https://cedar-lane.example/') now += siteRunMs + 1
        return sample.fetch(url)
      }
    }
    const { db, calls } = database()
    await readBrandSite(db, job, {
      fetcher: () => fetcher,
      askFor: () => sampleAsk,
      now: () => now
    })
    const pages = recorded(calls).pages
    expect(
      pages.every((p) => p.state === 'skipped' && p.reason === 'time_up')
    ).toBe(true)
    expect(recorded(calls).findings).toEqual([])
  })

  it('counts a page whose answer was unusable as not read, so it replaces nothing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const junk: Ask = async () => ({ ok: false, code: 'invalid_output' })
    const { db, calls } = database()
    await readBrandSite(db, job, {
      fetcher: sampleSiteFetcher,
      askFor: () => junk
    })
    const args = recorded(calls)
    expect(args.findings).toEqual([])
    expect(
      args.pages.every(
        (p) => p.state === 'skipped' && p.reason === 'model_unusable'
      )
    ).toBe(true)
  })

  it('reads no fact from a live site when no model is set up, never guessing from a real page', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetch = vi.fn()
    const live: SiteFetcher = { live: true, fetch }
    const { db, calls } = database()
    await readBrandSite(db, jobFor('shop.com'), {
      fetcher: () => live,
      askFor: (isLive) => (isLive ? null : sampleAsk)
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(recorded(calls)).toMatchObject({
      findings: [],
      live: true,
      pages: [{ kind: 'home', state: 'skipped', reason: 'no_model' }]
    })
  })

  it('starts no model call without the time it may take, and says why a cut-off answer was skipped', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    let now = 0
    const sample = sampleSiteFetcher('cedar-lane.example')
    const fetcher: SiteFetcher = {
      live: false,
      fetch: async (url) => {
        if (url !== 'https://cedar-lane.example/') now = siteRunMs - 5_000
        return sample.fetch(url)
      }
    }
    const tooLong: Ask = async () => ({ ok: false, code: 'incomplete' })
    const { db, calls } = database()
    await readBrandSite(db, job, {
      fetcher: () => fetcher,
      askFor: () => tooLong,
      callMs: 10_000,
      now: () => now
    })
    const pages = recorded(calls).pages
    expect(pages[0]).toMatchObject({
      kind: 'home',
      state: 'skipped',
      reason: 'answer_too_long'
    })
    expect(pages.slice(1).every((p) => p.reason === 'time_up')).toBe(true)
  })

  it('fails the job, storing nothing, when the model is down, so the earlier findings stay', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const down: Ask = async () => ({ ok: false, code: 'unavailable' })
    const { db, calls } = database()
    await expect(
      readBrandSite(db, job, { fetcher: sampleSiteFetcher, askFor: () => down })
    ).rejects.toMatchObject({ code: 'unavailable' })
    expect(calls.map((c) => c.name)).not.toContain('record_site_findings')
  })

  it('fails the job when the findings cannot be stored', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { db } = database()
    ;(db.rpc as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: null,
      error: { code: 'PT409', message: 'Lease unavailable' }
    })
    await expect(
      readBrandSite(db, job, {
        fetcher: sampleSiteFetcher,
        askFor: () => sampleAsk
      })
    ).rejects.toMatchObject({ code: 'PT409' })
  })
})
