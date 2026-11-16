// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import type { AiRunResult } from '@/features/ai/run'
import { memoryFallbackLog } from '@/features/fallback/log'
import {
  buildEmail,
  contentStep,
  lockedDraft,
  sectionsStep,
  type BuildAgents,
  type BuildCtx,
  type PlannedEmail
} from './build'
import { runBuildStep } from './steps'
import { sampleOffers, sampleStoreSource } from './ports'

/**
 * REL-AI part 2b: the copy step with the agents. The section planner and
 * the content locker are not set up here (they fall back to code's
 * choices); the Copywriter and the two inspectors answer.
 */
const tenantId = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const planned: PlannedEmail = {
  date: inDays(2),
  time: '10:00',
  emailType: 'offer',
  angle: 'The candle people love, for less',
  products: [
    { id: 'p-cedar-candle', title: 'Cedar candle' },
    { id: 'p-linen-throw', title: 'Linen throw' }
  ],
  offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 },
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
}
const answer = (content: unknown): AiRunResult => ({
  ok: true,
  content,
  provider: 'gemini',
  model: 'test',
  costMicro: 0,
  inputTokens: 1,
  outputTokens: 1,
  settled: true
})
/** Plain words for each block the writer is asked for, nothing claimed. */
const blockWords: Record<string, Record<string, unknown>> = {
  announcement_bar: { text: 'Something new from the shop' },
  hero_product: { headline: 'Made for slow evenings', cta: 'Shop now' },
  hero_image: { headline: 'Made for slow evenings', cta: 'Shop now' },
  offer_banner: { detail: 'Use your code at checkout.', cta: 'Use my code' },
  text: {
    heading: 'A note from the shop',
    paras: ['We picked these for quiet evenings at home.']
  },
  product_feature: {
    heading: 'Picked for this week',
    body: 'A quiet favourite for the evening.',
    cta: 'Shop now'
  },
  product_grid_2col: { heading: 'More to love' },
  product_grid_3col: { heading: 'More to love' },
  image_text: {
    heading: 'For quiet evenings',
    paras: ['A small thing for the evening.']
  },
  cta: { label: 'Shop the collection' },
  signoff: { text: 'See you soon' }
}
/** The Copywriter's answer for the blocks its instructions list. */
const writes = (system: string, n: number) => ({
  subject: `Quiet evenings, picked for you ${n}`,
  preheader: 'A few things for slow evenings at home, from our shop.',
  blocks: [...system.matchAll(/^\d+\. ([a-z0-9_]+):/gm)].map((m) => ({
    type: m[1],
    reason: 'Plan.',
    words: blockWords[m[1]] ?? {}
  }))
})
/**
 * The model, by agent: the Copywriter writes (or `writer` answers), the
 * inspectors find nothing, the others are not set up. Each call moves
 * `clock` on by `step` ms.
 */
const model = (
  opts: {
    writer?: (call: Parameters<AiCall>[0]) => AiRunResult
    clock?: { t: number; step: number }
  } = {}
) => {
  let n = 0
  return vi.fn<AiCall>(async (call) => {
    if (opts.clock) opts.clock.t += opts.clock.step
    const who = call.callerKey.split(':')[0]
    if (who === 'copywriter')
      return opts.writer
        ? opts.writer(call)
        : answer(writes(call.request.system, ++n))
    if (who === 'brand-inspector' || who === 'email-inspector')
      return answer({ problems: [] })
    return { ok: false, code: 'setup_required' }
  })
}
const agentsWith = (ai: AiCall): BuildAgents & { log: InMemoryRunLog } => ({
  memory: new InMemoryMemoryStore(),
  log: new InMemoryRunLog(),
  ai
})
const ctxWith = (agents: BuildAgents | null, over: Partial<BuildCtx> = {}) => ({
  tenantId,
  callerKey: 'email-build:b1',
  fallbacks: memoryFallbackLog(),
  agents,
  ...over
})
const store = () => sampleStoreSource.read(tenantId)
/** The sections and content steps, saved as the job keeps them. */
const savedSteps = async (from?: Awaited<ReturnType<typeof store>>) => {
  const ctx = ctxWith(null)
  const s = from ?? (await store())
  const sections = await sectionsStep(
    { planned, store: s, offers: sampleOffers },
    ctx
  )
  if (!sections.ok) throw new Error('sections failed')
  const content = await contentStep(
    { planned, store: s, sections: sections.output },
    ctx
  )
  return JSON.parse(
    JSON.stringify({ sections: sections.output, content })
  ) as Record<string, unknown>
}
const userOf = (ai: ReturnType<typeof model>, who: string, n = 0) =>
  ai.mock.calls.filter((c) => c[0].callerKey.startsWith(`${who}:`))[n][0]
    .request.user

describe('the copy step with the agents (REL-AI part 2b)', () => {
  it('the Copywriter writes the words, both inspectors pass them, and the email says the AI wrote it', async () => {
    const ai = model()
    const agents = agentsWith(ai)
    const result = await buildEmail(
      { planned, store: await store(), offers: sampleOffers },
      ctxWith(agents)
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.email).toMatchObject({
      ai: true,
      copy: 'written',
      subject: 'Quiet evenings, picked for you 1',
      code: 'CANDLE10'
    })
    expect(agents.log.entries.map((e) => e.agent)).toEqual(
      expect.arrayContaining([
        'copywriter',
        'brand-inspector',
        'email-inspector'
      ])
    )
  })

  it('gives the Copywriter the customers’ own words from the saved steps, not from the store read now (ONB-061)', async () => {
    const own = {
      ...(await store()),
      customerWords: ['smells like a forest', 'cosy evenings']
    }
    const copyFrom = async (
      saved: Awaited<ReturnType<typeof store>>,
      now: Awaited<ReturnType<typeof store>>
    ) => {
      const ai = model()
      const result = await runBuildStep(
        'copy',
        {
          planned,
          store: now,
          offers: sampleOffers,
          progress: await savedSteps(saved)
        },
        ctxWith(agentsWith(ai))
      )
      expect(result).toMatchObject({ ok: true, done: 'copy' })
      return JSON.parse(
        userOf(ai, 'copywriter').replace(/^Data \(JSON\): /, '')
      ) as Record<string, unknown>
    }
    // Saved with the phrases, read now without: the saved ones.
    expect((await copyFrom(own, await store())).customerWords).toEqual([
      'smells like a forest',
      'cosy evenings'
    ])
    // Saved without (a build from before), read now with: none.
    expect(await copyFrom(await store(), own)).not.toHaveProperty(
      'customerWords'
    )
  })

  it('still judges what the Copywriter writes when it echoes a customer phrase that breaks a rule', async () => {
    const own = {
      ...(await store()),
      customerWords: ['free shipping on every order']
    }
    // The preview line, which every email has, borrows it word for word.
    const echoes = (system: string, n: number) => ({
      ...writes(system, n),
      preheader: 'Free shipping on every order.'
    })
    let n = 0
    const ai = model({
      writer: () => {
        const sys = ai.mock.calls.at(-1)![0].request.system
        return answer(echoes(sys, ++n))
      }
    })
    const fallbacks = memoryFallbackLog()
    const result = await runBuildStep(
      'copy',
      {
        planned,
        store: own,
        offers: sampleOffers,
        progress: await savedSteps(own)
      },
      ctxWith(agentsWith(ai), { fallbacks })
    )
    expect(result).toMatchObject({ ok: true, done: 'copy' })
    if (!result.ok || !('output' in result)) return
    // Every rewrite still had the claim: plain copy, with the reason.
    expect(result.output).not.toHaveProperty('written')
    expect(JSON.stringify(result.output)).not.toMatch(/free shipping/i)
    expect(
      fallbacks.entries().find((e) => e.agent === 'copy-inspectors')
    ).toMatchObject({ reasonCode: 'copy_plain_fallback' })
    expect(userOf(ai, 'copywriter', 1)).toMatch(/shipping/i)
  })

  it('sends a subject another email of the plan has back to the Copywriter', async () => {
    const ai = model()
    const result = await buildEmail(
      {
        planned,
        store: await store(),
        offers: sampleOffers,
        taken: ['quiet evenings,  PICKED for you 1']
      },
      ctxWith(agentsWith(ai))
    )
    expect(result.ok && result.email.subject).toBe(
      'Quiet evenings, picked for you 2'
    )
    expect(userOf(ai, 'copywriter', 1)).toContain(
      'Another email in this plan already has this subject'
    )
  })

  it('sends a heading too long for its section back to the Copywriter, to use fewer words (DST-PIC #20)', async () => {
    let n = 0
    const long =
      'More to love from our shop this week, picked for your quiet evenings'
    const ai = model({
      writer: (call) => {
        const written = writes(call.request.system, ++n)
        return answer({
          ...written,
          blocks: written.blocks.map((b) =>
            b.type === 'product_grid_2col' && n === 1
              ? { ...b, words: { ...b.words, heading: long } }
              : b
          )
        })
      }
    })
    const result = await buildEmail(
      { planned, store: await store(), offers: sampleOffers },
      ctxWith(agentsWith(ai))
    )
    expect(result.ok).toBe(true)
    expect(userOf(ai, 'copywriter', 1)).toContain(
      `The heading is ${long.length} characters; at most 60. Use fewer, shorter words.`
    )
    expect(result.ok && result.email.html).not.toContain(long)
    // The Copywriter's second draft, not plain copy.
    expect(result.ok && result.email).toMatchObject({
      copy: 'written',
      subject: 'Quiet evenings, picked for you 2'
    })
  })

  /** A launch whose product's title is too long for a hero's headline. */
  const towel = 'Organic Cotton Waffle Bath Towel, Set of Two in Oat'
  const longLaunch = async () => {
    const s = await store()
    const id = planned.products[0]!.id
    return {
      planned: {
        ...planned,
        emailType: 'launch' as const,
        offer: null,
        products: planned.products.map((p) =>
          p.id === id ? { ...p, title: towel } : p
        )
      },
      store: {
        ...s,
        products: s.products.map((p) =>
          p.id === id ? { ...p, title: towel } : p
        )
      },
      offers: sampleOffers
    }
  }
  /** The Copywriter naming the product in the hero, in rounds up to `until`. */
  const naming = (until: number) => {
    let n = 0
    return model({
      writer: (call) => {
        const written = writes(call.request.system, ++n)
        return answer({
          ...written,
          blocks: written.blocks.map((b) =>
            b.type === 'hero_product' && n <= until
              ? { ...b, words: { ...b.words, headline: `Meet the ${towel}` } }
              : b
          )
        })
      }
    })
  }

  it('tells the Copywriter to leave a long product title out of the hero’s headline (DST-PIC #20)', async () => {
    const ai = naming(1)
    const result = await buildEmail(await longLaunch(), ctxWith(agentsWith(ai)))
    expect(userOf(ai, 'copywriter', 1)).toContain(
      'The headline is 60 characters with the product’s title in it; at most 45. Leave the title out (the picture shows the product) and write about the product in a few words.'
    )
    expect(result.ok && result.email).toMatchObject({
      copy: 'written',
      subject: 'Quiet evenings, picked for you 2'
    })
    expect(result.ok && result.email.html).toContain('Made for slow evenings')
  })

  it('a hero headline still too long after every rewrite: plain copy, which names the product by its title', async () => {
    const fallbacks = memoryFallbackLog()
    const result = await buildEmail(
      await longLaunch(),
      ctxWith(agentsWith(naming(99)), { fallbacks })
    )
    expect(result.ok && result.email.copy).toBe('plain')
    expect(result.ok && result.email.html).toContain(towel)
    expect(
      fallbacks.entries().find((e) => e.agent === 'copy-inspectors')
    ).toMatchObject({
      reasonCode: 'copy_plain_fallback',
      detail: expect.objectContaining({
        rules: expect.arrayContaining(['headline_too_long'])
      })
    })
    // Without the agents, the same email builds in plain copy.
    const plain = await buildEmail(await longLaunch(), ctxWith(null))
    expect(plain.ok && plain.email.html).toContain(towel)
  })

  it('saves its rounds when the next call would not fit, and the next claim goes on without paying twice', async () => {
    const progress = await savedSteps()
    const clock = { t: 0, step: 20_000 }
    const ai = model({ clock })
    const agents = agentsWith(ai)
    const input = { planned, store: await store(), offers: sampleOffers }
    const first = await runBuildStep(
      'copy',
      { ...input, progress },
      ctxWith(agents, { until: 50_000, clock: () => clock.t })
    )
    // Written at 0 to 20 s, the Brand inspector at 20 to 40 s; the Email
    // inspector would end past 50 s.
    expect(first).toMatchObject({ ok: true, saved: 'copy' })
    if (!first.ok || !('saved' in first)) return
    const work = JSON.parse(JSON.stringify(first.work))
    expect(work.pending.next).toBe('email-inspector')
    const next = await runBuildStep(
      'copy',
      {
        ...input,
        progress: { ...progress, work: { copy: { ...work, saves: 1 } } }
      },
      ctxWith(agents, { until: clock.t + 50_000, clock: () => clock.t })
    )
    expect(next).toMatchObject({
      ok: true,
      done: 'copy',
      output: { written: true }
    })
    expect(ai.mock.calls.map((c) => c[0].callerKey.split(':')[0])).toEqual([
      'copywriter',
      'brand-inspector',
      'email-inspector'
    ])
  })

  it('a busy AI: plain copy now, with the reason (no later job would run the agents)', async () => {
    const fallbacks = memoryFallbackLog()
    const result = await runBuildStep(
      'copy',
      {
        planned,
        store: await store(),
        offers: sampleOffers,
        progress: await savedSteps()
      },
      ctxWith(
        agentsWith(
          model({
            writer: () => ({
              ok: false,
              code: 'rate_limited',
              retryAfterSeconds: 20
            })
          })
        ),
        { fallbacks }
      )
    )
    expect(result).toMatchObject({ ok: true, done: 'copy' })
    if (!result.ok || !('output' in result)) return
    expect(result.output).not.toHaveProperty('written')
    expect(fallbacks.entries().map((e) => e.reasonCode)).toContain(
      'copy_ai_busy'
    )
  })

  it('in the step’s last claim (no saves left), out of time means plain copy, logged', async () => {
    const fallbacks = memoryFallbackLog()
    const clock = { t: 0, step: 40_000 }
    const result = await runBuildStep(
      'copy',
      {
        planned,
        store: await store(),
        offers: sampleOffers,
        progress: {
          ...(await savedSteps()),
          work: { copy: { saves: 16 } }
        }
      },
      ctxWith(agentsWith(model({ clock })), {
        fallbacks,
        until: 50_000,
        clock: () => clock.t
      })
    )
    expect(result).toMatchObject({ ok: true, done: 'copy' })
    expect(
      fallbacks.entries().find((e) => e.agent === 'copy-inspectors')
    ).toMatchObject({
      reasonCode: 'copy_plain_fallback',
      detail: expect.objectContaining({ cause: 'out_of_time' })
    })
  })

  it('when every rewrite and plain copy fail, the build stops as copy_failed, logged once', async () => {
    const fallbacks = memoryFallbackLog()
    const store0 = await store()
    // A banned word the writer's words and plain copy's subject both use.
    const banned = {
      ...store0,
      facts: { ...store0.facts, bannedPhrases: ['from'] }
    }
    const result = await runBuildStep(
      'copy',
      {
        planned,
        store: banned,
        offers: sampleOffers,
        progress: await savedSteps(banned)
      },
      ctxWith(agentsWith(model()), { fallbacks })
    )
    expect(result).toEqual({ ok: false, code: 'copy_failed' })
    expect(
      fallbacks
        .entries()
        .filter(
          (e) => e.agent === 'copy-inspectors' || e.agent === 'email-build'
        )
    ).toHaveLength(1)
  })

  it('without the agents (the sweep), saved rounds are left and the words are plain', async () => {
    const result = await runBuildStep(
      'copy',
      {
        planned,
        store: await store(),
        offers: sampleOffers,
        progress: {
          ...(await savedSteps()),
          work: { copy: { rounds: [], saves: 1 } }
        }
      },
      ctxWith(null)
    )
    expect(result).toMatchObject({ ok: true, done: 'copy' })
    if (!result.ok || !('output' in result)) return
    expect(result.output).not.toHaveProperty('written')
  })

  it('when the Copywriter cannot write (allowance used), plain copy with a subject no other email has', async () => {
    const plain = await lockedDraft(
      { planned, store: await store(), offers: sampleOffers },
      ctxWith(null)
    )
    if (!plain.ok) throw new Error('plain copy failed')
    const fallbacks = memoryFallbackLog()
    const result = await buildEmail(
      {
        planned,
        store: await store(),
        offers: sampleOffers,
        taken: [plain.draft.subject]
      },
      ctxWith(
        agentsWith(
          model({ writer: () => ({ ok: false, code: 'cap_reached' }) })
        ),
        { fallbacks }
      )
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.email).toMatchObject({ ai: false, copy: 'plain' })
    expect(result.email.subject).not.toBe(plain.draft.subject)
    expect(
      fallbacks.entries().find((e) => e.agent === 'copy-inspectors')
    ).toMatchObject({ reasonCode: 'copy_plain_fallback' })
  })
})

describe('the last check of the discount code (REL-OFF)', () => {
  /** Every step but the design, saved, with the copy's code changed. */
  const savedCopy = async (code: string | null) => {
    const progress = await savedSteps()
    const copy = await runBuildStep(
      'copy',
      { planned, store: await store(), offers: sampleOffers, progress },
      ctxWith(null)
    )
    if (!copy.ok || !('output' in copy)) throw new Error('copy failed')
    const output = JSON.parse(JSON.stringify(copy.output))
    output.draft.code = code
    return { ...progress, copy: output } as Record<string, unknown>
  }
  const design = async (progress: Record<string, unknown>) =>
    runBuildStep(
      'design',
      { planned, store: await store(), offers: sampleOffers, progress },
      ctxWith(null)
    )

  it('stores an email whose code is a working one within the max', async () => {
    const result = await design(await savedCopy('CANDLE10'))
    expect(result).toMatchObject({ ok: true, done: 'design' })
  })

  it('never stores an email with a code that is not a working one, or above the max', async () => {
    expect(await design(await savedCopy('NOT-A-CODE'))).toEqual({
      ok: false,
      code: 'offer_unsafe'
    })
    const progress = await savedCopy('CANDLE10')
    const sections = progress.sections as {
      rules: { maxDiscountPercent: number }
    }
    sections.rules.maxDiscountPercent = 5
    expect(await design(progress)).toEqual({ ok: false, code: 'offer_unsafe' })
  })

  it('never stores an email whose code was switched off in Settings since the first step', async () => {
    const progress = await savedCopy('CANDLE10')
    const result = await runBuildStep(
      'design',
      {
        planned,
        store: await store(),
        offers: { offers: async () => ({ maxDiscountPercent: 20, codes: [] }) },
        progress
      },
      ctxWith(null)
    )
    expect(result).toEqual({ ok: false, code: 'offer_unsafe' })
  })

  it('never stores an email whose code was removed and added again at another percent or end', async () => {
    const progress = await savedCopy('CANDLE10')
    const sections = progress.sections as {
      rules: {
        codes: { code: string; percent: number; expiresAt: string | null }[]
      }
    }
    const candle = sections.rules.codes.find((c) => c.code === 'CANDLE10')!
    const again = async (over: Partial<typeof candle>) =>
      runBuildStep(
        'design',
        {
          planned,
          store: await store(),
          offers: {
            offers: async () => ({
              maxDiscountPercent: 20,
              codes: [{ ...candle, ...over }]
            })
          },
          progress
        },
        ctxWith(null)
      )
    expect(await again({ percent: 5 })).toEqual({
      ok: false,
      code: 'offer_unsafe'
    })
    expect(
      await again({
        expiresAt: new Date(Date.now() + 40 * 86_400_000).toISOString()
      })
    ).toEqual({ ok: false, code: 'offer_unsafe' })
    const same = await again({})
    expect(same).toMatchObject({ ok: true, done: 'design' })
    if (!same.ok || !('email' in same)) return
    expect(same.email.offer).toEqual({
      percent: candle.percent,
      expiresAt: candle.expiresAt
    })
  })

  it('tries again when Settings cannot be read', async () => {
    const result = await runBuildStep(
      'design',
      {
        planned,
        store: await store(),
        offers: {
          offers: async () => {
            throw new Error('down')
          }
        },
        progress: await savedCopy('CANDLE10')
      },
      ctxWith(null)
    )
    expect(result).toEqual({ ok: false, code: 'offers_unreadable' })
  })

  it('checks what is drawn: the offer section shows exactly that code at its percent', async () => {
    const progress = await savedCopy('CANDLE10')
    const copy = progress.copy as {
      draft: { blocks: { type: string; content: Record<string, unknown> }[] }
    }
    const banner = copy.draft.blocks.find((b) => b.type === 'offer_banner')!
    banner.content.headline = '50% off'
    expect(await design(progress)).toEqual({ ok: false, code: 'offer_unsafe' })
    banner.content.headline = '10% off'
    banner.content.code = 'OTHER'
    expect(await design(progress)).toEqual({ ok: false, code: 'offer_unsafe' })
    // An offer section without a code, or a code without one.
    const none = await savedCopy(null)
    expect(await design(none)).toEqual({ ok: false, code: 'offer_unsafe' })
    const bare = await savedCopy('CANDLE10')
    const draft = (bare.copy as { draft: { blocks: { type: string }[] } }).draft
    draft.blocks = draft.blocks.filter((b) => b.type !== 'offer_banner')
    expect(await design(bare)).toEqual({ ok: false, code: 'offer_unsafe' })
  })

  it('never stores an email whose code ends before it sends', async () => {
    const progress = await savedCopy('CANDLE10')
    const sections = progress.sections as {
      rules: { codes: { code: string; expiresAt: string | null }[] }
    }
    for (const c of sections.rules.codes)
      if (c.code === 'CANDLE10') c.expiresAt = '2020-01-01T00:00:00Z'
    expect(await design(progress)).toEqual({ ok: false, code: 'offer_unsafe' })
  })
})

describe('a build that started in time (REL-DAT)', () => {
  it('finishes its later steps even after the send time', async () => {
    const late = { clock: () => Date.parse('2099-01-01T00:00:00Z') }
    const progress = await savedSteps()
    const copy = await runBuildStep(
      'copy',
      { planned, store: await store(), offers: sampleOffers, progress },
      ctxWith(null, late)
    )
    expect(copy).toMatchObject({ ok: true, done: 'copy' })
  })
})
