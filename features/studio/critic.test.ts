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
  texts: ['JUST IN', 'MEET THE CEDAR TRAY', 'Hand-finished, made to last.'],
  photoText: [],
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
    // Capitals, a lost hyphen, a space lost or added inside a phrase.
    [['MEET THE CEDAR TRAY', 'HANDFINISHED, MADE TO LAST']],
    [['Meet thecedar tray', 'Grove & Co', 'Cedar tray']],
    [['Meet the ce dar tray']],
    // Side by side: blocks in any order.
    [['CEDAR TRAY', 'Meet the cedar tray', 'Just in']],
    // A headline the critic split into two blocks.
    [['MEET THE', 'CEDAR TRAY']],
    // Lone dashes and bullets are decoration.
    [['Just in —', '• Meet the cedar tray']]
  ])('the copy, however it is read: %j', (read) => {
    expect(readsAsCopy(read, brief)).toEqual({ ok: true, headline: true })
  })

  const offer = {
    ...brief,
    words: {
      eyebrow: 'Up to 20% off',
      headline: 'Meet the cedar tray',
      sub: 'Now 2.5x stronger'
    }
  }
  it.each([
    [['Meet the cedar tray', 'SALE 50% OFF'], 'sale 50% off'],
    [['TRAY CEDAR THE MEET'], 'tray cedar the meet'],
    [['Meet the cedar tray', 'Up to $20 off'], 'up to $20 off'],
    [['Meet the cedar tray', 'Up to -20 off'], 'up to -20 off'],
    [['Meet the cedar tray', 'Now 25x stronger'], 'now 25x stronger'],
    [['Meet the cedar tray', '★★★★★'], '★★★★★'],
    [['Meet the cedar tray', '🔥'], '🔥']
  ])('words that are not the copy, every mark counted: %j', (read, stray) => {
    expect(readsAsCopy(read, offer)).toEqual({ ok: false, stray })
  })

  it('never joins two phrases into one word', () => {
    const top = {
      ...brief,
      words: { headline: 'Top 10', sub: '0 plastic, all cedar' }
    }
    expect(readsAsCopy(['Top 10', '0 plastic, all cedar'], top)).toEqual({
      ok: true,
      headline: true
    })
    expect(readsAsCopy(['Top 100 plastic, all cedar'], top)).toMatchObject({
      ok: false
    })
  })

  it('folds case as capitals do', () => {
    const german = {
      ...brief,
      words: { headline: 'Die neue Straße' }
    }
    expect(readsAsCopy(['DIE NEUE STRASSE'], german)).toEqual({
      ok: true,
      headline: true
    })
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
    expect(criticProblems(good, brief, false)).toEqual({
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
      brief,
      false
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

  it('words that are not the copy fail, whatever the scores, and with low scores every problem is kept', () => {
    expect(
      criticProblems(
        { ...good, texts: ['MEET THE CEDAR TRAY', 'CODE SAVE20'] },
        brief,
        false
      )
    ).toMatchObject({
      pass: false,
      problems: [
        'The picture shows “code save20”, which is not the copy: draw only the words given.'
      ]
    })
    expect(
      criticProblems({ ...good, texts: ['Just in'] }, brief, false).problems
    ).toEqual([
      'The headline cannot be read in the picture: draw it whole, large and clear.'
    ])
    const worst = criticProblems(
      {
        scores: {
          hierarchy: 1,
          spacing: 1,
          contrast: 1,
          alignment: 1,
          product: 1,
          phone: 1
        },
        texts: ['SALE'],
        photoText: [],
        fixes: ['a1', 'b1', 'c1', 'd1', 'e1', 'f1'].map((f) => `Fix ${f}.`)
      },
      brief,
      false
    )
    expect(worst.problems).toHaveLength(13)
    expect(worst.problems.at(-1)).toBe('Fix f1.')
  })

  it('leaves out the photo’s own print only when the critic had the photo', () => {
    const printed = { ...good, photoText: ['100% FSC OAK'] }
    expect(criticProblems(printed, brief, true).pass).toBe(true)
    expect(criticProblems(printed, brief, false).problems).toEqual([
      'The picture shows “100% fsc oak”, which is not the copy: draw only the words given.'
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
    const photo = { mediaType: 'image/jpeg' as const, base64: 'BBBB' }
    expect(
      designCriticAgent.images!({
        brief,
        image: picture,
        reference,
        photo,
        problems: []
      })
    ).toEqual([picture, reference, photo])
    const task = JSON.parse(
      designCriticAgent.task({ brief, image: picture, photo, problems: [] })
    )
    expect(task).toMatchObject({
      mode: 'scratch',
      section: { kind: 'hero_product', tone: 'dark', imagery: 'product' },
      pictures: ['the section as drawn', 'the original photo']
    })
    expect(designCriticAgent.purpose).toBe('review')
    expect(designCriticAgent.instructions).toMatch(/never read or repeat/)
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

  it('asks again after a wrong shape, with the problem sent back, and takes a later answer', async () => {
    const ai = vi
      .fn<AiCall>()
      .mockResolvedValueOnce(ok({ scores: tens }))
      .mockResolvedValueOnce(ok(good))
    const { ctx: c } = ctx(ai)
    expect(await critiqueSection({ brief, image }, c)).toMatchObject({
      pass: true
    })
    expect(
      JSON.parse(ai.mock.calls[1][0].request.user)
        .fix_these_problems_from_your_last_answer
    ).toEqual(['The answer did not match the required JSON shape.'])
  })

  it('in Copy mode sends the reference and the photo, and takes the photo’s print', async () => {
    const reference = { mediaType: 'image/jpeg' as const, base64: 'AAAA' }
    const photo = { mediaType: 'image/jpeg' as const, base64: 'BBBB' }
    const ai = vi.fn<AiCall>(async () =>
      ok({ ...good, photoText: ['GROVE OAK 100%'] })
    )
    const { ctx: c } = ctx(ai)
    expect(
      await critiqueSection(
        { brief: { ...brief, mode: 'copy' }, image, reference, photo },
        c
      )
    ).toMatchObject({ pass: true })
    expect(ai.mock.calls[0][0].request.images).toEqual([
      pictureOf(image),
      reference,
      photo
    ])
  })

  it('takes no time limit from the caller', async () => {
    const ai = vi
      .fn<AiCall>()
      .mockResolvedValueOnce(ok({ scores: tens }))
      .mockResolvedValueOnce(ok(good))
    const { ctx: c, fallbacks } = ctx(ai)
    const withFits = { ...c, fits: () => false }
    expect(await critiqueSection({ brief, image }, withFits)).toMatchObject({
      pass: true
    })
    expect(ai).toHaveBeenCalledTimes(2)
    expect(fallbacks.entries()).toEqual([])
  })

  it('refuses a picture of another section, or one too large', async () => {
    const { ctx: c } = ctx(vi.fn<AiCall>())
    await expect(
      critiqueSection({ brief, image: { ...image, id: 's3' } }, c)
    ).rejects.toThrow('another section')
    await expect(
      critiqueSection(
        {
          brief,
          image,
          reference: {
            mediaType: 'image/jpeg',
            base64: 'A'.repeat(4 * 1024 * 1024 + 4)
          }
        },
        c
      )
    ).rejects.toThrow('too large')
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
      reason:
        'The Design critic could not answer (AI unavailable or the allowance is used up).',
      attempts: 1,
      detail: { section: 's2', runId: expect.any(String) }
    })
    // Fixed words only: never the copy.
    expect(JSON.stringify(down.fallbacks.entries())).not.toMatch(/cedar/i)
  })
})
