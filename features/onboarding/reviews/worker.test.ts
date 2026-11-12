// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { ProviderFault } from '@/features/integrations/failures'
import { sampleAsk, type AiRun, type Ask } from '@/features/intelligence/passes'
import {
  sampleReviewSource,
  sampleSocialSource,
  socialSourceFor,
  type ReviewAnswer,
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
      is: () => c,
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

  it('says a source read only in part, or with no product page, is skipped, replacing nothing', async () => {
    const cases: [ReviewAnswer, string][] = [
      [
        { ok: true, reviews: [], platforms: [], pages: [], complete: false },
        'reviews_partial'
      ],
      [{ ok: false, code: 'no_pages' }, 'reviews_no_pages']
    ]
    for (const [answer, reason] of cases) {
      const { db, calls } = database()
      await readBrandReviews(db, jobFor(), {
        reviews: () => ({ live: false, reviews: async () => answer }),
        social: () => sampleSocialSource,
        askFor: () => sampleAsk
      })
      expect(recorded(calls).summary.reviews).toEqual({
        state: 'skipped',
        reason
      })
      expect(recorded(calls).pages).toEqual([])
    }
  })

  it('says a source the reader did not look at is skipped, not none', async () => {
    const page = 'https://cedar-lane.example/products/weekend-knit'
    const { db, calls } = database()
    await readBrandReviews(db, jobFor(), {
      reviews: () => ({
        live: false,
        reviews: async () => ({
          ok: true,
          // Read, but none an email may quote.
          reviews: [
            {
              id: 'r1',
              author: 'Maya R.',
              text: 'It is fine, a little thin for the price.',
              rating: 3,
              ratingUnclear: false,
              date: null,
              url: page,
              product: null
            }
          ],
          platforms: [],
          pages: [page],
          complete: true
        })
      }),
      social: () => sampleSocialSource,
      askFor: () => null
    })
    expect(recorded(calls)).toMatchObject({
      findings: [],
      pages: [],
      posts: [],
      summary: {
        reviews: { state: 'skipped', reason: 'not_analysed' },
        social: { state: 'skipped', reason: 'not_analysed' },
        analysis: 'skipped'
      }
    })
  })

  it('never says none for reviews read in part, even when the reader looked', async () => {
    const page = 'https://cedar-lane.example/products/weekend-knit'
    const { db, calls } = database()
    await readBrandReviews(db, jobFor(), {
      reviews: () => ({
        live: false,
        reviews: async () => ({
          ok: true,
          reviews: [
            {
              id: 'r1',
              author: 'Maya R.',
              text: 'It is fine, a little thin for the price.',
              rating: 3,
              ratingUnclear: false,
              date: null,
              url: page,
              product: null
            }
          ],
          platforms: [],
          pages: [page],
          complete: false
        })
      }),
      social: () => sampleSocialSource,
      // The model answers, but its one finding does not hold up.
      askFor: () =>
        askWith({
          ok: true,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          content: {
            findings: [
              {
                topic: 'objection',
                statement: 'Some find it thin.',
                from: 'reviews',
                ids: ['r1'],
                quote: 'words that are not in the review',
                confidence: 0.7
              }
            ]
          }
        })
    })
    expect(recorded(calls).summary).toEqual({
      reviews: { state: 'skipped', reason: 'reviews_partial' },
      social: { state: 'none' },
      analysis: 'done'
    })
    expect(recorded(calls).pages).toEqual([])
  })

  it('stores a post’s address the one way the database checks it, never one with a user', async () => {
    const { db, calls } = database()
    const run = await readBrandReviews(db, jobFor(), {
      reviews: () => sampleReviewSource,
      social: () => ({
        live: false,
        comments: async () => ({
          ok: true,
          comments: [
            'https://www.instagram.com:443/p/A/',
            'HTTPS://www.instagram.com/p/B/',
            'https://www.instagram.com\\p\\C',
            'https://user@www.instagram.com/p/D/',
            'https://www.instagram.com:8443/p/E/'
          ].map((url, n) => ({
            id: `c${n + 1}`,
            platform: 'instagram' as const,
            url,
            author: 'A',
            text: 'Lovely.'
          }))
        })
      }),
      askFor: () => sampleAsk
    })
    expect(recorded(calls).posts).toEqual([
      'https://www.instagram.com/p/A/',
      'https://www.instagram.com/p/B/',
      'https://www.instagram.com/p/C'
    ])
    expect(run.read.comments).toBe(3)
  })

  it('stores what code chose when the AI fails in a way no try will mend', async () => {
    const { db, calls } = database()
    const run = await readBrandReviews(db, jobFor(), {
      ...samples,
      askFor: () => askWith({ ok: false, code: 'provider_account' })
    })
    expect(run.analysis).toBe('skipped')
    expect(recorded(calls).findings.map((f) => f.topic)).toContain(
      'quotable_review'
    )
  })

  it('keeps comments on public posts only, at most 30 posts', async () => {
    const post = (n: number) => `https://www.instagram.com/p/POST${n}/`
    const { db, calls } = database()
    const run = await readBrandReviews(db, jobFor(), {
      reviews: () => sampleReviewSource,
      social: () => ({
        live: false,
        comments: async () => ({
          ok: true,
          comments: [
            {
              id: 'c0',
              platform: 'instagram' as const,
              url: 'https://evil.example/p/1',
              author: 'A',
              text: 'Lovely.'
            },
            ...Array.from({ length: 40 }, (_, n) => ({
              id: `c${n + 1}`,
              platform: 'instagram' as const,
              url: post(n),
              author: 'A',
              text: 'Lovely.'
            }))
          ]
        })
      }),
      askFor: () => sampleAsk
    })
    expect(recorded(calls).posts).toEqual(
      Array.from({ length: 30 }, (_, n) => post(n))
    )
    expect(run.read.comments).toBe(30)
  })

  it('tries again on an AI outage, and on the last try stores what code chose', async () => {
    const outage = askWith({ ok: false, code: 'rate_limited' })
    const first = database()
    await expect(
      readBrandReviews(first.db, jobFor(), {
        ...samples,
        askFor: () => outage
      })
    ).rejects.toMatchObject({ name: 'TagError' })
    expect(first.calls).toEqual([])
    const last = database()
    const run = await readBrandReviews(
      last.db,
      jobFor('cedar-lane.example', 'sample', 4),
      { ...samples, askFor: () => outage }
    )
    expect(run.analysis).toBe('skipped')
    expect(recorded(last.calls).findings.map((f) => f.topic)).toEqual([
      'quotable_review',
      'quotable_review',
      'quotable_review',
      'review_platform'
    ])
    expect(recorded(last.calls).summary).toEqual({
      reviews: { state: 'ready' },
      social: { state: 'skipped', reason: 'not_analysed' },
      analysis: 'skipped'
    })
  })

  it('fails the job when the findings cannot be stored', async () => {
    const { db } = database([], { code: 'PT409' })
    await expect(
      readBrandReviews(db, jobFor(), { ...samples, askFor: () => sampleAsk })
    ).rejects.toMatchObject({ code: 'PT409' })
  })
})
