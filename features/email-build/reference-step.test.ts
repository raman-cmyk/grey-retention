// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import type { ReferenceEmail } from '@/features/studio/reference'
import { sectionsStep, type BuildCtx, type PlannedEmail } from './build'
import { sampleOffers, sampleStoreSource } from './ports'

// DST-002b part b2b: the sections step follows the owner's Copy or Remix.
const tenantId = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const planned = (over: Partial<PlannedEmail> = {}): PlannedEmail => ({
  date: inDays(2),
  time: '10:00',
  emailType: 'offer',
  angle: 'The candle people love, for less',
  products: [
    { id: 'p-cedar-candle', title: 'Cedar candle' },
    { id: 'p-linen-throw', title: 'Linen throw' }
  ],
  offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 },
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' },
  ...over
})
const reference = (over: Partial<ReferenceEmail> = {}): ReferenceEmail => ({
  id: 'ref-1',
  brandId: 'pine',
  brand: 'Pine & Co',
  synthetic: true,
  subject: 'The cedar sale',
  industry: 'home',
  emailType: 'sale',
  angle: 'urgency',
  receivedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  winner: false,
  sections: [
    { blockType: 'hero_image', height: 640, styles: ['dark'] },
    { blockType: 'offer_banner', height: 120, purpose: 'offer' },
    { blockType: 'product_grid_2col', height: 700 },
    { blockType: 'footer', height: 200 }
  ],
  ...over
})

async function run(
  ref: BuildCtx['reference'],
  over: Partial<PlannedEmail> = {},
  ai?: AiCall
) {
  const fallbacks = memoryFallbackLog()
  const store = await sampleStoreSource.read(tenantId)
  const made = await sectionsStep(
    { planned: planned(over), store, offers: sampleOffers },
    {
      tenantId,
      callerKey: 'email-build:b1',
      fallbacks,
      ...(ref ? { reference: ref } : {}),
      ...(ai
        ? {
            agents: {
              memory: new InMemoryMemoryStore(),
              log: new InMemoryRunLog(),
              ai
            }
          }
        : {})
    }
  )
  if (!made.ok) throw new Error(made.code)
  return { output: made.output, log: fallbacks.entries() }
}
const loads = (emails: ReferenceEmail[]) => async () => ({
  emails,
  followed: new Set<string>()
})

describe('the sections step and the owner’s mode (DST-002b)', () => {
  it('copies the picked inbox email’s order, and keeps what it picked and why', async () => {
    const { output, log } = await run({
      mode: 'copy',
      load: loads([reference()])
    })
    expect(output.layout.mode).toBe('copy')
    expect(output.layout.source).toBe('copy')
    // The sample store has no lifestyle photo, and two products: the photo
    // hero's stand-in is a product hero, the grid's one product shown big
    // (EML-001's stand-ins).
    expect(output.layout.sections.map((s) => s.family)).toEqual([
      'header_logo',
      'hero_product',
      'offer_banner',
      'product_feature',
      'footer'
    ])
    // Each copied section knows its place in the reference.
    expect(output.layout.sections.map((s) => s.source)).toEqual([
      undefined,
      0,
      1,
      2,
      undefined
    ])
    expect(output.reference).toMatchObject({
      emailId: 'ref-1',
      mode: 'copy',
      refIndex: [0, 1, 2, null]
    })
    expect(output.reference?.reason).toMatch(
      /^We copy Pine & Co’s email “The cedar sale”/
    )
    expect(output.reference?.reference.map((r) => r.family)).toEqual([
      'hero_image',
      'offer_banner',
      'product_grid_2col'
    ])
    expect(log).toEqual([])
  })

  it('makes it from scratch, and says why, when no inbox email fits', async () => {
    const { output, log } = await run({
      mode: 'copy',
      load: loads([reference({ industry: 'pet', emailType: 'story' })])
    })
    expect(output.layout.mode).toBe('scratch')
    expect(output).not.toHaveProperty('reference')
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      agent: 'art-director',
      reasonCode: 'reference_none',
      fallback: 'No reference email was used.',
      detail: { mode: 'copy' }
    })
    expect(log[0].reason).toMatch(
      /^None of the emails from the brands you follow is a home email or an offer email/
    )
  })

  it('makes it from scratch when the inbox cannot be read', async () => {
    const { output, log } = await run({
      mode: 'copy',
      load: async () => {
        throw new Error('reference_email_read_failed')
      }
    })
    expect(output.layout.mode).toBe('scratch')
    expect(log.map((e) => e.reasonCode)).toEqual(['reference_unreadable'])
    expect(log[0].reason).toBe(
      'The Inspiration inbox could not be read just now, so this email is designed from scratch.'
    )
  })

  it('remixes only with the AI email planner: without it, from scratch and said', async () => {
    let read = false
    const { output, log } = await run({
      mode: 'remix',
      load: async () => {
        read = true
        return { emails: [reference()], followed: new Set() }
      }
    })
    expect(output.layout.mode).toBe('scratch')
    expect(read).toBe(false)
    expect(log.map((e) => e.reasonCode)).toEqual(['reference_remix_no_ai'])
  })

  it('copies an email with an offer only from one that shows an offer', async () => {
    const noOffer = reference({
      sections: [
        { blockType: 'hero_image', height: 640 },
        { blockType: 'product_grid_2col', height: 700 },
        { blockType: 'text', height: 200 }
      ]
    })
    const none = await run({ mode: 'copy', load: loads([noOffer]) })
    expect(none.output.layout.mode).toBe('scratch')
    expect(none.log.map((e) => e.reasonCode)).toEqual(['reference_no_offer'])
    // An email without an offer may copy it.
    const plain = await run(
      { mode: 'copy', load: loads([noOffer]) },
      { offer: null }
    )
    expect(plain.output.reference?.emailId).toBe('ref-1')
    // The one that shows an offer is picked over a newer one that does not.
    const both = await run({
      mode: 'copy',
      load: loads([
        { ...noOffer, id: 'newer', receivedAt: new Date().toISOString() },
        reference()
      ])
    })
    expect(both.output.reference?.emailId).toBe('ref-1')
  })

  it('does not copy an email whose offer is only on its hero', async () => {
    const heroOffer = reference({
      sections: [
        { blockType: 'hero_image', height: 640, purpose: 'offer' },
        { blockType: 'product_grid_2col', height: 700 },
        { blockType: 'text', height: 200 }
      ]
    })
    const { output, log } = await run({
      mode: 'copy',
      load: loads([heroOffer])
    })
    expect(output).not.toHaveProperty('reference')
    expect(log.map((e) => e.reasonCode)).toEqual(['reference_no_offer'])
  })

  it('keeps the offer when a long email is cut to 12 blocks', async () => {
    const long = reference({
      sections: [
        ...Array.from({ length: 14 }, () => ({
          blockType: 'text',
          height: 200
        })),
        { blockType: 'offer_banner', height: 120, purpose: 'offer' },
        { blockType: 'footer', height: 200 }
      ]
    })
    const { output } = await run({ mode: 'copy', load: loads([long]) })
    expect(output.reference?.emailId).toBe('ref-1')
    expect(output.layout.sections.length).toBeLessThanOrEqual(12)
    expect(output.layout.sections.map((s) => s.family)).toContain(
      'offer_banner'
    )
  })

  it('never copies more than an email’s 12 blocks', async () => {
    const long = reference({
      sections: [
        { blockType: 'offer_banner', height: 120, purpose: 'offer' },
        ...Array.from({ length: 14 }, () => ({
          blockType: 'text',
          height: 200
        })),
        { blockType: 'footer', height: 200 }
      ]
    })
    const { output } = await run({ mode: 'copy', load: loads([long]) })
    expect(output.layout.sections.length).toBeLessThanOrEqual(12)
    expect(output.layout.sections[0].family).toBe('header_logo')
    expect(output.layout.sections.at(-1)?.family).toBe('footer')
    expect(
      output.layout.dropped.some((d) => /at most 12 blocks/.test(d.reason))
    ).toBe(true)
  })

  it('remixes the idea of an email with one, when the planner answers', async () => {
    // The planner's answer: the safe plan's own variants.
    const safe = (await run(undefined)).output.layout.sections
    const answer = {
      sections: safe.map((s) => ({
        variantId: s.variantId,
        purpose: s.purpose
      }))
    }
    const ai = vi.fn<AiCall>(async () => ({
      ok: true,
      content: answer,
      provider: 'fake',
      model: 'fake',
      costMicro: 0,
      inputTokens: 10,
      outputTokens: 10,
      settled: true
    }))
    const { output, log } = await run(
      { mode: 'remix', load: loads([reference()]) },
      {},
      ai
    )
    expect(output.layout).toMatchObject({ mode: 'remix', source: 'agent' })
    expect(output.reference?.mode).toBe('remix')
    expect(output.reference?.reason).toMatch(/^We remix Pine & Co’s email/)
    const sent = JSON.parse(ai.mock.calls[0][0].request.user)
    expect(sent.strategyNote).toBe('urgency')
    expect(log).toEqual([])
  })

  it('makes a remix from scratch when the planner could not remix it, or the email has no idea', async () => {
    const failing = vi.fn<AiCall>(async () => ({
      ok: false,
      code: 'cap_reached'
    }))
    const fell = await run(
      { mode: 'remix', load: loads([reference()]) },
      {},
      failing
    )
    expect(fell.output.layout.mode).toBe('scratch')
    expect(fell.output).not.toHaveProperty('reference')
    expect(fell.log.map((e) => e.reasonCode)).toContain(
      'reference_remix_planner'
    )
    const idea = await run(
      { mode: 'remix', load: loads([reference({ angle: null })]) },
      {},
      failing
    )
    expect(idea.output).not.toHaveProperty('reference')
    expect(idea.log.map((e) => e.reasonCode)).toContain('reference_no_idea')
  })

  it('keeps the read’s code, never its words, when the inbox cannot be read', async () => {
    const { log } = await run({
      mode: 'copy',
      load: async () => {
        throw new Error('secret words', { cause: { code: 'PGRST301' } })
      }
    })
    expect(log[0].detail).toEqual({ mode: 'copy', cause: 'PGRST301' })
    expect(JSON.stringify(log[0])).not.toContain('secret words')
  })

  it('leaves a text email and a Scratch build as they were', async () => {
    let read = false
    const loader = async () => {
      read = true
      return { emails: [reference()], followed: new Set<string>() }
    }
    const text = await run({ mode: 'copy', load: loader }, { format: 'text' })
    expect(text.output).not.toHaveProperty('reference')
    expect(text.log).toEqual([])
    const scratch = await run(undefined)
    expect(scratch.output.layout.mode).toBe('scratch')
    expect(scratch.output).not.toHaveProperty('reference')
    expect(read).toBe(false)
  })
})
