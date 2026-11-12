// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { ProviderFault } from '@/features/integrations/failures'
import { sampleAsk, type AiRun, type Ask } from '@/features/intelligence/passes'
import {
  sampleReviewSource,
  sampleSocialSource,
  socialSourceFor,
  type ReviewSource,
  type SocialSource
} from '@/lib/providers/review-source'
import { reviewSourceFor } from './source'
import { readBrandReviews } from './worker'

type Db = Parameters<typeof readBrandReviews>[0]
type Job = Parameters<typeof readBrandReviews>[1]
const jobFor = (
  domain = 'cedar-lane.example',
  mode = domain.endsWith('.example') ? 'sample' : 'live',
  attempt = 1
) =>
  ({
    id: 'job-1',
    tenant_id: 'tenant-1',
    lease_token: 'lease-1',
    kind: 'brand.read_reviews',
    attempt,
    input: { domain, mode }
  }) as unknown as Job

function database(
  products: { url: string | null }[] = [],
  error: unknown = null
) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const tables: string[] = []
  const chain = (table: string) => {
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      not: () => c,
      order: () => c,
      limit: () => c,
      single: async () => ({ data: { brand_name: 'Cedar Lane' }, error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: table === 'products' ? products : [], error: null })
    }
    return c
  }
  return {
    calls,
    tables,
    db: {
      from: (table: string) => {
        tables.push(table)
        return chain(table)
      },
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return { data: { findings: 0 }, error }
      })
    } as unknown as Db
  }
}
type Recorded = {
  findings: {
    source: string
    topic: string
    pass: string
    model: string | null
    evidence: Record<string, string>
  }[]
  pages: string[]
  posts: string[]
  summary: {
    reviews: { state: string; reason?: string }
    social: { state: string; reason?: string }
    analysis: string
  }
  live: boolean
}
const recorded = (calls: ReturnType<typeof database>['calls']) =>
  calls.find((c) => c.name === 'record_review_findings')!.args as Recorded
const samples = {
  reviews: () => sampleReviewSource,
  social: () => sampleSocialSource
}
const askWith = (run: AiRun) =>
  vi.fn(async () => run) as unknown as Ask & ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('readBrandReviews', () => {
  it('stores the reviews an email may quote and the review app from the samples, citing the pages read', async () => {
    const { db, calls } = database()
    const run = await readBrandReviews(db, jobFor(), {
      ...samples,
      askFor: () => sampleAsk
    })
    const args = recorded(calls)
    expect(calls[0]!.args).toMatchObject({
      job: 'job-1',
      lease: 'lease-1',
      live: false
    })
    expect(args.findings.map((f) => [f.source, f.topic, f.pass])).toEqual([
      ['reviews', 'quotable_review', 'sample'],
      ['reviews', 'quotable_review', 'sample'],
      ['reviews', 'quotable_review', 'sample'],
      ['reviews', 'review_platform', 'sample']
    ])
    expect(args.pages).toHaveLength(2)
    // The comments were read, but with the fake AI nothing is said of them.
    expect(args.summary).toEqual({
      reviews: { state: 'ready' },
      social: { state: 'none' },
      analysis: 'done'
    })
    expect(args.posts).toEqual(['https://www.instagram.com/p/SAMPLE01/'])
    expect(run.read).toEqual({ reviews: 5, comments: 2, pages: 2 })
  })

  it('stores a model’s words under the source they come from, with the job in its call', async () => {
    const ask = askWith({
      ok: true,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      content: {
        findings: [
          {
            topic: 'objection',
            statement: 'Some customers find the knit runs large.',
            from: 'reviews',
            ids: ['r2'],
            quote: 'it runs a little large',
            confidence: 0.8
          },
          {
            topic: 'customer_words',
            statement: 'Customers ask about more colours.',
            from: 'comments',
            ids: ['c1'],
            quote: 'come in a darker green',
            confidence: 0.7
          }
        ]
      }
    })
    const { db, calls } = database()
    await readBrandReviews(db, jobFor(), { ...samples, askFor: () => ask })
    const args = recorded(calls)
    expect(
      args.findings
        .filter((f) => f.pass === 'model')
        .map((f) => [f.source, f.topic])
    ).toEqual([
      ['reviews', 'objection'],
      ['social', 'customer_words']
    ])
    expect(args.summary.social).toEqual({ state: 'ready' })
    expect((ask.mock.calls[0] as unknown[])[2]).toMatchObject({
      callerKey: 'reviews:job-1'
    })
  })

  it('stores a quiet brand as none for both sources, which replaces their earlier findings', async () => {
    const { db, calls } = database()
    await readBrandReviews(db, jobFor('quiet-shop.example'), {
      ...samples,
      askFor: () => sampleAsk
    })
    expect(recorded(calls)).toMatchObject({
      findings: [],
      summary: {
        reviews: { state: 'none' },
        social: { state: 'none' },
        analysis: 'skipped'
      }
    })
  })

  it('logs and skips a real brand’s sources until they are switched on or chosen, replacing nothing', async () => {
    const { db, calls } = database([
      { url: 'https://real-brand.com/products/a' }
    ])
    const ask = vi.fn()
    await readBrandReviews(db, jobFor('real-brand.com'), {
      reviews: (mode, domain, urls, time) =>
        reviewSourceFor(
          mode,
          domain,
          urls,
          time,
          {} as unknown as NodeJS.ProcessEnv
        ),
      social: socialSourceFor,
      askFor: () => ask as unknown as Ask
    })
    expect(recorded(calls)).toMatchObject({
      findings: [],
      pages: [],
      posts: [],
      live: true,
      summary: {
        reviews: { state: 'skipped', reason: 'reviews_not_set_up' },
        social: { state: 'skipped', reason: 'social_not_set_up' }
      }
    })
    expect(ask).not.toHaveBeenCalled()
  })

  it('hands a live read the catalog’s product pages', async () => {
    const { db } = database([
      { url: 'https://real-brand.com/products/a' },
      { url: null },
      { url: 'https://real-brand.com/products/a' },
      { url: 'http://real-brand.com/products/b' }
    ])
    const reviews = vi.fn((): ReviewSource => sampleReviewSource)
    await readBrandReviews(db, jobFor('real-brand.com'), {
      reviews,
      social: socialSourceFor,
      askFor: () => null
    }).catch(() => undefined)
    expect((reviews.mock.calls[0] as unknown[])[2]).toEqual([
      'https://real-brand.com/products/a'
    ])
  })

  it('tries again when a source is unwell or fails, and skips it on the last try', async () => {
    const unwell: ReviewSource = {
      live: false,
      reviews: async () => ({ ok: false, code: 'unavailable' })
    }
    const failing: SocialSource = {
      live: false,
      comments: () => {
        throw new Error('socket hang up')
      }
    }
    for (const deps of [
      { reviews: () => unwell, social: () => sampleSocialSource },
      { reviews: () => sampleReviewSource, social: () => failing }
    ]) {
      const { db, calls } = database()
      await expect(
        readBrandReviews(db, jobFor(), { ...deps, askFor: () => sampleAsk })
      ).rejects.toBeInstanceOf(ProviderFault)
      expect(calls).toEqual([])
    }
    const { db, calls } = database()
    await readBrandReviews(db, jobFor('cedar-lane.example', 'sample', 4), {
      reviews: () => unwell,
      social: () => sampleSocialSource,
      askFor: () => sampleAsk
    })
    expect(recorded(calls).summary.reviews).toEqual({
      state: 'skipped',
      reason: 'reviews_unavailable'
    })
  })

  it('fails the job when the findings cannot be stored', async () => {
    const { db } = database([], { code: 'PT409' })
    await expect(
      readBrandReviews(db, jobFor(), { ...samples, askFor: () => sampleAsk })
    ).rejects.toMatchObject({ code: 'PT409' })
  })
})
