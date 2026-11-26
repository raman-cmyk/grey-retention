// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { codePulse, gatherEvidence } from './pulse'
import { codeMoves, mapPatterns } from './competitors'
import {
  briefWriterAgent,
  calendarPlannerAgent,
  codeBrief,
  goalLines,
  guidanceNotes,
  planEvidence,
  readPlanInput,
  samplePlan,
  withOfferLadder,
  type PlanInput,
  type Slot
} from './plan'
import { sampleCompetitors, sampleStore } from './sample'
import { storedPlan } from './stored'

/**
 * PICK-WIRE: the owner picks the plan works toward and from: the revenue
 * goal (#33), the brand's email mix (#37), the offer ladder (#40), and the
 * followed brands' timing and offers (#48, #49). Code only: no agent runs.
 */
const start = '2026-11-16'
const store = sampleStore(start)
const competitors = sampleCompetitors(start)
const pulse = codePulse(gatherEvidence(store))
const input: PlanInput = {
  industry: 'home',
  start,
  sendsPerWeek: 3,
  sendTime: '10:00',
  pulse,
  offers: pulse.offers,
  moves: codeMoves(
    mapPatterns({ industry: 'home', brandSize: 'small', start, ...competitors })
  ),
  products: store.products.map((p) => ({
    id: p.id,
    title: p.title,
    inStock: p.stock !== 0,
    availableFrom: p.launchedOn && p.launchedOn >= start ? p.launchedOn : null
  })),
  audiences: [{ id: 'aud-engaged', label: 'Engaged subscribers' }],
  blackouts: ['2026-11-25'],
  existing: []
}
const slot = (over: Partial<Slot>): Slot => ({
  actionIndex: 0,
  date: '2026-11-20',
  time: '10:00',
  emailType: 'launch',
  angle: 'Meet the oak tray',
  productIds: ['p-oak-tray'],
  offerId: null,
  audienceId: 'aud-engaged',
  ...over
})

describe('the offer ladder in the plan (#40)', () => {
  const ladderOffers = [
    { id: 'offer:BIG25', code: 'BIG25', percent: 25, until: null },
    { id: 'offer:SMALL10', code: 'SMALL10', percent: 10, until: null },
    { id: 'offer:MID15', code: 'MID15', percent: 15, until: null }
  ]
  const sale: PlanInput = {
    ...input,
    sendsPerWeek: 4,
    pulse: { ...pulse, offers: ladderOffers },
    offers: ladderOffers
  }
  const saleBrief = [
    {
      goal: 'Run the store’s sale over these days.',
      evidenceIds: ['offer:BIG25'],
      from: '2026-11-16',
      to: '2026-11-30',
      offerId: 'offer:BIG25'
    }
  ]
  const offerOn = (date: string) =>
    slot({
      actionIndex: 0,
      date,
      emailType: 'offer',
      angle: 'The sale is on',
      productIds: ['p-cedar-candle'],
      offerId: 'offer:BIG25'
    })

  // Other emails each week, so the offer share holds.
  const others = ['2026-11-17', '2026-11-18', '2026-11-24', '2026-11-26'].map(
    (date) =>
      slot({
        actionIndex: 0,
        date,
        emailType: 'story',
        angle: 'From the workshop',
        productIds: []
      })
  )

  it('starts a sale low and steps up to the biggest allowed offer, never above it', () => {
    const slots = [offerOn('2026-11-16'), offerOn('2026-11-23'), ...others]
    const { kept, dropped, changed } = withOfferLadder(slots, sale, saleBrief)
    expect(kept.filter((s) => s.offerId).map((s) => s.offerId)).toEqual([
      'offer:SMALL10',
      'offer:BIG25'
    ])
    expect(kept).toHaveLength(slots.length)
    expect(changed).toBe(1)
    expect(dropped).toEqual([])
    // One offer email: the smallest offer of at least 10%.
    expect(
      withOfferLadder([offerOn('2026-11-16'), ...others], sale, saleBrief)
        .kept[0]!.offerId
    ).toBe('offer:SMALL10')
    // No offer email: nothing changes.
    const plain = [slot({})]
    expect(withOfferLadder(plain, sale, saleBrief)).toEqual({
      kept: plain,
      dropped: [],
      changed: 0
    })
  })

  it('drops an offer email no allowed offer can hold that day, and checks the plan again', () => {
    const ending = [
      {
        id: 'offer:SMALL10',
        code: 'SMALL10',
        percent: 10,
        until: '2026-11-20'
      }
    ]
    const short = {
      ...sale,
      pulse: { ...pulse, offers: ending },
      offers: ending
    }
    const { kept, dropped } = withOfferLadder(
      [
        ...[offerOn('2026-11-16'), offerOn('2026-11-23')].map((s) => ({
          ...s,
          offerId: 'offer:SMALL10'
        })),
        ...others
      ],
      short,
      [
        {
          ...saleBrief[0]!,
          evidenceIds: ['offer:SMALL10'],
          offerId: 'offer:SMALL10'
        }
      ]
    )
    expect(kept.filter((s) => s.offerId).map((s) => s.date)).toEqual([
      '2026-11-16'
    ])
    expect(kept).toHaveLength(5)
    expect(dropped).toHaveLength(1)
    expect(dropped[0]![0]!.rule).toBe('offer_ended')
  })

  it('gives the sample plan its offer from the ladder, its fact citing that code', () => {
    const plan = samplePlan(input)
    const offer = plan.slots.find((s) => s.offer)!
    // WELCOME15 is first in the pulse; CANDLE10 is the smallest of at least 10%.
    expect(offer.offer?.code).toBe('CANDLE10')
    expect(offer.evidence.map((e) => e.id)).toContain('offer:CANDLE10')
    expect(offer.evidence.map((e) => e.id)).not.toContain('offer:WELCOME15')
    expect(storedPlan.safeParse(plan).success).toBe(true)
  })
})

describe('the plan’s guidance (#33, #37, #48, #49)', () => {
  const guidance = {
    goals: [
      {
        month: '2026-11-01',
        label: 'November 2026',
        sentence:
          '$12,400 still needed by 30 November. Recent emails earned about $3,000 each, so about 5 more emails; 6 fit at 3 a week.',
        emailsNeeded: 5,
        emailsPossible: 6,
        needsStrongerEmails: false,
        pace: 'behind' as const
      }
    ],
    mix: {
      counts: { offer: 1, story: 0, education: 3, product: 2 },
      basis: 'learned' as const
    },
    competitors: [
      {
        id: 'competitor-times:0',
        fact: 'Glow Co sent 30 emails in the 90 days to 15 Nov 2026, about 2.3 a week, most often on Tue around 09:00 your store’s time.'
      },
      {
        id: 'competitor-offers:0',
        fact: 'Glow Co ran an offer in 3 of the 4 weeks from 19 Oct 2026 to 15 Nov 2026, usually up to 20% off.'
      }
    ]
  }
  const guided: PlanInput = { ...input, guidance }

  it('keeps the guidance when it reads the input, and refuses a broken one', () => {
    expect(readPlanInput(guided).guidance).toEqual(guidance)
    expect(() =>
      readPlanInput({
        ...input,
        guidance: { competitors: [{ id: 'pattern:1', fact: 'Not theirs.' }] }
      })
    ).toThrow()
  })

  it('gives the Brief writer the goal and the followed brands’ facts, and the planner the mix', () => {
    const facts = [...planEvidence(guided)].map(([id, fact]) => ({ id, fact }))
    expect(facts.map((f) => f.id)).toEqual(
      expect.arrayContaining(['competitor-times:0', 'competitor-offers:0'])
    )
    const briefTask = JSON.parse(
      briefWriterAgent.task({ input: guided, facts, problems: [] })
    )
    expect(briefTask.revenue_goal).toEqual([
      {
        month: '2026-11-01',
        progress: guidance.goals[0]!.sentence,
        emails_needed: 5,
        emails_that_fit: 6,
        needs_stronger_emails: false,
        pace: 'behind'
      }
    ])
    expect(briefWriterAgent.instructions).toMatch(/Never copy their offers/)
    const plannerTask = JSON.parse(
      calendarPlannerAgent.task({
        input: guided,
        brief: codeBrief(guided),
        previous: null,
        problems: []
      })
    )
    expect(plannerTask.email_mix).toEqual(guidance.mix.counts)
    expect(plannerTask.revenue_goal).toHaveLength(1)
    // Without guidance the tasks are as before.
    expect(
      JSON.parse(briefWriterAgent.task({ input, facts: [], problems: [] }))
        .revenue_goal
    ).toBeUndefined()
    expect(
      JSON.parse(
        calendarPlannerAgent.task({
          input,
          brief: codeBrief(input),
          previous: null,
          problems: []
        })
      ).email_mix
    ).toBeUndefined()
  })

  it('fills plain emails with the kinds the brand’s mix still has room for', () => {
    const plainOf = (p: ReturnType<typeof samplePlan>) =>
      p.slots
        .filter((s) => !s.offer && s.emailType !== 'launch')
        .map((s) => s.emailType)
    const guidedTypes = plainOf(samplePlan(guided))
    expect(guidedTypes.length).toBeGreaterThan(0)
    // Education first (3 to place), then product emails; no story (0).
    expect(guidedTypes[0]).toBe('education')
    expect(
      guidedTypes.every((t) => t === 'education' || t === 'bestseller')
    ).toBe(true)
    // Without a mix: stories, as before.
    expect(plainOf(samplePlan(input)).every((t) => t === 'story')).toBe(true)
  })

  it('says the goal, the learned mix and the followed brands in plain words', () => {
    const plan = samplePlan(guided)
    expect(storedPlan.safeParse(plan).success).toBe(true)
    const inNovember = plan.slots.filter((s) => s.date < '2026-12-01')
    const offers = inNovember.filter((s) => s.offer).length
    expect(plan.goal).toEqual([
      {
        month: '2026-11-01',
        label: 'November 2026',
        sentence: guidance.goals[0]!.sentence,
        plan: `This plan has ${inNovember.length} emails in November 2026${offers ? `, ${offers} with an offer within your biggest discount and margin floor` : ''}.`,
        pace: 'behind'
      }
    ])
    expect(plan.notes).toContain(
      'The email mix learned from your results for these days: 1 offer, 0 story, 3 education and 2 product emails. The calendar rules come first.'
    )
    expect(plan.notes).toContain(
      `What the brands you follow do: ${guidance.competitors[0]!.fact} ${guidance.competitors[1]!.fact} Their offers are never copied.`
    )
    // A default mix is not worth a note.
    expect(
      guidanceNotes({
        guidance: { mix: { ...guidance.mix, basis: 'default' } }
      })
    ).toEqual([])
    expect(samplePlan(input).goal).toBeUndefined()
    expect(goalLines({ guidance }, [])).toEqual([
      expect.objectContaining({
        plan: 'This plan has no email in November 2026.'
      })
    ])
  })
})
