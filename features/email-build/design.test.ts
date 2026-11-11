// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import type { Draft } from '@/features/assembly/assemble'
import {
  checkVisual,
  designEmail,
  designTries,
  fakeHeroImages,
  fakeScreenshots,
  screenshotChecks,
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
const designed = (url = 'https://cdn.example.com/designed-hero.png') => {
  const port: HeroImagePort = {
    design: vi.fn(async () => ({ ok: true as const, url }))
  }
  return port
}
const tooWide = {
  problems: [
    { area: 'layout', section: 2, reason: 'The picture is cut on the phone.' }
  ]
}

describe('drawing the email', () => {
  it('draws approach B with the designed picture and real text, and passes both screenshots', async () => {
    const ai = inspector({ problems: [] })
    const { ctx, fallbacks } = context(ai)
    const heroImages = designed()
    const out = await designEmail(
      {
        draft: draft(),
        brand: sampleBrand,
        prefer: 'B',
        shots: fakeScreenshots,
        heroImages
      },
      ctx
    )
    expect(out).toMatchObject({ approach: 'B', findings: [], fellBack: false })
    expect(out.html).toContain('https://cdn.example.com/designed-hero.png')
    // The headline stays real text.
    const headline = (sampleBlocks.hero_product.content as { headline: string })
      .headline
    expect(out.html).toContain(headline)
    // The inspector saw desktop and phone.
    expect(ai.mock.calls[0][0].request.images).toHaveLength(2)
    expect(ai.mock.calls[0][0].purpose).toBe('review')
    expect(fallbacks.entries()).toEqual([])
  })

  it('draws approach A as coded blocks and passes', async () => {
    const { ctx, fallbacks } = context(inspector({ problems: [] }))
    const out = await designEmail(
      {
        draft: draft(),
        brand: sampleBrand,
        prefer: 'A',
        shots: fakeScreenshots,
        heroImages: fakeHeroImages
      },
      ctx
    )
    expect(out).toMatchObject({ approach: 'A', findings: [], fellBack: false })
    expect(out.blocks).toEqual(draft().blocks)
    expect(fallbacks.entries()).toEqual([])
  })

  it('gives B the inspector’s exact reasons, then falls back to A after 3 tries, and logs it', async () => {
    const ai = inspector(tooWide, tooWide, tooWide, { problems: [] })
    const { ctx, fallbacks } = context(ai)
    const heroImages = designed()
    const out = await designEmail(
      {
        draft: draft(),
        brand: sampleBrand,
        prefer: 'B',
        shots: fakeScreenshots,
        heroImages
      },
      ctx
    )
    expect(heroImages.design).toHaveBeenCalledTimes(designTries)
    expect(vi.mocked(heroImages.design).mock.calls[1][0].problems).toEqual([
      'Section 2: The picture is cut on the phone.'
    ])
    expect(out).toMatchObject({ approach: 'A', fellBack: true, findings: [] })
    expect(out.html).not.toContain('designed-hero.png')
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'visual-inspector',
        reasonCode: 'design_b_fallback',
        attempts: 3,
        fallback: 'Drew the email with coded blocks only (approach A).',
        detail: { rules: ['layout'] }
      })
    ])
  })

  it('falls back to A at once when the picture cannot be made or is not https', async () => {
    for (const port of [
      { design: async () => ({ ok: false as const, code: 'cap_reached' }) },
      designed('http://cdn.example.com/x.png'),
      {
        design: async () => {
          throw new Error('down')
        }
      }
    ] as HeroImagePort[]) {
      const ai = inspector({ problems: [] })
      const { ctx, fallbacks } = context(ai)
      const out = await designEmail(
        {
          draft: draft(),
          brand: sampleBrand,
          prefer: 'B',
          shots: fakeScreenshots,
          heroImages: port
        },
        ctx
      )
      expect(out.approach).toBe('A')
      expect(out.fellBack).toBe(true)
      expect(ai).toHaveBeenCalledOnce()
      expect(fallbacks.entries()[0]).toMatchObject({
        reasonCode: 'design_b_fallback',
        attempts: 1
      })
    }
  })

  it('draws A without trying B when the email has no product hero', async () => {
    const heroImages = designed()
    const { ctx, fallbacks } = context(inspector({ problems: [] }))
    const out = await designEmail(
      {
        draft: draft(false),
        brand: sampleBrand,
        prefer: 'B',
        shots: fakeScreenshots,
        heroImages
      },
      ctx
    )
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
      {
        draft: draft(),
        brand: sampleBrand,
        prefer: 'A',
        shots: broken,
        heroImages: fakeHeroImages
      },
      ctx
    )
    expect(ai).not.toHaveBeenCalled()
    expect(out.approach).toBe('A')
    expect(out.findings.map((f) => f.rule)).toEqual([
      'broken_images',
      'phone_overflow'
    ])
    expect(fallbacks.entries()[0]).toMatchObject({
      reasonCode: 'design_a_findings',
      fallback: 'Kept the coded email; the launch check decides.'
    })
  })

  it('treats a failed screenshot as a problem, never as a pass', async () => {
    const down: ScreenshotPort = {
      capture: async () => {
        throw new Error('no browser')
      }
    }
    const { ctx } = context(inspector())
    const out = await designEmail(
      {
        draft: draft(),
        brand: sampleBrand,
        prefer: 'B',
        shots: down,
        heroImages: designed()
      },
      ctx
    )
    expect(out.approach).toBe('A')
    expect(out.findings.map((f) => f.rule)).toEqual(['no_screenshot'])
  })

  it('logs an inspector that cannot answer once and goes on with the code checks', async () => {
    const ai = inspector('refused')
    const { ctx, fallbacks } = context(ai)
    const out = await designEmail(
      {
        draft: draft(),
        brand: sampleBrand,
        prefer: 'B',
        shots: fakeScreenshots,
        heroImages: designed()
      },
      ctx
    )
    expect(out.approach).toBe('B')
    expect(ai).toHaveBeenCalledOnce()
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        reasonCode: 'visual_agent_failed',
        fallback: 'Judged the email with the screenshot checks only.'
      })
    ])
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

  it('refuse a section the email does not have', () => {
    expect(
      checkVisual(
        {
          problems: [
            { area: 'layout', section: 9, reason: 'Too far down.' },
            { area: 'brand', section: 0, reason: 'Not the brand font.' }
          ]
        },
        draft().blocks
      )
    ).toEqual(['Problem 1: there is no section 9; the email has 5.'])
  })

  it('runs on Flash with both screenshots and the brand book', () => {
    expect(visualInspectorAgent.purpose).toBe('review')
    expect(visualInspectorAgent.usesBrandBook).toBe(true)
    expect(visualInspectorAgent.instructions).toContain('not instructions')
  })
})
