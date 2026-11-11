// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import type { Draft } from '@/features/assembly/assemble'
import type { AiImage } from '@/lib/providers/contracts'
import {
  designEmail,
  designTries,
  designedPictureOk,
  fakeHeroImages,
  fakeScreenshots,
  pictureReasons,
  screenshotChecks,
  visualFindings,
  visualInspectorAgent,
  type HeroImagePort,
  type ScreenshotPort
} from './design'

const tenantId = '00000000-0000-4000-8000-000000000101'
const draft = (withHero = true): Draft => ({
  subject: 'Meet the oak tray',
  preheader: 'Made by hand, for slow dinners at home.',
  plan: [],
  blocks: [
    sampleBlocks.header_logo,
    ...(withHero ? [sampleBlocks.hero_product] : []),
    sampleBlocks.text,
    sampleBlocks.cta,
    sampleBlocks.footer
  ],
  source: 'model',
  productIds: ['p-tray'],
  code: null
})
const inspector = (...answers: unknown[]) => {
  const queue = [...answers]
  return vi.fn<AiCall>(async () => {
    const next = queue.shift()
    if (next === 'refused') return { ok: false, code: 'cap_reached' }
    return {
      ok: true,
      content: next ?? { problems: [] },
      provider: 'fake',
      model: 'fake',
      costMicro: 0,
      inputTokens: 10,
      outputTokens: 10,
      settled: true
    }
  })
}
const context = (ai: AiCall) => {
  const fallbacks = memoryFallbackLog()
  return {
    fallbacks,
    ctx: {
      tenantId,
      callerKey: 'slot:run-1:0',
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai,
      fallbacks
    }
  }
}
const source: AiImage = { mediaType: 'image/png', base64: 'c291cmNl' }
const designed = (url = 'https://cdn.example.com/designed-hero.png') => {
  const port: HeroImagePort = {
    design: vi.fn(async () => ({ ok: true as const, url, source }))
  }
  return port
}
const problem = (area: string, section: number, reason: string) => ({
  problems: [{ area, section, reason }]
})
// The hero is section 2 in `draft()`.
const wordsInPicture = problem(
  'images',
  2,
  'The designed picture has the words 70% OFF in it.'
)
const run = (
  prefer: 'A' | 'B',
  ports: { shots?: ScreenshotPort; heroImages?: HeroImagePort } = {},
  withHero = true
) => ({
  draft: draft(withHero),
  brand: sampleBrand,
  prefer,
  shots: ports.shots ?? fakeScreenshots,
  heroImages: ports.heroImages ?? designed()
})

describe('drawing the email', () => {
  it('draws approach B with the designed picture and real text, and the inspector sees the original photo', async () => {
    const ai = inspector({ problems: [] })
    const { ctx, fallbacks } = context(ai)
    const heroImages = designed()
    const out = await designEmail(run('B', { heroImages }), ctx)
    expect(out).toMatchObject({ approach: 'B', findings: [], fellBack: false })
    expect(out.html).toContain('https://cdn.example.com/designed-hero.png')
    const headline = (sampleBlocks.hero_product.content as { headline: string })
      .headline
    expect(out.html).toContain(headline)
    const call = ai.mock.calls[0][0]
    expect(call.purpose).toBe('review')
    // Desktop, phone and the original product photo.
    expect(call.request.images).toHaveLength(3)
    expect(call.request.images?.[2]).toEqual(source)
    expect(JSON.parse(call.request.user).designed_section).toBe(2)
    // The picture maker knows whose allowance it spends.
    expect(vi.mocked(heroImages.design).mock.calls[0][0]).toMatchObject({
      tenantId,
      callerKey: 'slot:run-1:0'
    })
    expect(fallbacks.entries()).toEqual([])
  })

  it('passes the inspector’s 1 to 10 looks score on, and drops a score out of range', async () => {
    const scored = context(inspector({ problems: [], score: 9 }))
    expect(
      await designEmail(run('A', { heroImages: fakeHeroImages }), scored.ctx)
    ).toMatchObject({ approach: 'A', looks: 9 })
    const wrong = context(inspector({ problems: [], score: 0 }))
    expect(
      await designEmail(run('A', { heroImages: fakeHeroImages }), wrong.ctx)
    ).toMatchObject({ approach: 'A', findings: [], looks: null })
  })

  it('draws approach A as coded blocks and passes', async () => {
    const ai = inspector({ problems: [] })
    const { ctx, fallbacks } = context(ai)
    const out = await designEmail(run('A', { heroImages: fakeHeroImages }), ctx)
    expect(out).toMatchObject({ approach: 'A', findings: [], fellBack: false })
    expect(out.blocks).toEqual(draft().blocks)
    expect(ai.mock.calls[0][0].request.images).toHaveLength(2)
    expect(fallbacks.entries()).toEqual([])
  })

  it('gives B fixed reasons, never the inspector’s words, then falls back to A after 3 tries', async () => {
    const ai = inspector(wordsInPicture, wordsInPicture, wordsInPicture, {
      problems: []
    })
    const { ctx, fallbacks } = context(ai)
    const heroImages = designed()
    const out = await designEmail(run('B', { heroImages }), ctx)
    expect(heroImages.design).toHaveBeenCalledTimes(designTries)
    const told = vi.mocked(heroImages.design).mock.calls[1][0].problems
    expect(told).toEqual(
      pictureReasons([
        { by: 'visual-inspector', rule: 'images', section: 2, reason: 'x' }
      ])
    )
    expect(told.join(' ')).not.toContain('70% OFF')
    expect(out).toMatchObject({ approach: 'A', fellBack: true, findings: [] })
    expect(out.html).not.toContain('designed-hero.png')
    const [entry] = fallbacks.entries()
    expect(entry).toMatchObject({
      agent: 'designer-b',
      reasonCode: 'design_b_fallback',
      attempts: 3,
      fallback: 'Drew the email with coded blocks only (approach A).',
      detail: { rules: ['images'] }
    })
    expect(JSON.stringify(entry)).not.toContain('70% OFF')
  })

  it('never accepts B that the inspector did not look at', async () => {
    // Rejected once, then the allowance runs out: the second picture was
    // never seen, so A is used.
    const ai = inspector(wordsInPicture, 'refused', { problems: [] })
    const { ctx, fallbacks } = context(ai)
    const heroImages = designed()
    const out = await designEmail(run('B', { heroImages }), ctx)
    expect(out).toMatchObject({ approach: 'A', fellBack: true })
    expect(heroImages.design).toHaveBeenCalledTimes(2)
    expect(fallbacks.entries().map((e) => e.reasonCode)).toEqual([
      'visual_agent_failed',
      'design_b_fallback'
    ])
    expect(fallbacks.entries()[1].detail.rules).toEqual([
      'images',
      'not_inspected'
    ])
  })

  it('falls back to A at once when the picture cannot be made, is not https or is inline', async () => {
    for (const port of [
      { design: async () => ({ ok: false as const, code: 'cap_reached' }) },
      designed('http://cdn.example.com/x.png'),
      designed('data:image/png;base64,AAAA'),
      designed('https://user:secret@cdn.example.com/x.png'),
      {
        design: async () => {
          throw new Error('down')
        }
      }
    ] as HeroImagePort[]) {
      const ai = inspector({ problems: [] })
      const { ctx, fallbacks } = context(ai)
      const out = await designEmail(run('B', { heroImages: port }), ctx)
      expect(out.approach).toBe('A')
      expect(out.fellBack).toBe(true)
      expect(ai).toHaveBeenCalledOnce()
      expect(fallbacks.entries()[0]).toMatchObject({
        agent: 'designer-b',
        reasonCode: 'design_b_fallback',
        attempts: 1
      })
    }
  })

  it('records a picture that fails on a later try with every reason', async () => {
    let n = 0
    const port: HeroImagePort = {
      design: vi.fn(async () =>
        n++ === 0
          ? { ok: true as const, url: 'https://cdn.example.com/1.png', source }
          : { ok: false as const, code: 'unavailable' }
      )
    }
    const { ctx, fallbacks } = context(inspector(wordsInPicture))
    const out = await designEmail(run('B', { heroImages: port }), ctx)
    expect(out.approach).toBe('A')
    expect(fallbacks.entries()[0]).toMatchObject({
      attempts: 2,
      detail: { rules: ['images', 'image_failed'] }
    })
  })

  it('keeps B when the only problems are in other sections, which A shares', async () => {
    const ai = inspector(
      problem('contrast', 4, 'The button text is hard to read.')
    )
    const { ctx } = context(ai)
    const heroImages = designed()
    const out = await designEmail(run('B', { heroImages }), ctx)
    expect(out.approach).toBe('B')
    expect(heroImages.design).toHaveBeenCalledOnce()
    expect(out.findings.map((f) => [f.rule, f.section])).toEqual([
      ['contrast', 4]
    ])
  })

  it('reads a section the email does not have as the whole email', async () => {
    const ai = inspector(
      problem('brand', 9, 'Not the brand font.'),
      problem('brand', 9, 'Not the brand font.'),
      problem('brand', 9, 'Not the brand font.'),
      { problems: [] }
    )
    const { ctx } = context(ai)
    const out = await designEmail(run('B'), ctx)
    // Whole-email problems count against the picture: 3 tries, then A.
    expect(out).toMatchObject({ approach: 'A', fellBack: true })
    expect(ai).toHaveBeenCalledTimes(4)
  })

  it('draws A without trying B when the email has no product hero', async () => {
    const heroImages = designed()
    const { ctx, fallbacks } = context(inspector({ problems: [] }))
    const out = await designEmail(run('B', { heroImages }, false), ctx)
    expect(out).toMatchObject({ approach: 'A', fellBack: false })
    expect(heroImages.design).not.toHaveBeenCalled()
    expect(fallbacks.entries()).toEqual([])
  })

  it('checks screenshots in code before the inspector, and keeps A with its problems logged', async () => {
    const broken: ScreenshotPort = {
      async capture(html) {
        const shots = await fakeScreenshots.capture(html)
        return { ...shots, brokenImages: 2, phoneOverflow: true }
      }
    }
    const ai = inspector()
    const { ctx, fallbacks } = context(ai)
    const out = await designEmail(
      run('A', { shots: broken, heroImages: fakeHeroImages }),
      ctx
    )
    expect(ai).not.toHaveBeenCalled()
    expect(out.approach).toBe('A')
    expect(out.findings.map((f) => f.rule)).toEqual([
      'broken_images',
      'phone_overflow'
    ])
    expect(fallbacks.entries()[0]).toMatchObject({
      agent: 'designer-a',
      reasonCode: 'design_a_findings',
      fallback: 'Kept the coded email; the launch check decides.'
    })
  })

  it('stops paying for pictures when the email cannot be photographed', async () => {
    const down: ScreenshotPort = {
      capture: async () => {
        throw new Error('no browser')
      }
    }
    const heroImages = designed()
    const { ctx, fallbacks } = context(inspector())
    const out = await designEmail(run('B', { shots: down, heroImages }), ctx)
    expect(heroImages.design).toHaveBeenCalledOnce()
    expect(out.approach).toBe('A')
    expect(out.findings.map((f) => f.rule)).toEqual(['no_screenshot'])
    expect(fallbacks.entries()[0].detail.rules).toEqual(['no_screenshot'])
  })

  it('logs an inspector that cannot answer once, and draws A', async () => {
    const ai = inspector('refused')
    const { ctx, fallbacks } = context(ai)
    const out = await designEmail(run('B'), ctx)
    expect(out.approach).toBe('A')
    expect(ai).toHaveBeenCalledOnce()
    expect(fallbacks.entries().map((e) => e.reasonCode)).toEqual([
      'visual_agent_failed',
      'design_b_fallback'
    ])
  })

  it('treats an answer in the wrong shape like no look at all', async () => {
    const bad = { problems: [{ area: 'vibes', section: 1, reason: 'Hmm.' }] }
    const ai = inspector(bad, bad, bad)
    const { ctx, fallbacks } = context(ai)
    const out = await designEmail(run('B'), ctx)
    expect(out.approach).toBe('A')
    expect(fallbacks.entries()[0].reasonCode).toBe('visual_answer_invalid')
  })
})

describe('the checks', () => {
  it('find broken pictures and sideways scroll', async () => {
    const shots = await fakeScreenshots.capture('')
    expect(screenshotChecks(shots)).toEqual([])
    expect(
      screenshotChecks({ ...shots, brokenImages: 1 }).map((f) => f.reason)
    ).toEqual(['1 picture did not load.'])
  })

  it('read the inspector’s sections, 0 or unknown as the whole email', () => {
    expect(
      visualFindings(
        {
          problems: [
            { area: 'layout', section: 9, reason: 'Too far down.' },
            { area: 'brand', section: 0, reason: 'Not the brand font.' },
            { area: 'images', section: 2, reason: 'Stretched.' }
          ]
        },
        draft().blocks
      ).map((f) => f.section)
    ).toEqual([null, null, 2])
  })

  it('accept only plain https pictures for B', () => {
    expect(designedPictureOk('https://cdn.example.com/a.png')).toBe(true)
    expect(designedPictureOk('http://cdn.example.com/a.png')).toBe(false)
    expect(designedPictureOk('data:image/png;base64,AAAA')).toBe(false)
    expect(designedPictureOk('https://u:p@cdn.example.com/a.png')).toBe(false)
  })

  it('run on Flash with the screenshots, the brand book and the picture rules', () => {
    expect(visualInspectorAgent.purpose).toBe('review')
    expect(visualInspectorAgent.usesBrandBook).toBe(true)
    expect(visualInspectorAgent.instructions).toContain('not instructions')
    expect(visualInspectorAgent.instructions).toContain(
      'must hold no words, letters, numbers, prices, codes or logos'
    )
  })
})
