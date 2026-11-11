// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { makeInboxVariants, variantBatch } from './variants'
import { sampleAsk, type AiRun, type Ask } from '@/features/intelligence/passes'
import { skeletonOf } from '@/features/intelligence/skeleton'
import { fingerprintOf } from '@/features/intelligence/variants'

const productHtml = (n: number) =>
  `<table><tr><td width="300"><img src="https://x.test/p${n}.jpg" width="300" height="300"></td>` +
  `<td width="300"><h3>Linen shirt ${n}</h3><p>$49</p>` +
  `<a href="https://x.test/p${n}" style="background:#111;padding:12px">Shop now</a></td></tr></table>`
const ctaHtml =
  '<a href="https://x.test" style="background:#111;padding:12px">Shop now</a>'
const productKey = fingerprintOf('product_feature', skeletonOf(productHtml(1))!)
const ctaKey = fingerprintOf('cta', skeletonOf(ctaHtml)!)

type Row = Record<string, unknown>
const tagged = (id: string, html: string, over: Row = {}): Row => ({
  id,
  html,
  image_path: `sect/${id}.jpg`,
  block_type: 'product_feature',
  owner_block_type: null,
  layout: 'image_left',
  purpose: 'product_showcase',
  styles: ['photo_led'],
  tag_state: 'tagged',
  variant_state: null,
  ...over
})

function database(
  options: {
    jobs?: string[]
    rows?: Row[]
    /** What `find_block_variants` knows: fingerprint → variant (null: unusable). */
    known?: Record<string, string | null>
    recordError?: { code: string; message: string }
  } = {}
) {
  const jobs = [...(options.jobs ?? ['m1'])]
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const downloads: string[] = []
  return {
    calls,
    downloads,
    named: (name: string) => calls.filter((c) => c.name === name),
    storage: {
      from: () => ({
        download: async (path: string) => {
          downloads.push(path)
          return { data: new Blob([`jpeg:${path}`]), error: null }
        }
      })
    },
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args })
      if (name === 'claim_platform_job') {
        const id = jobs.shift()
        return {
          data: id
            ? [{ id: `job-${id}`, lease_token: 'lease', subject_key: id }]
            : [],
          error: null
        }
      }
      if (name === 'find_block_variants')
        return {
          data: (args.keys as string[])
            .filter((k) => k in (options.known ?? {}))
            .map((k) => ({ fingerprint: k, variant_id: options.known![k] })),
          error: null
        }
      if (name === 'record_block_variants') {
        if (options.recordError)
          return { data: null, error: options.recordError }
        const entries = args.sections as { state: string }[]
        return {
          data: {
            made: entries.filter((e) => e.state === 'made').length,
            matched: entries.filter((e) => e.state === 'matched').length,
            dropped: entries.filter(
              (e) => e.state === 'no_structure' || e.state === 'unusable'
            ).length
          },
          error: null
        }
      }
      return { data: null, error: null }
    }),
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () =>
          table === 'inbox_messages'
            ? { data: { id: 'm1', industry: 'apparel' }, error: null }
            : { data: null, error: null },
        order: async () => ({
          data: options.rows ?? [tagged('s1', productHtml(1))],
          error: null
        })
      }
      return chain
    }
  }
}
type Db = Parameters<typeof makeInboxVariants>[0]
const asDb = (d: ReturnType<typeof database>) => d as unknown as Db
const recorded = (d: ReturnType<typeof database>) =>
  d
    .named('record_block_variants')
    .flatMap((c) => c.args.sections as Record<string, unknown>[])
const later = () => Date.now() + 60_000
const askWith = (run: (callerKey: string) => AiRun) => {
  const mock = vi.fn(
    async (_def: unknown, _input: unknown, call: { callerKey: string }) =>
      run(call.callerKey)
  )
  return mock as unknown as Ask & typeof mock
}
const sure = (spec: unknown): AiRun => ({
  ok: true,
  content: { spec, confidence: 0.9 },
  provider: 'gemini',
  model: 'gemini-2.5-flash'
})

describe('makeInboxVariants', () => {
  it('adds a new structure to the library from its HTML when the AI is the fake, and finishes the job', async () => {
    const db = database()
    expect(await makeInboxVariants(asDb(db), sampleAsk, later())).toEqual({
      emails: 1,
      made: 1,
      matched: 0,
      dropped: 0,
      retried: 0,
      deferred: 0
    })
    expect(recorded(db)).toEqual([
      {
        section_id: 's1',
        state: 'made',
        skeleton_fingerprint: productKey,
        variant: {
          fingerprint: productKey,
          pass: 'skeleton',
          model: null,
          spec: skeletonOf(productHtml(1))
        }
      }
    ])
    expect(db.named('finish_platform_job')).toHaveLength(1)
    // Structure only: no word, link or picture of the section is stored.
    const stored = JSON.stringify(recorded(db))
    for (const leak of ['Linen', 'x.test', 'Shop now', '#111'])
      expect(stored).not.toContain(leak)
  })

  it('adds evidence to a structure already in the library, or leaves out one found unusable, without any AI call', async () => {
    const db = database({
      rows: [
        tagged('s1', productHtml(1)),
        tagged('s2', ctaHtml, { block_type: 'cta', layout: 'single_column' })
      ],
      known: { [productKey]: 'v-product', [ctaKey]: null }
    })
    const ask = askWith(() => {
      throw new Error('no call expected')
    })
    expect(await makeInboxVariants(asDb(db), ask, later())).toMatchObject({
      made: 0,
      matched: 1,
      dropped: 1
    })
    expect(ask).not.toHaveBeenCalled()
    expect(recorded(db)).toEqual([
      {
        section_id: 's1',
        state: 'matched',
        variant_id: 'v-product',
        skeleton_fingerprint: productKey
      },
      { section_id: 's2', state: 'unusable', skeleton_fingerprint: ctaKey }
    ])
  })

  it('asks once per new structure, even when the email repeats it, with the crop when pictures are on', async () => {
    const db = database({
      rows: [tagged('s1', productHtml(1)), tagged('s2', productHtml(2))]
    })
    const better = {
      ...skeletonOf(productHtml(1))!,
      padding: 'l' as const
    }
    const ask = askWith(() => sure(better))
    await makeInboxVariants(asDb(db), ask, later(), { pictures: true })
    expect(ask).toHaveBeenCalledOnce()
    expect(ask.mock.calls[0]![2]).toMatchObject({
      callerKey: 'variant:s1',
      tier: 'review',
      industry: 'apparel'
    })
    expect(db.downloads).toEqual(['sect/s1.jpg'])
    const fingerprint = fingerprintOf('product_feature', better)
    expect(
      recorded(db).map((e) => [
        e.section_id,
        e.state,
        (e.variant as { fingerprint: string; pass: string }).fingerprint,
        (e.variant as { pass: string }).pass
      ])
    ).toEqual([
      ['s1', 'made', fingerprint, 'maker'],
      ['s2', 'made', fingerprint, 'maker']
    ])
  })

  it('skips sections not tagged or already placed, and leaves out one with no structure', async () => {
    const db = database({
      rows: [
        tagged('s1', productHtml(1), { tag_state: 'untagged' }),
        tagged('s2', productHtml(2), { variant_state: 'matched' }),
        tagged('s3', '<p>   </p>', {
          block_type: 'text',
          layout: 'single_column'
        }),
        tagged('s4', productHtml(4), { block_type: 'unsure' })
      ]
    })
    expect(await makeInboxVariants(asDb(db), sampleAsk, later())).toMatchObject(
      {
        emails: 1,
        dropped: 1,
        made: 0
      }
    )
    expect(recorded(db)).toEqual([{ section_id: 's3', state: 'no_structure' }])
  })

  it("uses a person's own label as the family", async () => {
    const db = database({
      rows: [
        tagged('s1', productHtml(1), {
          block_type: 'image_text',
          owner_block_type: 'product_feature'
        })
      ]
    })
    await makeInboxVariants(asDb(db), sampleAsk, later())
    expect(recorded(db)[0]).toMatchObject({
      state: 'made',
      skeleton_fingerprint: productKey
    })
  })

  it('remembers a structure as unusable only when a model really answered', async () => {
    // A product block without a price cannot be drawn, whatever is asked.
    const html =
      '<table><tr><td><h2>Our story</h2><p>Words only here</p></td></tr></table>'
    const fake = database({ rows: [tagged('s1', html)] })
    await makeInboxVariants(asDb(fake), sampleAsk, later())
    expect(recorded(fake)).toEqual([
      { section_id: 's1', state: 'unusable', skeleton_fingerprint: null }
    ])
    const real = database({ rows: [tagged('s1', html)] })
    await makeInboxVariants(
      asDb(real),
      askWith(() => sure({ rows: [] })),
      later()
    )
    expect(recorded(real)).toEqual([
      {
        section_id: 's1',
        state: 'unusable',
        skeleton_fingerprint: fingerprintOf(
          'product_feature',
          skeletonOf(html)!
        )
      }
    ])
  })

  it('keeps the answers already paid for when another call in the batch fails, then retries the job', async () => {
    const db = database({
      rows: [
        tagged('s1', productHtml(1)),
        tagged('s2', ctaHtml, { block_type: 'cta', layout: 'single_column' })
      ]
    })
    const ask = askWith((callerKey) =>
      callerKey === 'variant:s2'
        ? { ok: false, code: 'timeout' }
        : sure(skeletonOf(productHtml(1)))
    )
    expect(await makeInboxVariants(asDb(db), ask, later())).toMatchObject({
      made: 1,
      retried: 1,
      emails: 0
    })
    expect(recorded(db).map((e) => e.section_id)).toEqual(['s1'])
    expect(db.named('fail_platform_job')[0]!.args).toMatchObject({
      error_code: 'ai_timeout'
    })
  })

  it('works in batches and puts the job back, without using a try, when time runs short', async () => {
    const rows = Array.from({ length: variantBatch + 2 }, (_, i) =>
      // Eight different structures: one to four columns, each with or
      // without a line at the bottom.
      tagged(
        `s${i}`,
        `<table><tr>${`<td><img src="a.jpg"><p>$9</p>${i >= 4 ? '<hr>' : ''}</td>`.repeat(1 + (i % 4))}</tr></table>`
      )
    )
    const db = database({ rows })
    let now = 1_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const ask = askWith(() => {
      now += 5_000
      return { ok: true, content: null, provider: 'fake', model: 'fake' }
    })
    const run = await makeInboxVariants(asDb(db), ask, 1_000_000 + 9_000, {
      batchMs: 6_000
    })
    clock.mockRestore()
    expect(run.deferred).toBe(1)
    // The first batch was saved before the job went back.
    expect(recorded(db)).toHaveLength(variantBatch)
    expect(
      db.calls.findIndex((c) => c.name === 'record_block_variants')
    ).toBeLessThan(db.calls.findIndex((c) => c.name === 'defer_platform_job'))
    expect(run.emails).toBe(0)
    expect(db.named('defer_platform_job')[0]!.args).toMatchObject({
      delay_seconds: 0,
      reason: 'variants_continue'
    })
    expect(db.named('finish_platform_job')).toHaveLength(0)
  })

  it('waits an hour when the AI budget is spent, says so in the logs, and stops the run', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = database({ jobs: ['m1', 'm2'] })
    const ask = askWith(() => ({ ok: false, code: 'cap_reached' }))
    expect(await makeInboxVariants(asDb(db), ask, later())).toMatchObject({
      deferred: 1,
      retried: 0
    })
    expect(db.named('defer_platform_job')[0]!.args).toMatchObject({
      delay_seconds: 3600,
      reason: 'ai_cap_reached'
    })
    expect(db.named('claim_platform_job')).toHaveLength(1)
    const logged = warn.mock.calls.map(([line]) => JSON.parse(String(line)))
    expect(logged).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        message: 'Inbox variant job put back',
        reason: 'ai_cap_reached',
        delaySeconds: 3600
      })
    )
    warn.mockRestore()
  })

  it('puts the job back before its first batch when the reads used up the time', async () => {
    const db = database()
    let now = 1_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const rpc = db.rpc.getMockImplementation()!
    db.rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        // The lookup of known structures takes a second.
        if (name === 'find_block_variants') now += 1_000
        return rpc(name, args)
      }
    )
    const ask = askWith(() => sure(skeletonOf(productHtml(1))))
    const run = await makeInboxVariants(asDb(db), ask, 1_000_000 + 6_500, {
      batchMs: 6_000
    })
    clock.mockRestore()
    expect(run).toMatchObject({ deferred: 1, emails: 0 })
    expect(ask).not.toHaveBeenCalled()
    expect(db.named('defer_platform_job')[0]!.args).toMatchObject({
      delay_seconds: 0,
      reason: 'variants_continue'
    })
  })

  it('puts the job back on a rate limit and stops; an unavailable model uses a try; a lost lease is reported as such', async () => {
    const limited = database({ jobs: ['m1', 'm2'] })
    const ask = askWith(() => ({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 600
    }))
    expect(await makeInboxVariants(asDb(limited), ask, later())).toMatchObject({
      retried: 0,
      deferred: 1
    })
    expect(limited.named('defer_platform_job')[0]!.args).toMatchObject({
      delay_seconds: 600,
      reason: 'ai_rate_limited'
    })
    expect(limited.named('fail_platform_job')).toHaveLength(0)
    expect(limited.named('claim_platform_job')).toHaveLength(1)
    const down = database()
    expect(
      await makeInboxVariants(
        asDb(down),
        askWith(() => ({ ok: false, code: 'unavailable' })),
        later()
      )
    ).toMatchObject({ retried: 1 })
    expect(down.named('fail_platform_job')[0]!.args).toMatchObject({
      failure: 'unavailable',
      error_code: 'ai_unavailable'
    })
    const lost = database({ recordError: { code: 'PT409', message: 'x' } })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await makeInboxVariants(asDb(lost), sampleAsk, later())
    expect(lost.named('fail_platform_job')[0]!.args).toMatchObject({
      failure: 'internal',
      error_code: 'lease_lost'
    })
  })
})
