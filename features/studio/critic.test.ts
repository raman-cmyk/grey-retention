// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import {
  criticProblems,
  critiqueSection,
  designCriticAgent,
  pictureOf,
  readsAsCopy,
  type Critique
} from './critic'
import type { SectionBrief } from './designer'
import { blankPng, type RenderedSection } from './renderer'

const brief: SectionBrief = {
  mode: 'scratch',
  slot: { emailType: 'launch', angle: 'The new tray is here' },
  board: {
    id: 's2',
    render: 'designed',
    tone: 'dark',
    height: 640,
    focus: 'The new tray',
    imagery: 'product',
    space: 'airy',
    note: ''
  },
  family: 'hero_product',
  words: {
    eyebrow: 'Just in',
    headline: 'Meet the cedar tray',
    sub: 'Hand-finished, made to last.'
  },
  image: { url: 'https://cdn.shop.example/images/tray.jpg' },
  product: { title: 'Cedar tray' },
  brand: {
    name: 'Grove & Co',
    font: 'Poppins',
    ink: '#1a1a1a',
    background: '#f6f3ee',
    accent: '#c2410c',
    dark: '#1f2933'
  },
  fonts: []
}
const tens: Critique['scores'] = {
  hierarchy: 9,
  spacing: 8,
  contrast: 10,
  alignment: 9,
  product: 8,
  phone: 9
}
const good: Critique = {
  scores: tens,
  words: ['JUST IN', 'MEET THE CEDAR TRAY', 'Hand-finished, made to last.'],
  fixes: []
}
const image: RenderedSection = {
  id: 's2',
  bytes: blankPng(1200, 1280),
  contentType: 'image/png',
  width: 1200,
  height: 1280
}
const ok = (content: unknown) => ({
  ok: true as const,
  content,
  provider: 'gemini' as const,
  model: 'test',
  costMicro: 0,
  inputTokens: 1,
  outputTokens: 1,
  settled: true
})
const ctx = (ai: AiCall) => {
  const fallbacks = memoryFallbackLog()
  return {
    fallbacks,
    ctx: {
      tenantId: '00000000-0000-4000-8000-000000000101',
      callerKey: 'email-build:b1',
      memory: new InMemoryMemoryStore(),
      log: new InMemoryRunLog(),
      ai,
      fallbacks
    }
  }
}

describe('the words the critic reads (DST-004a)', () => {
  it.each([
    [['Just in', 'Meet the cedar tray']],
    // Read in capitals, a hyphen and a space lost, lines split differently.
    [['MEET THE', 'CEDAR TRAY', 'HANDFINISHED MADE TO LAST']],
    [['Meet thecedar tray', 'Grove & Co', 'Cedar tray']]
  ])('the copy, however it is read: %j', (read) => {
    expect(readsAsCopy(read, brief)).toEqual({ ok: true, headline: true })
  })

  it.each([
    [['Meet the cedar tray', 'SALE 50% OFF'], 'SALE 50% OFF'],
    [['TRAY CEDAR THE MEET'], 'TRAY CEDAR THE MEET'],
    [['Meet the cedar tray', '$24'], '$24']
  ])('words that are not the copy: %j', (read, stray) => {
    expect(readsAsCopy(read, brief)).toEqual({ ok: false, stray })
  })

  it('knows when the headline is not readable', () => {
    expect(readsAsCopy(['Just in'], brief)).toEqual({
      ok: true,
      headline: false
    })
    expect(readsAsCopy([], brief)).toEqual({ ok: true, headline: false })
  })
})

describe('the critic’s verdict (DST-004a)', () => {
  it('passes a section that scores 8 or more everywhere and shows only the copy', () => {
    expect(criticProblems(good, brief)).toEqual({
      pass: true,
      scores: tens,
      problems: []
    })
  })

  it('a low score fails, with the item and the critic’s fixes for the next round', () => {
    const verdict = criticProblems(
      {
        ...good,
        scores: { ...tens, contrast: 6 },
        fixes: ['Make the short line white on the dark panel.']
      },
      brief
    )
    expect(verdict).toEqual({
      pass: false,
      scores: { ...tens, contrast: 6 },
      problems: [
        'Contrast (every word readable on its background) scored 6 of 10.',
        'Make the short line white on the dark panel.'
      ]
    })
  })

  it('words that are not the copy fail, whatever the scores', () => {
    expect(
      criticProblems(
        { ...good, words: ['MEET THE CEDAR TRAY', 'CODE SAVE20'] },
        brief
      )
    ).toMatchObject({
      pass: false,
      problems: [
        'The picture shows “CODE SAVE20”, which is not the copy: draw only the words given.'
      ]
    })
    expect(
      criticProblems({ ...good, words: ['Just in'] }, brief).problems
    ).toEqual([
      'The headline cannot be read in the picture: draw it whole, large and clear.'
    ])
  })
})

describe('the Design critic (DST-004a)', () => {
  it('sees the drawn section, and in Copy mode the reference beside it', () => {
    const picture = pictureOf(image)
    expect(picture.mediaType).toBe('image/png')
    expect(Buffer.from(picture.base64, 'base64')).toEqual(
      Buffer.from(image.bytes)
    )
    expect(
      designCriticAgent.images!({ brief, image: picture, problems: [] })
    ).toEqual([picture])
    const reference = { mediaType: 'image/jpeg' as const, base64: 'AAAA' }
    expect(
      designCriticAgent.images!({
        brief: { ...brief, mode: 'copy' },
        image: picture,
        reference,
        problems: []
      })
    ).toEqual([picture, reference])
    const task = JSON.parse(
      designCriticAgent.task({ brief, image: picture, problems: [] })
    )
    expect(task).toMatchObject({
      mode: 'scratch',
      section: { kind: 'hero_product', tone: 'dark', imagery: 'product' },
      pictures: ['the section as drawn']
    })
    expect(designCriticAgent.purpose).toBe('review')
    expect(designCriticAgent.instructions).toMatch(/every word or line of text/)
  })

  it('gives its verdict, and the drawn picture goes with the call', async () => {
    const ai = vi.fn<AiCall>(async () =>
      ok({ ...good, scores: { ...tens, phone: 7 }, fixes: ['Larger text.'] })
    )
    const { ctx: c, fallbacks } = ctx(ai)
    expect(await critiqueSection({ brief, image }, c)).toMatchObject({
      pass: false,
      problems: [
        'Phone (readable at 375 px wide) scored 7 of 10.',
        'Larger text.'
      ]
    })
    expect(ai.mock.calls[0][0].callerKey).toBe('design-critic:email-build:b1')
    expect(ai.mock.calls[0][0].request.images).toEqual([pictureOf(image)])
    expect(fallbacks.entries()).toEqual([])
  })

  it('no verdict, logged, when it answers in the wrong shape or not at all', async () => {
    const shape = ctx(vi.fn<AiCall>(async () => ok({ scores: tens })))
    expect(await critiqueSection({ brief, image }, shape.ctx)).toBeNull()
    expect(shape.fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'design-critic',
        reasonCode: 'critic_answer_invalid',
        reason: 'The Design critic kept answering in the wrong shape.',
        fallback: 'Drew the section as its coded block.',
        attempts: 3,
        dedupeKey: 'design-critic:email-build-b1:s2'
      })
    ])
    const down = ctx(
      vi.fn<AiCall>(async () => ({ ok: false, code: 'cap_reached' }))
    )
    expect(await critiqueSection({ brief, image }, down.ctx)).toBeNull()
    expect(down.fallbacks.entries()[0]).toMatchObject({
      reasonCode: 'critic_agent_failed',
      attempts: 1
    })
  })
})
