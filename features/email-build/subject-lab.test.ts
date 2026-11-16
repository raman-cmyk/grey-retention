import { describe, expect, it } from 'vitest'
import type { SentEmail } from '@/features/onboarding/history/facts'
import {
  labSize,
  learnFrom,
  pastSubjects,
  subjectLab,
  testMargin,
  traitsOf,
  worthTesting,
  type PastSubject
} from './subject-lab'

const brand = 'Cedar Goods'

const sent = (over: Partial<SentEmail>): SentEmail => ({
  id: 'Msg1',
  campaignId: 'Cmp1',
  name: null,
  subject: 'Our new linen shirts',
  preview: null,
  sentAt: '2026-10-01T10:00:00.000Z',
  offer: false,
  collecting: false,
  abTest: false,
  strategy: 'static',
  recipients: 1_000,
  opens: 300,
  clicks: 20,
  orders: 2,
  revenue: 100,
  revenuePerRecipient: 0.1,
  openRate: 0.3,
  clickRate: 0.02,
  unsubscribeRate: 0,
  ...over
})

/**
 * Twelve past emails, as a store's go up and down: the six questions
 * opened at 31% on average, the rest at 26%.
 */
const questionRates = [0.36, 0.26, 0.34, 0.28, 0.32, 0.3]
const otherRates = [0.3, 0.22, 0.28, 0.24, 0.26, 0.26]
const questionsWin: PastSubject[] = [
  ...[
    'Ready for the weekend?',
    'Have you seen the new linen?',
    'Which colour is yours?',
    'Too warm for wool?',
    'Need a gift idea?',
    'What should we make next?'
  ].map((subject, i) => ({
    subject,
    recipients: 800,
    openRate: questionRates[i]!
  })),
  ...[
    'The linen edit',
    'Autumn is here',
    'Fresh from the workshop',
    'Our oak trays are back',
    'A note from the studio',
    'Five ways to style a scarf'
  ].map((subject, i) => ({
    subject,
    recipients: 800,
    openRate: otherRates[i]!
  }))
]
/** The question's lift: 5 points, shrunk by d² / (d² + se²). */
const squares = (rates: number[], m: number) =>
  rates.reduce((n, r) => n + (r - m) ** 2, 0)
const pooled = (squares(questionRates, 0.31) + squares(otherRates, 0.26)) / 10
const se2 =
  Math.max(pooled, squares(questionRates, 0.31) / 5) / 6 +
  Math.max(pooled, squares(otherRates, 0.26) / 5) / 6
const questionLift = (0.05 * 0.05 ** 2) / (0.05 ** 2 + se2)

describe('traitsOf', () => {
  it('reads what a subject does', () => {
    expect(traitsOf('Ready for the weekend?', brand)).toEqual([
      'short',
      'question'
    ])
    expect(traitsOf('20% off everything, ends tonight', brand)).toEqual([
      'offer',
      'deadline',
      'lowercase'
    ])
    expect(
      traitsOf("{{ first_name|default:'friend' }}, your linen is here", brand)
    ).toEqual(['short', 'personal', 'lowercase', 'you'])
    expect(traitsOf('New at {{ organization.name }} 🌿', brand)).toEqual([
      'short',
      'emoji',
      'brand',
      'new'
    ])
    expect(
      traitsOf(
        'Five reasons our makers in the valley still cut every board by hand',
        brand
      )
    ).toEqual(['long'])
    // A number that is not an offer, and a store name only as a whole word.
    expect(traitsOf('3 trays we love from Cedar Goods!', brand)).toEqual([
      'number',
      'brand',
      'exclaim'
    ])
    expect(traitsOf('Cedar Goodsmiths open day', brand)).toEqual(['short'])
  })

  it('reads every first-name tag, and never what a reader does not see', () => {
    for (const tag of [
      '{{ person.first_name }}',
      "{{ person|lookup:'First Name' }}",
      "{{ first_name|default:'there' }}"
    ])
      expect(traitsOf(`${tag}, your order`, brand), tag).toContain('personal')
    expect(traitsOf('{{ first_name_initial }}, hi', brand)).not.toContain(
      'personal'
    )
    // A logic tag is not shown, so the subject is still short.
    expect(
      traitsOf('{% if first_name %}Hello{% endif %} from the studio', brand)
    ).toContain('short')
    // A brand with a character no one sees still matches.
    for (const c of [0x200b, 0x2066, 0x0007]) {
      const hidden = `Cedar${String.fromCodePoint(c)} Goods`
      expect(traitsOf('Cedar Goods turns ten', hidden), `${c}`).toContain(
        'brand'
      )
    }
  })

  it('never reads an ordinary subject as a deadline, something new, an emoji or lower case', () => {
    for (const subject of [
      'The story never ends',
      'Odds and ends from the studio',
      'A never-ending love for linen',
      "Today's picks",
      'Shop the workshop today'
    ])
      expect(traitsOf(subject, brand), subject).not.toContain('deadline')
    for (const subject of [
      'Sale ends tonight',
      'Ends Sunday: the linen sale',
      'Today only: free shipping',
      'Last chance for linen',
      'Ends in 3 hours',
      '24 hours only',
      'Only today: linen',
      'Offer ends this weekend',
      'Sale ends 11/30'
    ])
      expect(traitsOf(subject, brand), subject).toContain('deadline')
    for (const subject of [
      'Just in time for Christmas',
      'Happy New Year from us',
      'Our New York pop-up'
    ])
      expect(traitsOf(subject, brand), subject).not.toContain('new')
    expect(traitsOf('Just in: the oak tray', brand)).toContain('new')
    for (const subject of ['The Launcher bag', 'Our launchpad is open'])
      expect(traitsOf(subject, brand), subject).not.toContain('new')
    for (const subject of [
      'Made with GORE-TEX® fabric',
      'Cedar Goods™ linen',
      '© the studio'
    ])
      expect(traitsOf(subject, brand), subject).not.toContain('emoji')
    for (const subject of ['Made here 🇺🇸', 'Our top 1️⃣'])
      expect(traitsOf(subject, brand), subject).toContain('emoji')
    for (const subject of ['新しいリネン', 'جديد'])
      expect(traitsOf(subject, brand), subject).not.toContain('lowercase')
    expect(traitsOf('Treat yourself', brand)).toContain('you')
    expect(traitsOf('For the young at heart', brand)).not.toContain('you')
  })
})

describe('pastSubjects', () => {
  it('keeps only sent emails whose opens can teach', () => {
    const past = pastSubjects({
      sent: [
        sent({ subject: 'Kept' }),
        sent({ subject: null }),
        sent({ subject: 'No rate', openRate: null }),
        sent({ subject: 'Opens not tracked', openRate: 0, opens: 0 }),
        sent({ subject: 'Too few', recipients: 40 }),
        sent({ subject: 'Unknown count', recipients: null }),
        sent({ subject: 'A test', abTest: true }),
        sent({ subject: 'Still coming in', collecting: true })
      ]
    })
    expect(past).toEqual([
      { subject: 'Kept', recipients: 1_000, openRate: 0.3 }
    ])
  })
})

describe('learnFrom', () => {
  it('says nothing with fewer than ten past emails, and something with ten', () => {
    const nine = learnFrom(questionsWin.slice(0, 9), brand)
    expect(nine).toEqual({ emails: 9, meanOpenRate: null, traits: {} })
    const ten = learnFrom(questionsWin.slice(2, 12), brand)
    expect(ten.emails).toBe(10)
    // Four questions and six others: enough on each side.
    expect(ten.traits.question?.withCount).toBe(4)
  })

  it('compares each trait with and without, shrunk by how sure it is', () => {
    const evidence = learnFrom(questionsWin, brand)
    expect(evidence.emails).toBe(12)
    expect(evidence.meanOpenRate).toBeCloseTo(0.285)
    const question = evidence.traits.question!
    expect(question.withRate).toBeCloseTo(0.31)
    expect(question.withoutRate).toBeCloseTo(0.26)
    expect(question.withCount).toBe(6)
    expect(question.lift).toBeCloseTo(questionLift, 6)
    expect(question.lift).toBeLessThan(0.05)
    // Two emails say "you": too few to say anything.
    expect(evidence.traits.you).toBeUndefined()
    // Bad rows are never read.
    const noisy = learnFrom(
      [
        ...questionsWin,
        { subject: '', recipients: 900, openRate: 0.9 },
        { subject: 'Huge?', recipients: 900, openRate: 7 },
        { subject: 'Not a number?', recipients: 900, openRate: Number.NaN },
        { subject: 'Endless?', recipients: Infinity, openRate: 0.5 },
        { subject: 'Tiny?', recipients: 12, openRate: 0.9 },
        { subject: 'None opened?', recipients: 900, openRate: 0 },
        { subject: `${'Long '.repeat(70)}?`, recipients: 900, openRate: 0.9 },
        { subject: 42 as never, recipients: 900, openRate: 0.9 }
      ],
      brand
    )
    expect(noisy.emails).toBe(12)
  })

  it('needs three emails on each side, and keeps a lift within 15 points', () => {
    const rows = (questions: number) =>
      Array.from({ length: 12 }, (_, i) => ({
        subject: i < questions ? `Question ${i}?` : `Note ${i}`,
        recipients: 500,
        openRate: i < questions ? 0.8 : 0.2
      }))
    expect(learnFrom(rows(2), brand).traits.question).toBeUndefined()
    const three = learnFrom(rows(3), brand).traits.question!
    expect(three.withCount).toBe(3)
    // 60 points apart, with no noise: kept at 15.
    expect(three.lift).toBe(0.15)
    const nine = learnFrom(rows(9), brand).traits.question!
    expect(nine.withoutCount).toBe(3)
    expect(learnFrom(rows(10), brand).traits.question).toBeUndefined()
  })
})

describe('subjectLab', () => {
  const ideas = [
    'The linen edit is here',
    'Ready for linen weather?',
    'The linen edit is here now',
    'Our linen shirts, made in small batches by the same three makers every season'
  ]

  it('ranks by the store’s own opens and keeps a different B to test', () => {
    const lab = subjectLab(ideas, learnFrom(questionsWin, brand), { brand })
    expect(lab.learned).toBe(true)
    expect(lab.emails).toBe(12)
    expect(lab.a).toMatchObject({
      subject: 'Ready for linen weather?',
      index: 1
    })
    expect(lab.a?.why[0]).toBe(
      'Subjects that ask a question: 31% opened, the others 26% (6 of 12 emails).'
    )
    // The store's mean, moved by half the lift (half its emails ask).
    expect(lab.a?.expected).toBeCloseTo(0.285 + questionLift / 2, 6)
    // The same idea in other words is never B; B differs in a trait.
    expect(lab.b).toMatchObject({ subject: 'The linen edit is here', index: 0 })
    expect(lab.b?.expected).toBeCloseTo(0.285 - questionLift / 2, 6)
    expect(lab.tests).toEqual(['question'])
    // The long one is cut on a phone: last.
    expect(lab.ranked.at(-1)?.subject).toBe(ideas[3])
    expect(lab.ranked.at(-1)?.why).toEqual([
      'A long subject is cut on a phone (a rule of thumb).'
    ])
  })

  it('gives at most three reasons, the strongest first', () => {
    const past = Array.from({ length: 40 }, (_, i) => {
      const q = i % 2 === 0
      const y = i % 4 < 2
      const e = i % 8 < 4
      return {
        subject: `${y ? 'Your' : 'The'} linen ${e ? 'now 🌿' : 'edit'}${q ? '?' : ''}${i % 3 === 0 ? '!' : ''}`,
        recipients: 900,
        openRate:
          0.2 +
          (q ? 0.08 : 0) +
          (y ? 0.05 : 0) +
          (e ? 0.02 : 0) +
          (i % 5) * 0.004
      }
    })
    const lab = subjectLab(['Your linen now 🌿?!'], learnFrom(past, brand), {
      brand
    })
    const why = lab.a!.why
    expect(why.length).toBeLessThanOrEqual(3)
    expect(why[0]).toMatch(/^Subjects that ask a question/)
    expect(why[1]).toMatch(/^Subjects that say "you"/)
  })

  it('keeps the writer’s order without past emails, rules of thumb aside', () => {
    const lab = subjectLab(ideas, learnFrom([], brand), { brand })
    expect(lab.learned).toBe(false)
    expect(lab.a?.subject).toBe('The linen edit is here')
    expect(lab.a?.expected).toBeNull()
    expect(lab.b?.subject).toBe('Ready for linen weather?')
    expect(lab.ranked.map((r) => r.subject).at(-1)).toBe(ideas[3])
  })

  it('weighs only ideas that fit, each once, at most ten, and says where each was', () => {
    const many = [
      '  Ready   for linen weather? ',
      'ready for linen weather?',
      '',
      42 as never,
      'x'.repeat(121),
      ...Array.from({ length: 12 }, (_, i) => `Linen idea ${i + 1}`)
    ]
    const tried: [string, number][] = []
    const lab = subjectLab(many, learnFrom(questionsWin, brand), {
      brand,
      fits: (s, i) => {
        tried.push([s, i])
        return !/weather/i.test(s)
      }
    })
    expect(tried).toHaveLength(labSize)
    expect(tried[0]).toEqual(['Ready for linen weather?', 0])
    // Its other spelling is tried too: it did not fit the first time.
    expect(tried[1]).toEqual(['ready for linen weather?', 1])
    expect(tried[2]).toEqual(['Linen idea 1', 5])
    expect(lab.ranked).toHaveLength(labSize - 2)
    expect(lab.ranked.some((r) => r.subject.includes('weather'))).toBe(false)
    expect(lab.ranked.find((r) => r.subject === 'Linen idea 3')?.index).toBe(7)
    // The same subject with another preview line fits the second time.
    const previews = ['Linen is back for good', 'Six colours, made slowly']
    const paired = subjectLab(
      ['Linen is back', 'Linen is back'],
      learnFrom([], brand),
      { brand, fits: (s, i) => !previews[i]!.startsWith(s) }
    )
    expect(paired.a).toMatchObject({ subject: 'Linen is back', index: 1 })
  })

  it('tests nothing when the ideas are one idea or B would cost too much', () => {
    const alike = subjectLab(
      ['The linen edit is here', 'The linen edit is here now'],
      learnFrom(questionsWin, brand),
      { brand }
    )
    expect(alike.a?.subject).toBe('The linen edit is here')
    expect(alike.b).toBeNull()
    expect(alike.tests).toEqual([])

    // Offers opened far less here: an offer is not worth half the audience.
    const offersLose = questionsWin.map((p, i) =>
      i < 5
        ? { subject: `${10 + i}% off linen`, recipients: 800, openRate: 0.1 }
        : { ...p, openRate: 0.35 }
    )
    const costly = subjectLab(
      ['The linen edit', '20% off linen'],
      learnFrom(offersLose, brand),
      { brand }
    )
    expect(costly.a?.subject).toBe('The linen edit')
    expect(costly.b).toBeNull()

    const none = subjectLab([], learnFrom(questionsWin, brand), { brand })
    expect(none).toMatchObject({ a: null, b: null, ranked: [] })
  })

  it('never lets one lucky email among three decide A', () => {
    const past = Array.from({ length: 100 }, (_, i) => {
      if (i >= 97)
        return {
          subject: `Linen 🌿 ${i}`,
          recipients: i === 97 ? 150 : 900,
          openRate: [0.85, 0.22, 0.2][i - 97]!
        }
      const question = i % 3 === 0
      return {
        subject: question ? `Linen ${i}?` : `Linen ${i}`,
        recipients: 900,
        openRate:
          0.28 + (((i * 37) % 17) / 16 - 0.5) * 0.16 + (question ? 0.04 : 0)
      }
    })
    const evidence = learnFrom(past, brand)
    expect(evidence.traits.emoji!.lift).toBeLessThan(0.06)
    const lab = subjectLab(
      ['Linen weather 🌿', 'Ready for linen weather?'],
      evidence,
      {
        brand
      }
    )
    expect(lab.b).not.toBeNull()
  })

  it('tests a B exactly 5 points below A, and none further', () => {
    expect(testMargin).toBe(0.05)
    expect(worthTesting(0.075, 0.025)).toBe(true)
    expect(worthTesting(0.07500000000000001, 0.025)).toBe(true)
    expect(worthTesting(0.075, 0.0249)).toBe(false)
  })
})
