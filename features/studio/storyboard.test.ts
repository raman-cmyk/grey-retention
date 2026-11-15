// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import {
  artDirectorAgent,
  codeStoryboard,
  emailHeight,
  storyboardFor,
  storyboardProblems,
  type StoryboardInput,
  type StoryboardSection
} from './storyboard'

const launch: StoryboardInput = {
  mode: 'scratch',
  slot: { emailType: 'launch', angle: 'The new oak tray' },
  sections: [
    { id: 's1', family: 'header_logo', purpose: 'The logo.', products: 0 },
    { id: 's2', family: 'hero_product', purpose: 'The new tray.', products: 1 },
    {
      id: 's3',
      family: 'text',
      purpose: 'Why it is made slowly.',
      products: 0
    },
    {
      id: 's4',
      family: 'product_grid_2col',
      purpose: 'Two more.',
      products: 2
    },
    { id: 's5', family: 'cta', purpose: 'Shop now.', products: 0 },
    { id: 's6', family: 'footer', purpose: 'Required links.', products: 0 }
  ]
}
const story: StoryboardInput = {
  ...launch,
  slot: { emailType: 'story', angle: 'How the shop began' },
  sections: [
    { id: 's1', family: 'header_logo', purpose: 'The logo.', products: 0 },
    { id: 's2', family: 'hero_image', purpose: 'The workshop.', products: 0 },
    { id: 's3', family: 'text', purpose: 'The story.', products: 0 },
    { id: 's4', family: 'cta', purpose: 'Visit.', products: 0 },
    { id: 's5', family: 'footer', purpose: 'Required links.', products: 0 }
  ]
}
const total = (sections: StoryboardSection[]) =>
  sections.reduce((n, s) => n + s.height, 0)
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

describe('the storyboard (DST-002)', () => {
  it.each([
    ['a launch', launch],
    ['a story without products', story]
  ])('code’s own for %s passes every check', (_, input) => {
    const board = codeStoryboard(input)
    expect(storyboardProblems(board, input)).toEqual([])
    expect(total(board.sections)).toBeGreaterThanOrEqual(emailHeight.min)
    expect(total(board.sections)).toBeLessThanOrEqual(emailHeight.max)
    // The picture is designed and dark; everything else stays live.
    expect(board.sections.map((s) => `${s.render}:${s.tone}`)).toEqual(
      input.sections.map((s) =>
        ['hero_product', 'hero_image'].includes(s.family)
          ? 'designed:dark'
          : 'live:light'
      )
    )
  })

  it('code’s own shrinks a long email to fit', () => {
    const long: StoryboardInput = {
      ...launch,
      sections: [
        ...launch.sections.slice(0, 4),
        {
          id: 's7',
          family: 'product_grid_3col',
          purpose: 'More.',
          products: 3
        },
        { id: 's8', family: 'faq', purpose: 'Questions.', products: 0 },
        { id: 's9', family: 'review_strip', purpose: 'Reviews.', products: 0 },
        ...launch.sections.slice(4)
      ]
    }
    const board = codeStoryboard(long)
    expect(total(board.sections)).toBe(emailHeight.max)
    expect(storyboardProblems(board, long)).toEqual([])
  })

  it('names every problem', () => {
    const board = codeStoryboard(launch)
    const s = board.sections
    const spoiled = [
      { ...s[1], id: 's2', render: 'designed' as const, tone: 'dark' as const },
      { ...s[0] },
      {
        ...s[3],
        render: 'designed' as const,
        tone: 'dark' as const,
        height: 30
      },
      { ...s[2], imagery: 'product' as const, focus: 'One\nTwo' },
      { ...s[4], imagery: 'backdrop' as const },
      { ...s[5], id: 's9' }
    ]
    expect(storyboardProblems({ sections: spoiled }, launch)).toEqual(
      expect.arrayContaining([
        'Use every section given, each once, and no other.',
        'The email must start with the logo header.',
        'Section s4 (product_grid_2col) stays live HTML: buttons, products, the offer, words and the footer are never a picture.',
        'Section s4 (product_grid_2col) is 120 to 1600 px tall.',
        'Section s3 (text) has one focus, in one line.',
        'Section s3 (text) has no product to show.',
        'Section s5 (cta) is live: only a designed section has a backdrop.',
        expect.stringMatching(/^The email is \d+ px tall/)
      ])
    )
    const allLive = board.sections.map((x) => ({
      ...x,
      render: 'live' as const
    }))
    expect(storyboardProblems({ sections: allLive }, launch)).toContain(
      'Design at least one section.'
    )
    const twoDark = board.sections.map((x, i) =>
      i === 1 || i === 2 ? { ...x, tone: 'dark' as const } : x
    )
    expect(storyboardProblems({ sections: twoDark }, launch)).toContain(
      'Sections s2 and s3 are both dark: put a light section between them.'
    )
  })

  it('asks the Art director with the sections and their limits, never the reference when designing from scratch', () => {
    const task = JSON.parse(
      artDirectorAgent.task({
        input: {
          ...launch,
          reference: [{ family: 'hero_image', tone: 'dark', height: 500 }]
        },
        problems: []
      })
    )
    expect(task.sections[1]).toEqual({
      id: 's2',
      kind: 'hero_product',
      does: 'The new tray.',
      products: 1,
      may_be_designed: true
    })
    expect(task).not.toHaveProperty('reference')
    const remix = JSON.parse(
      artDirectorAgent.task({
        input: {
          ...launch,
          mode: 'remix',
          reference: [{ family: 'hero_image', tone: 'dark', height: 500 }]
        },
        problems: ['Too tall.']
      })
    )
    expect(remix.reference).toHaveLength(1)
    expect(remix.fix_these_problems_from_your_last_answer).toEqual([
      'Too tall.'
    ])
    expect(artDirectorAgent.purpose).toBe('plan')
  })

  it('takes the Art director’s storyboard when it passes, after sending back its problems', async () => {
    const good = codeStoryboard(launch).sections.map((s) => ({
      ...s,
      note: 'Calm and airy.'
    }))
    const tooShort = good.map((s) => ({ ...s, height: 60 }))
    const ai = vi
      .fn<AiCall>()
      .mockResolvedValueOnce(ok({ sections: tooShort }))
      .mockResolvedValueOnce(ok({ sections: good }))
    const { ctx: c, fallbacks } = ctx(ai)
    const board = await storyboardFor(launch, c)
    expect(board).toMatchObject({ source: 'agent', sections: good })
    expect(ai).toHaveBeenCalledTimes(2)
    expect(ai.mock.calls[1][0].request.user).toMatch(
      /px tall; make it 1800 to 2400 px/
    )
    expect(ai.mock.calls[0][0].callerKey).toBe('art-director:email-build:b1')
    expect(fallbacks.entries()).toEqual([])
  })

  it('uses code’s storyboard, logged, when the Art director keeps failing or cannot answer', async () => {
    const bad = vi.fn<AiCall>(async () => ok({ sections: [] }))
    const one = ctx(bad)
    expect(await storyboardFor(launch, one.ctx)).toEqual(codeStoryboard(launch))
    expect(one.fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'art-director',
        reasonCode: 'storyboard_answer_invalid',
        attempts: 3
      })
    ])
    const down = ctx(
      vi.fn<AiCall>(async () => ({ ok: false, code: 'setup_required' }))
    )
    expect((await storyboardFor(launch, down.ctx)).source).toBe('code')
    expect(down.fallbacks.entries()[0].reasonCode).toMatch(/^storyboard_/)
  })
})
