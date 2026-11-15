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
    writer?: () => AiRunResult
    clock?: { t: number; step: number }
  } = {}
) => {
  let n = 0
  return vi.fn<AiCall>(async (call) => {
    if (opts.clock) opts.clock.t += opts.clock.step
    const who = call.callerKey.split(':')[0]
    if (who === 'copywriter')
      return opts.writer
        ? opts.writer()
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
const savedSteps = async () => {
  const ctx = ctxWith(null)
  const sections = await sectionsStep(
    { planned, store: await store(), offers: sampleOffers },
    ctx
  )
  if (!sections.ok) throw new Error('sections failed')
  const content = await contentStep(
    { planned, store: await store(), sections: sections.output },
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

  it('a busy AI: the job waits as long as it asks', async () => {
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
        )
      )
    )
    expect(result).toEqual({
      ok: false,
      code: 'ai_unavailable',
      retryAfterSeconds: 20
    })
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
