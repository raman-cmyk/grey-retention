// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { ProviderFault } from '@/features/integrations/failures'
import { sampleAsk, type AiRun, type Ask } from '@/features/intelligence/passes'
import {
  adLibraryFor,
  sampleAdLibrary,
  sampleAds,
  type AdLibrary
} from '@/lib/providers/ad-library'
import { adsRunMs, libraryMs, readBrandAds } from './worker'

type Db = Parameters<typeof readBrandAds>[0]
type Job = Parameters<typeof readBrandAds>[1]
const jobFor = (
  domain = 'cedar-lane.example',
  mode = domain.endsWith('.example') ? 'sample' : 'live',
  attempt = 1
) =>
  ({
    id: 'job-1',
    tenant_id: 'tenant-1',
    lease_token: 'lease-1',
    kind: 'brand.read_ads',
    attempt,
    input: { domain, mode }
  }) as unknown as Job

function database(error: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => ({ data: { brand_name: 'Cedar Lane' }, error: null })
  }
  return {
    calls,
    db: {
      from: () => chain,
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { data: { findings: 0 }, error }
      })
    } as unknown as Db
  }
}
type Recorded = {
  findings: {
    topic: string
    pass: string
    model: string | null
    evidence: { url: string; quote: string }
  }[]
  ads: { id: string; link: string | null }[]
  summary: { state: string; analysis: string; reason?: string }
  live: boolean
}
const recorded = (calls: ReturnType<typeof database>['calls']) =>
  calls.find((c) => c.name === 'record_ad_findings')!.args as Recorded
const library = (answer: Awaited<ReturnType<AdLibrary['activeAds']>>) => ({
  live: true,
  activeAds: vi.fn(async () => answer)
})
const askWith = (run: AiRun) => vi.fn(async () => run) as unknown as Ask

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('readBrandAds', () => {
  it('reads the sample ads and stores what they offer, their landing pages and formats, citing each ad', async () => {
    const { db, calls } = database()
    const run = await readBrandAds(db, jobFor(), {
      library: adLibraryFor,
      askFor: () => sampleAsk
    })
    const args = recorded(calls)
    expect(calls[0]!.args).toMatchObject({ job: 'job-1', lease: 'lease-1' })
    expect(args.summary).toEqual({ state: 'ready', analysis: 'done' })
    expect(args.live).toBe(false)
    // The brand's own four live ads: the ended one and the reseller's are left out.
    expect(args.ads).toHaveLength(4)
    expect(args.findings.map((f) => f.topic).sort()).toEqual([
      'creative',
      'free_shipping',
      'landing_page',
      'landing_page',
      'landing_page',
      'promotion'
    ])
    const ids = new Set(args.ads.map((a) => a.id))
    for (const f of args.findings) {
      expect(f.pass).toBe('sample')
      expect(ids.has(f.evidence.url.split('?id=')[1]!)).toBe(true)
    }
    expect(run).toMatchObject({ state: 'ready', ads: 4, live: false })
  })

  it('stores a model’s findings on live ads, and code’s counts as code', async () => {
    const ads = sampleAds('cedar-lane.example')
    const { db, calls } = database()
    await readBrandAds(db, jobFor(), {
      library: () => library({ ok: true, ads }),
      askFor: () =>
        askWith({
          ok: true,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          content: {
            findings: [
              {
                topic: 'angle',
                statement: 'Ads present the knits as gifts for her.',
                adIds: ['900000000000003'],
                quote: 'A gift she will wear every day',
                confidence: 0.8
              }
            ]
          }
        })
    })
    const args = recorded(calls)
    expect(args.live).toBe(true)
    expect(args.findings.map((f) => [f.topic, f.pass, f.model]).sort()).toEqual(
      [
        ['angle', 'model', 'gemini-2.5-flash'],
        ['creative', 'code', null],
        ['landing_page', 'code', null],
        ['landing_page', 'code', null],
        ['landing_page', 'code', null]
      ]
    )
  })

  it('picks the library by the read’s own mode, whatever its domain looks like', async () => {
    // A synthetic brand on a real-looking domain: the sample library, which
    // reads only sample brands, so the read is skipped as a sample read.
    const synthetic = database()
    await readBrandAds(synthetic.db, jobFor('real-brand.com', 'sample'), {
      library: adLibraryFor,
      askFor: () => sampleAsk
    })
    expect(recorded(synthetic.calls)).toMatchObject({
      live: false,
      summary: { state: 'skipped', reason: 'library_not_set_up' }
    })
    // A real brand on a `.example` domain: never the sample ads.
    const real = database()
    await readBrandAds(real.db, jobFor('cedar-lane.example', 'live'), {
      library: adLibraryFor,
      askFor: () => sampleAsk
    })
    expect(recorded(real.calls)).toMatchObject({
      live: true,
      ads: [],
      summary: { state: 'skipped', reason: 'library_not_set_up' }
    })
  })

  it('skips ads of no page that is the brand’s own, replacing nothing', async () => {
    const { db, calls } = database()
    await readBrandAds(db, jobFor(), {
      library: () =>
        library({
          ok: true,
          ads: sampleAds('cedar-lane.example').map((ad) => ({
            ...ad,
            linkUrl: 'https://cedar-lane.myshop.example/'
          }))
        }),
      askFor: () => sampleAsk
    })
    expect(recorded(calls)).toMatchObject({
      findings: [],
      ads: [],
      summary: { state: 'skipped', reason: 'no_own_page' }
    })
  })

  it('names the job in the analyst’s call', async () => {
    const ask = vi.fn(async () => ({
      ok: true,
      content: null,
      provider: 'fake',
      model: 'fake'
    }))
    await readBrandAds(database().db, jobFor(), {
      library: adLibraryFor,
      askFor: () => ask as unknown as Ask
    })
    expect((ask.mock.calls[0] as unknown[])[2]).toMatchObject({
      callerKey: 'ads:job-1'
    })
  })

  it('stores no ads as none, which replaces the earlier ads findings', async () => {
    const { db, calls } = database()
    const run = await readBrandAds(db, jobFor('no-ads-shop.example'), {
      library: adLibraryFor,
      askFor: () => sampleAsk
    })
    expect(recorded(calls)).toMatchObject({
      findings: [],
      ads: [],
      summary: { state: 'none', analysis: 'skipped' }
    })
    expect(run.state).toBe('none')
  })

  it('logs and skips a real brand until a live library is chosen, replacing nothing', async () => {
    const { db, calls } = database()
    const ask = vi.fn()
    const run = await readBrandAds(db, jobFor('real-brand.com'), {
      library: adLibraryFor,
      askFor: () => ask as unknown as Ask
    })
    expect(recorded(calls)).toMatchObject({
      findings: [],
      ads: [],
      summary: {
        state: 'skipped',
        analysis: 'skipped',
        reason: 'library_not_set_up'
      },
      live: true
    })
    expect(run.state).toBe('skipped')
    expect(ask).not.toHaveBeenCalled()
    const refused = database()
    await readBrandAds(refused.db, jobFor('real-brand.com'), {
      library: () => library({ ok: false, code: 'refused' }),
      askFor: () => null
    })
    expect(recorded(refused.calls).summary.reason).toBe('library_refused')
  })

  it('tries again later when the library is unwell, slow, busy or fails, storing nothing', async () => {
    const failing: AdLibrary = {
      live: true,
      activeAds: () => {
        throw new Error('socket hang up')
      }
    }
    const broken = database()
    await expect(
      readBrandAds(broken.db, jobFor(), {
        library: () => failing,
        askFor: () => sampleAsk
      })
    ).rejects.toBeInstanceOf(ProviderFault)
    expect(broken.calls).toEqual([])
    for (const answer of [
      { ok: false as const, code: 'unavailable' as const },
      { ok: false as const, code: 'rate_limited' as const }
    ]) {
      const { db, calls } = database()
      await expect(
        readBrandAds(db, jobFor(), {
          library: () => library(answer),
          askFor: () => sampleAsk
        })
      ).rejects.toBeInstanceOf(ProviderFault)
      expect(calls).toEqual([])
    }
    vi.useFakeTimers()
    try {
      const { db, calls } = database()
      const slow: AdLibrary = {
        live: true,
        activeAds: () => new Promise(() => {})
      }
      const read = readBrandAds(db, jobFor(), {
        library: () => slow,
        askFor: () => sampleAsk
      })
      const failed = expect(read).rejects.toBeInstanceOf(ProviderFault)
      await vi.advanceTimersByTimeAsync(libraryMs + 1)
      await failed
      expect(calls).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('logs and skips an unreadable library on the read’s last try, replacing nothing', async () => {
    const { db, calls } = database()
    const run = await readBrandAds(
      db,
      jobFor('cedar-lane.example', 'sample', 4),
      {
        library: () => library({ ok: false, code: 'unavailable' }),
        askFor: () => sampleAsk
      }
    )
    expect(run.state).toBe('skipped')
    expect(recorded(calls).summary).toEqual({
      state: 'skipped',
      analysis: 'skipped',
      reason: 'library_unavailable'
    })
  })

  it('stores what code counts when no model is set up, or no time is left for one', async () => {
    const ads = sampleAds('cedar-lane.example')
    const none = database()
    const run = await readBrandAds(none.db, jobFor(), {
      library: () => library({ ok: true, ads }),
      askFor: () => null
    })
    expect(run.analysis).toBe('skipped')
    expect(recorded(none.calls).findings.every((f) => f.pass === 'code')).toBe(
      true
    )
    let t = 0
    const late = database()
    const ask = vi.fn()
    await readBrandAds(late.db, jobFor(), {
      library: () => ({
        live: true,
        activeAds: async () => {
          t += adsRunMs - 5_000
          return { ok: true, ads }
        }
      }),
      askFor: () => ask as unknown as Ask,
      callMs: 10_000,
      now: () => t
    })
    expect(ask).not.toHaveBeenCalled()
    expect(recorded(late.calls).summary).toEqual({
      state: 'ready',
      analysis: 'skipped'
    })
  })

  it('tries again on an AI outage, and on the last try stores what code counts', async () => {
    const ads = sampleAds('cedar-lane.example')
    const outage = askWith({ ok: false, code: 'rate_limited' })
    const first = database()
    await expect(
      readBrandAds(first.db, jobFor(), {
        library: () => library({ ok: true, ads }),
        askFor: () => outage
      })
    ).rejects.toMatchObject({ name: 'TagError' })
    expect(first.calls).toEqual([])
    const last = database()
    const run = await readBrandAds(
      last.db,
      jobFor('cedar-lane.example', 'sample', 4),
      { library: () => library({ ok: true, ads }), askFor: () => outage }
    )
    expect(run.analysis).toBe('skipped')
    expect(recorded(last.calls).summary).toEqual({
      state: 'ready',
      analysis: 'skipped'
    })
    expect(recorded(last.calls).findings.length).toBeGreaterThan(0)
    expect(recorded(last.calls).findings.every((f) => f.pass === 'code')).toBe(
      true
    )
  })

  it('stores what code counts when the AI fails in a way no try will mend', async () => {
    const ads = sampleAds('cedar-lane.example')
    const { db, calls } = database()
    const run = await readBrandAds(db, jobFor(), {
      library: () => library({ ok: true, ads }),
      askFor: () => askWith({ ok: false, code: 'provider_account' })
    })
    expect(run.analysis).toBe('skipped')
    expect(recorded(calls).findings.length).toBeGreaterThan(0)
  })

  it('fails the job when the findings cannot be stored', async () => {
    const { db } = database({ code: 'PT409' })
    await expect(
      readBrandAds(db, jobFor(), {
        library: () => sampleAdLibrary,
        askFor: () => sampleAsk
      })
    ).rejects.toMatchObject({ code: 'PT409' })
  })
})
