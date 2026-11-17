// @vitest-environment node
import { describe, expect, it } from 'vitest'
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
  over: Partial<PlannedEmail> = {}
) {
  const fallbacks = memoryFallbackLog()
  const store = await sampleStoreSource.read(tenantId)
  const made = await sectionsStep(
    { planned: planned(over), store, offers: sampleOffers },
    {
      tenantId,
      callerKey: 'email-build:b1',
      fallbacks,
      ...(ref ? { reference: ref } : {})
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
      fallback: 'Designed from scratch.',
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
