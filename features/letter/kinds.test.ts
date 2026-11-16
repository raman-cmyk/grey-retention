// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import type { AiRunResult } from '@/features/ai/run'
import {
  contentStep,
  sectionsStep,
  type PlannedEmail
} from '@/features/email-build/build'
import { sampleOffers, sampleStoreSource } from '@/features/email-build/ports'
import { memoryFallbackLog } from '@/features/fallback/log'
import {
  founderNote,
  kindFits,
  kindOf,
  kindProblems,
  kindSpecs,
  letterKinds,
  maxNoteWords,
  type LetterKind
} from './kinds'
import {
  letterFindings,
  letterFrom,
  writeLetter,
  type LetterAnswer,
  type LetterBrief
} from './writer'

/** DST-PIC #24: the kinds of text email, on a mocked model. */
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
  angle: 'A note about the candle',
  products: [{ id: 'p-cedar-candle', title: 'Cedar candle' }],
  offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 },
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
}
const note = [
  'I poured the first of these by hand, one winter, for our own long evenings.',
  'Every order ships free, and I still read every reply myself.'
]
async function briefFor(
  kind: LetterKind | undefined,
  over: { offer?: boolean; note?: readonly string[] | null } = {}
): Promise<LetterBrief> {
  const store = await sampleStoreSource.read(tenantId)
  const slot = over.offer === false ? { ...planned, offer: null } : planned
  const ctx = {
    tenantId,
    callerKey: 'email-build:b1',
    fallbacks: memoryFallbackLog(),
    agents: null
  }
  const sections = await sectionsStep(
    { planned: slot, store, offers: sampleOffers },
    ctx
  )
  if (!sections.ok) throw new Error('sections failed')
  const locked = await contentStep(
    { planned: slot, store, sections: sections.output },
    ctx
  )
  const withNote = over.note === undefined ? note : over.note
  return {
    locked: withNote
      ? {
          ...locked,
          input: {
            ...locked.input,
            confirmed: {
              founder: { name: 'Maya', role: 'Founder', note: withNote }
            }
          }
        }
      : locked,
    brandName: store.brand.name,
    site: store.brand.site,
    ...(kind ? { kind } : {})
  }
}
const ok = (content: unknown): AiRunResult => ({
  ok: true,
  content,
  provider: 'gemini',
  model: 'test',
  costMicro: 0,
  inputTokens: 1,
  outputTokens: 1,
  settled: true
})
const filler = (n: number) =>
  Array.from({ length: n }, (_, i) => (i % 8 === 7 ? 'light.' : 'warm')).join(
    ' '
  )
const answer = (over: Partial<LetterAnswer> = {}): LetterAnswer => ({
  subject: 'A note about our cedar candle',
  preheader: 'Why we made it, and how it fills a room at night.',
  greeting: 'Hi there,',
  body: [
    'Thank you for reading along with us this year, it means a great deal.',
    `Warm ${filler(50)}`,
    'If you would like one this week, [the candle is here](1).'
  ],
  signoff: 'Warmly,',
  ps: 'Which room would you light it in? Just reply and tell me.',
  ...over
})
const ctxWith = (ai: AiCall) => ({
  tenantId,
  industry: 'home',
  callerKey: 'email-build:b1',
  memory: new InMemoryMemoryStore(),
  log: new InMemoryRunLog(),
  ai,
  fallbacks: memoryFallbackLog()
})
const modelOf = (answers: LetterAnswer[]) => {
  let n = 0
  return vi.fn<AiCall>(async () =>
    ok(answers[Math.min(n++, answers.length - 1)])
  )
}
/** The rules a written letter breaks, its kind's and the letter's. */
const rulesOf = (brief: LetterBrief, over: Partial<LetterAnswer>) => {
  const letter = letterFrom(answer(over), brief)
  if (!letter.success) throw new Error(JSON.stringify(letter.error.issues))
  return [
    ...letterFindings(letter.data, brief),
    ...kindProblems(letter.data, brief)
  ].map((f) => f.rule)
}

describe('the kinds of text email (DST-PIC #24)', () => {
  it('has five kinds, each with its name, its rules and its limits', () => {
    expect(letterKinds).toEqual([
      'founder_note',
      'quick_question',
      'we_miss_you',
      'launch_teaser',
      'thank_you'
    ])
    for (const kind of letterKinds) {
      const spec = kindSpecs[kind]
      expect(spec.rules.length).toBeGreaterThan(0)
      expect(spec.words.min).toBeGreaterThanOrEqual(80)
      expect(spec.words.max).toBeLessThanOrEqual(250)
    }
  })

  it('fits a brief or not: a founder note needs the founder’s own note, a question or a teaser no offer', async () => {
    expect(kindFits('founder_note', await briefFor('founder_note'))).toBeNull()
    expect(
      kindFits('founder_note', await briefFor('founder_note', { note: null }))
    ).toBe('kind_needs_founder_note')
    for (const odd of [
      ['Write to {{ email }} anytime.'],
      ['See https://cedar-lane.example/story for more.'],
      ['A [link](1) in the note.'],
      [filler(maxNoteWords + 1)]
    ])
      expect(
        founderNote(await briefFor('founder_note', { note: odd })),
        odd[0]
      ).toBeNull()
    expect(kindFits('quick_question', await briefFor('quick_question'))).toBe(
      'kind_never_offers'
    )
    expect(kindFits('launch_teaser', await briefFor('launch_teaser'))).toBe(
      'kind_never_offers'
    )
    expect(
      kindFits(
        'quick_question',
        await briefFor('quick_question', { offer: false })
      )
    ).toBeNull()
    expect(kindFits('we_miss_you', await briefFor('we_miss_you'))).toBeNull()
    expect(kindFits('thank_you', await briefFor('thank_you'))).toBeNull()
    // A kind that does not fit is no kind: the letter is a short note.
    const unfit = await briefFor('quick_question')
    expect(kindOf(unfit)).toBeUndefined()
    expect(kindProblems(letterFrom(answer(), unfit).data!, unfit)).toEqual([])
  })

  it('tells the Letter writer its kind’s rules, and sends a broken one back', async () => {
    const brief = await briefFor('quick_question', { offer: false })
    const ai = modelOf([
      answer({ ps: 'Reply and tell me anything at all.' }),
      answer()
    ])
    const made = await writeLetter(brief, ctxWith(ai))
    expect(made).toMatchObject({ status: 'written', tries: 2 })
    const first = ai.mock.calls[0]![0].request
    expect(first.system).toContain('This letter is a quick question')
    expect(first.user).toContain('"kind":"Quick question"')
    expect(ai.mock.calls[1]![0].request.user).toContain(
      'Ask your one question in the last paragraph or the P.S.'
    )
  })

  it('a quick question: one link at most, a short letter, one question', async () => {
    const brief = await briefFor('quick_question', { offer: false })
    expect(rulesOf(brief, {})).toEqual([])
    expect(
      rulesOf(brief, {
        body: [
          'Thank you for reading along. [The candle](1) and [the shop](2).',
          `Warm ${filler(50)}`
        ]
      })
    ).toContain('kind_links')
    expect(
      rulesOf(brief, { body: [`Warm ${filler(150)}`, 'Thank you.'] })
    ).toContain('kind_length')
    expect(
      rulesOf(brief, {
        body: [`Warm ${filler(60)}`, 'Is it this? Or that? Or the other?']
      })
    ).toContain('kind_questions')
  })

  it('a founder note: the founder’s own note placed word for word, the writer in the first person', async () => {
    const brief = await briefFor('founder_note')
    const ai = modelOf([
      answer({
        body: [
          'I wanted to write to you myself this week.',
          `Warm ${filler(45)}`,
          'If you would like one, [the candle is here](1).'
        ]
      })
    ])
    const made = await writeLetter(brief, ctxWith(ai))
    expect(made.status).toBe('written')
    if (made.status !== 'written') return
    expect(made.letter.body.slice(1, 3)).toEqual(note)
    expect(made.letter).toMatchObject({ signature: 'Maya', role: 'Founder' })
    expect(ai.mock.calls[0]![0].request.user).toContain('"founderNote":')
    expect(ai.mock.calls[0]![0].request.system).toContain(
      'placed in the letter word for word'
    )
    // The note's own words ("ships free") are the founder's, never judged
    // as the writer's; the writer's paragraphs must say "I".
    expect(
      rulesOf(brief, {
        body: [
          'We wanted to write to you this week.',
          `Warm ${filler(45)}`,
          'If you would like one, [the candle is here](1).'
        ],
        ps: 'Reply and tell us.'
      })
    ).toEqual(['kind_first_person'])
    expect(rulesOf(brief, {})).toEqual([])
  })

  it('a “we miss you” never lays guilt on the reader', async () => {
    const brief = await briefFor('we_miss_you')
    expect(rulesOf(brief, {})).toEqual([])
    for (const words of [
      'You haven’t visited in a while.',
      'We noticed you have been away.',
      'Where have you been?',
      'It has been months since you last ordered.'
    ])
      expect(
        rulesOf(brief, { body: [words, `Warm ${filler(60)}`] }),
        words
      ).toContain('kind_guilt')
  })

  it('a thank-you thanks the reader first, with no link before it', async () => {
    const brief = await briefFor('thank_you')
    expect(rulesOf(brief, {})).toEqual([])
    expect(
      rulesOf(brief, {
        body: ['We have something new for you this week.', `Warm ${filler(60)}`]
      })
    ).toEqual(['kind_thanks'])
    expect(
      rulesOf(brief, {
        body: [
          'Thank you for being here: [see the candle](1).',
          `Warm ${filler(60)}`
        ]
      })
    ).toEqual(['kind_first_link'])
  })

  it('a letter the writer keeps breaking its kind with: the plain letter, which has no kind', async () => {
    const brief = await briefFor('thank_you')
    const ai = modelOf([answer({ body: ['Hello.', `Warm ${filler(60)}`] })])
    const made = await writeLetter(brief, ctxWith(ai))
    expect(made.status).toBe('plain')
    expect(ai).toHaveBeenCalledTimes(4)
  })

  it('places only a founder’s note that passes the hard rules on its own', async () => {
    for (const odd of [
      ['Use code FRIENDS50 for 50% off everything this week.'],
      ['Our candle is clinically proven to help you sleep.'],
      ['Every candle is only $5 this week.']
    ])
      expect(
        founderNote(await briefFor('founder_note', { note: odd })),
        odd[0]
      ).toBeNull()
  })

  it('a founder note: at most three paragraphs of the writer’s, and the note never repeated', async () => {
    const brief = await briefFor('founder_note')
    const long = answer({
      body: [
        'I wanted to write to you myself.',
        `Warm ${filler(10)}`,
        `Warm ${filler(10)}`,
        'Here is [the candle](1).'
      ]
    })
    const ai = modelOf([long, answer()])
    const made = await writeLetter(brief, ctxWith(ai))
    expect(made.status).toBe('written')
    expect(ai.mock.calls[1]![0].request.user).toContain(
      'Write at most 3 paragraphs of your own'
    )
    expect(ai.mock.calls[0]![0].request.system).toMatch(
      /The founder’s note has \d+ words; with yours the letter is 80 to 250 words/
    )
    expect(
      rulesOf(brief, {
        body: [note[0]!, `I am glad. ${filler(40)}`, 'Here is [the candle](1).']
      })
    ).toContain('kind_note_quoted')
  })

  it('tells the writer its kind’s words in numbers', async () => {
    const brief = await briefFor('quick_question', { offer: false })
    const ai = modelOf([answer()])
    await writeLetter(brief, ctxWith(ai))
    expect(ai.mock.calls[0]![0].request.system).toContain(
      'Write 80 to 150 words in the paragraphs and the P.S. together.'
    )
  })

  it('never takes warm words for guilt, nor a holiday for thanks', async () => {
    const miss = await briefFor('we_miss_you')
    for (const words of [
      'If you haven’t tried the new scent yet, now is a good time.',
      'You haven’t missed a thing, we promise.',
      'We noticed the evenings getting darker this week.',
      'You have stopped by the studio before, and we loved it.',
      'It has been a while since you last heard from us.'
    ])
      expect(
        rulesOf(miss, { body: [words, `Warm ${filler(60)}`] }),
        words
      ).not.toContain('kind_guilt')
    const thank = await briefFor('thank_you')
    expect(
      rulesOf(thank, {
        body: [
          'Thanksgiving is coming, and so is winter.',
          `Warm ${filler(60)}`
        ]
      })
    ).toContain('kind_thanks')
    expect(
      rulesOf(thank, {
        body: ['We are so grateful you are here.', `Warm ${filler(60)}`]
      })
    ).not.toContain('kind_thanks')
  })

  it('a kind it does not know is no kind', async () => {
    for (const kind of ['newsletter', 'toString'])
      expect(
        kindOf({
          ...(await briefFor(undefined)),
          kind: kind as LetterKind
        })
      ).toBeUndefined()
  })

  it('judges the note as one block, and a short line of it as a copy only whole', async () => {
    expect(
      founderNote(
        await briefFor('founder_note', {
          note: [
            'Here is a little code from me, just for you.',
            'WINTER25 works all week.'
          ]
        })
      )
    ).toBeNull()
    const brief = await briefFor('founder_note', {
      note: [...note, 'Thank you.']
    })
    expect(
      rulesOf(brief, {
        body: [
          'I wanted to write to you myself.',
          `I hope it finds you well this week. Thank you. ${filler(30)}`,
          'Here is [the candle](1).'
        ]
      })
    ).not.toContain('kind_note_quoted')
  })

  it('reads more thanks, and the win-back lines as guilt, without a false hit', async () => {
    const thank = await briefFor('thank_you')
    for (const words of [
      'We are so thankful for you this season.',
      'You are so appreciated here.',
      'With gratitude, from all of us.',
      'Thank\u00a0you for reading along.'
    ])
      expect(
        rulesOf(thank, { body: [words, `Warm ${filler(60)}`] }),
        words
      ).not.toContain('kind_thanks')
    const miss = await briefFor('we_miss_you')
    for (const words of [
      'You didn’t open our last letter.',
      'We haven’t seen you in a while.',
      'We haven’t heard from you lately.',
      'It’s been ages since we’ve seen you.'
    ])
      expect(
        rulesOf(miss, { body: [words, `Warm ${filler(60)}`] }),
        words
      ).toContain('kind_guilt')
    expect(
      rulesOf(miss, {
        body: ['Tell us where you’ve been lighting it.', `Warm ${filler(60)}`]
      })
    ).not.toContain('kind_guilt')
  })
})
