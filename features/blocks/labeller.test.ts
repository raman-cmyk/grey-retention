import { describe, expect, it, vi } from 'vitest'
import { blockTypes } from './catalog'
import {
  checkedLabel,
  confidentFrom,
  labelRequest,
  labelSchema,
  labelSection,
  LabelError,
  sampleLabel,
  type RunAi,
  sectionFacts
} from './labeller'
import { renderBlock } from './render'
import { sampleBlocks, sampleBrand } from './samples'

// runAi answering with the AI port's fake (no live model switched on).
const sample: RunAi = async () => ({
  ok: true,
  content: { fixture: true },
  provider: 'fake'
})
const live = (content: unknown) => {
  const run = vi.fn<RunAi>(async () => ({
    ok: true,
    content,
    provider: 'gemini'
  }))
  return { ai: run, provider: { generate: run } }
}

describe('sectionFacts', () => {
  it('counts what a section holds from the parsed HTML', () => {
    const f = sectionFacts(
      '<table><tr><td><img src="a.png" alt="A"><a href="https://x.example">Shop</a></td><td><p>Throw $89 <s>$110</s> — 20% off ★★★</p></td></tr></table>'
    )
    expect(f).toMatchObject({
      images: 1,
      links: 1,
      prices: 2,
      percents: 1,
      stars: 3,
      columns: 2,
      rows: 1
    })
    expect(f.text).toContain('Throw $89')
  })

  it('ignores scripts, styles and empty links', () => {
    const f = sectionFacts(
      '<style>.x{}</style><script>alert("$9")</script><a>no href</a><p>Hello</p>'
    )
    expect(f).toMatchObject({ links: 0, prices: 0 })
    expect(f.text).not.toMatch(/alert|\$9|\.x/)
  })
})

describe('the sample labeller', () => {
  it('names every one of our own 20 sample blocks correctly', () => {
    for (const type of blockTypes)
      expect(
        sampleLabel(sectionFacts(renderBlock(sampleBlocks[type], sampleBrand)))
          .type,
        type
      ).toBe(type)
  })

  it('is unsure about an empty or odd section', () => {
    expect(sampleLabel(sectionFacts('<div></div>')).type).toBe('unsure')
  })
})

describe('labelSection', () => {
  it('uses the sample rules, and says so, when no live AI is on', async () => {
    expect(
      await labelSection(
        { html: renderBlock(sampleBlocks.faq, sampleBrand) },
        sample
      )
    ).toMatchObject({ type: 'faq', source: 'sample' })
  })

  it('asks the model with the fixed list', async () => {
    const { ai, provider } = live({ type: 'hero_image', confidence: 0.92 })
    expect(await labelSection({ html: '<p>Hello</p>' }, ai)).toEqual({
      type: 'hero_image',
      confidence: 0.92,
      source: 'model'
    })
    const request = provider.generate.mock.calls[0][0]
    expect(request).toMatchObject({
      responseKind: 'json',
      temperature: 0
    })
    for (const type of blockTypes)
      expect(request.system).toContain(`- ${type}:`)
    expect(request.system).not.toMatch(/countdown/i)
  })

  it('never accepts a type outside the list, or a weak answer', async () => {
    expect(
      (
        await labelSection(
          { html: 'x' },
          live({ type: 'countdown', confidence: 0.99 }).ai
        )
      ).type
    ).toBe('unsure')
    expect(
      (
        await labelSection(
          { html: 'x' },
          live({ type: 'hero_image', confidence: confidentFrom - 0.01 }).ai
        )
      ).type
    ).toBe('unsure')
    expect(checkedLabel({ type: 'hero_image', confidence: 7 })).toEqual({
      type: 'hero_image',
      confidence: 1
    })
    expect(checkedLabel(null)).toEqual({ type: 'unsure', confidence: 0 })
    expect(checkedLabel({ type: 'toString', confidence: 1 }).type).toBe(
      'unsure'
    )
  })

  it('passes provider failures on instead of guessing', async () => {
    const failing: RunAi = async () => ({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 30
    })
    await expect(labelSection({ html: 'x' }, failing)).rejects.toBeInstanceOf(
      LabelError
    )
    await expect(labelSection({ html: 'x' }, failing)).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSeconds: 30
    })
    await expect(
      labelSection({ html: 'x' }, live('just text').ai)
    ).rejects.toMatchObject({
      code: 'invalid_output'
    })
  })

  it('sends a bounded request with the text capped', () => {
    const request = labelRequest({ html: `<p>${'word '.repeat(5000)}</p>` })
    expect(request.user.length).toBeLessThan(2_400)
    expect(request).not.toHaveProperty('images')
    expect(labelSchema.definition.properties.type.enum).toEqual([
      ...blockTypes,
      'unsure'
    ])
  })
})
