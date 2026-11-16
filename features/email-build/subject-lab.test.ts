import { describe, expect, it } from 'vitest'
import type { SentEmail } from '@/features/onboarding/history/facts'
import {
  labSize,
  learnFrom,
  pastSubjects,
  subjectLab,
  traitsOf,
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

/** Twelve past emails: the six questions opened at 36%, the rest at 24%. */
const questionsWin: PastSubject[] = [
  'Ready for the weekend?',
  'Have you seen the new linen?',
  'Which colour is yours?',
  'Too warm for wool?',
  'Need a gift idea?',
  'What should we make next?',
  'The linen edit',
  'Autumn is here',
  'Fresh from the workshop',
  'Our oak trays are back',
  'A note from the studio',
  'Five ways to style a scarf'
].map((subject) => ({
  subject,
  recipients: 800,
  openRate: subject.includes('?') ? 0.36 : 0.24
}))

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
})

describe('pastSubjects', () => {
  it('keeps only sent emails whose opens can teach', () => {
    const past = pastSubjects({
      sent: [
        sent({ subject: 'Kept' }),
        sent({ subject: null }),
        sent({ subject: 'No rate', openRate: null }),
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
  it('says nothing with fewer than ten past emails', () => {
    const evidence = learnFrom(questionsWin.slice(0, 9), brand)
    expect(evidence).toEqual({ emails: 9, meanOpenRate: null, traits: {} })
  })

  it('compares each trait with and without, shrunk by how few show it', () => {
    const evidence = learnFrom(questionsWin, brand)
    expect(evidence.emails).toBe(12)
    expect(evidence.meanOpenRate).toBeCloseTo(0.3)
    const question = evidence.traits.question!
    expect(question.withRate).toBeCloseTo(0.36)
    expect(question.withoutRate).toBeCloseTo(0.24)
    expect(question.withCount).toBe(6)
    // 12 points, shrunk twice by 6 of 11: about 3.6 points.
    expect(question.lift).toBeCloseTo(0.12 * (6 / 11) * (6 / 11))
    // Two emails with a number: too few to say anything.
    expect(evidence.traits.number).toBeUndefined()
    // Bad rows are never read.
    const noisy = learnFrom(
      [
        ...questionsWin,
        { subject: '', recipients: 900, openRate: 0.9 },
        { subject: 'Huge?', recipients: 900, openRate: 7 },
        { subject: 'Tiny?', recipients: 12, openRate: 0.9 }
      ],
      brand
    )
    expect(noisy.emails).toBe(12)
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
    expect(lab.a?.subject).toBe('Ready for linen weather?')
    expect(lab.a?.why[0]).toBe(
      'Subjects that ask a question: 36% opened, the others 24% (6 of 12 emails).'
    )
    expect(lab.a?.expected).toBeGreaterThan(0.3)
    // The same idea in other words is never B; B differs in a trait.
    expect(lab.b?.subject).toBe('The linen edit is here')
    expect(lab.tests).toEqual(['question'])
    // The long one is cut on a phone: last.
    expect(lab.ranked.at(-1)?.subject).toBe(ideas[3])
    expect(lab.ranked.at(-1)?.why).toEqual([
      'A long subject is cut on a phone (a rule of thumb).'
    ])
  })

  it('keeps the writer’s order without past emails, rules of thumb aside', () => {
    const lab = subjectLab(ideas, learnFrom([], brand), { brand })
    expect(lab.learned).toBe(false)
    expect(lab.a?.subject).toBe('The linen edit is here')
    expect(lab.a?.expected).toBeNull()
    expect(lab.b?.subject).toBe('Ready for linen weather?')
    expect(lab.ranked.map((r) => r.subject).at(-1)).toBe(ideas[3])
  })

  it('weighs only ideas that fit, each once, at most ten', () => {
    const many = [
      '  Ready   for linen weather? ',
      'ready for linen weather?',
      '',
      'x'.repeat(121),
      ...Array.from({ length: 12 }, (_, i) => `Linen idea ${i + 1}`)
    ]
    const tried: string[] = []
    const lab = subjectLab(many, learnFrom(questionsWin, brand), {
      brand,
      fits: (s) => {
        tried.push(s)
        return s !== 'Ready for linen weather?'
      }
    })
    expect(tried).toHaveLength(labSize)
    expect(tried[0]).toBe('Ready for linen weather?')
    expect(lab.ranked).toHaveLength(labSize - 1)
    expect(lab.ranked.some((r) => r.subject.includes('weather'))).toBe(false)
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
})
