// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import { codePulse, gatherEvidence } from './pulse'
import { codeMoves, mapPatterns } from './competitors'
import {
  briefWriterAgent,
  calendarPlannerAgent,
  calendarProblems,
  checkBrief,
  codeBrief,
  codeSlots,
  keepPassing,
  planFifteenDays,
  plannerProducts,
  productsForPlanner,
  readPlanInput,
  strategyCriticAgent,
  type PlanInput,
  type Slot
} from './plan'
import { sampleCompetitors, sampleStore } from './sample'

const tenantId = '00000000-0000-4000-8000-000000000101'
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

const brief = {
  actions: [
    {
      goal: 'Introduce the oak tray to subscribers when it launches.',
      evidenceIds: ['launch:p-oak-tray'],
      from: '2026-11-20',
      to: '2026-11-22',
      offerId: null
    },
    {
      goal: 'Use the candle offer before it ends, while stock lasts.',
      evidenceIds: ['offer:CANDLE10', 'stock:p-cedar-candle'],
      from: '2026-11-16',
      to: '2026-11-22',
      offerId: 'offer:CANDLE10'
    },
    {
      goal: 'Send a gift guide before the public holiday, like similar brands.',
      evidenceIds: ['pattern:1'],
      from: '2026-11-23',
      to: '2026-11-24',
      offerId: null
    },
    {
      goal: 'Invite subscribers to the studio open day.',
      evidenceIds: ['date:2026-11-19:1'],
      from: '2026-11-17',
      to: '2026-11-19',
      offerId: null
    }
  ]
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
const offerSlot = slot({
  actionIndex: 1,
  date: '2026-11-17',
  emailType: 'offer',
  angle: 'The candle people love, for less',
  productIds: ['p-cedar-candle'],
  offerId: 'offer:CANDLE10'
})
const storySlot = slot({
  actionIndex: 3,
  date: '2026-11-18',
  emailType: 'story',
  angle: 'Come to the studio',
  productIds: []
})
const giftSlot = slot({
  actionIndex: 2,
  date: '2026-11-23',
  time: '09:30',
  emailType: 'gift guide',
  angle: 'Gifts for slow mornings',
  productIds: ['p-linen-throw', 'p-wool-cushion']
})
const calendar = { slots: [offerSlot, storySlot, slot({}), giftSlot] }
const texts = (problems: ReturnType<typeof calendarProblems>, i: number) =>
  (problems.get(i) ?? []).map((p) => p.text)

/** Answers per agent, in order; `'refused'` is a refused call. */
const agents = (answers: Record<string, unknown[]>) =>
  vi.fn<AiCall>(async (call) => {
    const agent = call.callerKey.split(':')[0]
    const next = answers[agent]?.shift()
    if (next === undefined || next === 'refused')
      return { ok: false, code: 'cap_reached' }
    return {
      ok: true,
      content: next,
      provider: 'fake',
      model: 'fake',
      costMicro: 0,
      inputTokens: 10,
      outputTokens: 10,
      settled: true
    }
  })
const context = (ai: AiCall) => {
  const log = new InMemoryRunLog()
  const fallbacks = memoryFallbackLog()
  return {
    log,
    fallbacks,
    ctx: {
      tenantId,
      callerKey: 'run-1',
      memory: new InMemoryMemoryStore(),
      log,
      ai,
      fallbacks
    }
  }
}
const callsOf = (ai: ReturnType<typeof agents>, agent: string) =>
  ai.mock.calls.filter((c) => c[0].callerKey.startsWith(`${agent}:`))

describe('reading the planning input', () => {
  it('refuses a pulse for other days and a send time outside the hours', () => {
    expect(() => readPlanInput({ ...input, start: '2026-11-17' })).toThrow(
      'The pulse is for other days'
    )
    expect(() => readPlanInput({ ...input, sendTime: '23:30' })).toThrow()
    expect(() => readPlanInput({ ...input, start: '16 Nov' })).toThrow()
  })

  it('keeps only the pulse’s own offers, with its codes and end dates', () => {
    const read = readPlanInput({
      ...input,
      offers: [
        { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 50, until: null },
        { id: 'offer:BIGSALE40', code: 'BIGSALE40', percent: 40, until: null }
      ]
    })
    expect(read.offers).toEqual([
      {
        id: 'offer:CANDLE10',
        code: 'CANDLE10',
        percent: 10,
        until: '2026-11-22'
      }
    ])
  })
})

describe('the brief check (code)', () => {
  it('passes a good brief', () => {
    expect(checkBrief(brief, input)).toEqual([])
  })
  it('names each problem exactly', () => {
    expect(
      checkBrief(
        {
          actions: [
            {
              goal: 'Run thirty percent off everything this week.',
              evidenceIds: ['offer:BIGSALE40'],
              from: '2026-11-29',
              to: '2026-12-02',
              offerId: 'offer:BIGSALE40'
            }
          ]
        },
        input
      )
    ).toEqual([
      'Action 0: "offer:BIGSALE40" is not one of the fact ids.',
      'Action 0: its dates must be inside 2026-11-16 to 2026-11-30.',
      'Action 0: "offer:BIGSALE40" is not an allowed offer.',
      'Action 0: the goal writes "thirty".'
    ])
  })
})

describe('the calendar rules (code)', () => {
  it('pass a good calendar', () => {
    expect([...calendarProblems(calendar.slots, input, brief.actions)]).toEqual(
      []
    )
  })

  it('refuse the wrong days, products, offers, audiences and times', () => {
    const problems = calendarProblems(
      [
        slot({ date: '2026-12-01' }),
        slot({ date: '2026-11-25', actionIndex: 2 }),
        slot({ productIds: ['p-stone-vase', 'p-made-up'], date: '2026-11-21' }),
        slot({ actionIndex: 1, date: '2026-11-22', audienceId: 'aud-x' }),
        slot({ actionIndex: 9, angle: 'Only seven left', time: '23:00' }),
        slot({ date: '2026-11-19', actionIndex: 3, productIds: ['p-oak-tray'] })
      ],
      input,
      brief.actions
    )
    expect(texts(problems, 0)).toContain('2026-12-01 is outside the 15 days.')
    expect(texts(problems, 1)).toEqual([
      "2026-11-25 is outside its action's dates.",
      '2026-11-25 is a day with no emails.'
    ])
    expect(texts(problems, 2)).toEqual([
      'Stone vase is out of stock.',
      '"p-made-up" is not one of the store\'s products.'
    ])
    expect(texts(problems, 3)).toContain(
      '"aud-x" is not one of the store\'s audiences.'
    )
    expect(texts(problems, 4)).toEqual([
      'there is no action 9 in the brief.',
      '23:00 is outside the send hours.',
      'the angle writes "seven".'
    ])
    expect(texts(problems, 5)).toContain(
      'Oak tray is not on sale until 2026-11-20.'
    )
  })

  it('tie offers to offer emails, and refuse an offer after it ends', () => {
    const problems = calendarProblems(
      [
        slot({ actionIndex: 1, date: '2026-11-17', emailType: 'offer' }),
        slot({ actionIndex: 0, offerId: 'offer:WELCOME15' }),
        slot({
          actionIndex: 1,
          date: '2026-11-22',
          emailType: 'offer',
          offerId: 'offer:CANDLE10'
        })
      ],
      {
        ...input,
        offers: input.offers.map((o) => ({
          ...o,
          until: o.until ? '2026-11-21' : null
        }))
      },
      brief.actions
    )
    expect(texts(problems, 0)).toContain(
      'an offer email needs one of the allowed offers.'
    )
    expect(texts(problems, 1)).toContain(
      'only an email of type "offer" carries an offer.'
    )
    expect(texts(problems, 2)).toContain('the offer ends before 2026-11-22.')
  })

  it('keep to the sends per week and one email per audience per day', () => {
    const story = (date: string) =>
      slot({ actionIndex: 1, date, emailType: 'story', productIds: [] })
    const problems = calendarProblems(
      [
        ...['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map(story),
        story('2026-11-19')
      ],
      input,
      brief.actions
    )
    expect(texts(problems, 3)).toEqual([
      'the week of 2026-11-16 would have more than 3 emails.'
    ])
    expect(texts(problems, 4)).toContain(
      'there is already an email to this audience on 2026-11-19.'
    )
  })

  it('keep offers to at most 40% of a week and 7 days apart', () => {
    const two = [
      slot({
        actionIndex: 1,
        date: '2026-11-16',
        emailType: 'offer',
        offerId: 'offer:WELCOME15'
      }),
      slot({
        actionIndex: 1,
        date: '2026-11-18',
        emailType: 'offer',
        offerId: 'offer:CANDLE10'
      })
    ]
    const problems = calendarProblems(two, input, brief.actions)
    expect(texts(problems, 1)).toContain(
      'it is too close to another offer email.'
    )
    expect(texts(problems, 1)).toContain(
      'too many of this week’s emails carry an offer.'
    )
    expect(
      texts(calendarProblems([offerSlot], input, brief.actions), 0)
    ).toEqual(['too many of this week’s emails carry an offer.'])
  })

  it('count sends planned before the 15 days', () => {
    const problems = calendarProblems(
      [offerSlot, storySlot, slot({})],
      {
        ...input,
        existing: [
          { date: '2026-11-13', audienceId: 'aud-engaged', offer: true }
        ]
      },
      brief.actions
    )
    expect(texts(problems, 0)).toEqual([
      'it is too close to another offer email.'
    ])
  })

  it('work across a year end', () => {
    const dec = {
      ...input,
      start: '2026-12-25',
      pulse: { ...pulse, start: '2026-12-25' }
    }
    const actions = [
      {
        goal: 'A plain email.',
        evidenceIds: [],
        from: '2026-12-25',
        to: '2027-01-08',
        offerId: null
      }
    ]
    const problems = calendarProblems(
      [
        slot({ date: '2027-01-08', emailType: 'story', productIds: [] }),
        slot({ date: '2027-01-09', emailType: 'story', productIds: [] })
      ],
      dec,
      actions
    )
    expect(problems.has(0)).toBe(false)
    expect(texts(problems, 1)).toContain('2027-01-09 is outside the 15 days.')
  })
})

describe('what ships is checked again after every drop', () => {
  it('drops the offer when a dropped email leaves it over 40% of its week', () => {
    const slots = [
      slot({ ...offerSlot, date: '2026-11-16' }),
      slot({ ...storySlot, actionIndex: 1, date: '2026-11-18' }),
      slot({ ...storySlot, actionIndex: 1, date: '2026-11-19' })
    ]
    const blackout = { ...input, blackouts: ['2026-11-18'] }
    const actions = brief.actions.map((a) => ({
      ...a,
      from: '2026-11-16',
      to: '2026-11-22'
    }))
    // One of three is fine until the blackout email goes.
    const first = calendarProblems(slots, blackout, actions)
    expect([...first.keys()]).toEqual([1])
    const { kept, dropped } = keepPassing(slots, first, blackout, actions)
    expect(kept.map((s) => s.date)).toEqual(['2026-11-19'])
    expect(dropped.flat().map((p) => p.rule)).toEqual([
      'blackout',
      'offer_share'
    ])
    // The same when the critic, not a rule, removes the email.
    const critic = new Map([
      [1, [{ rule: 'critic' as const, text: 'Adds little.' }]]
    ])
    expect(
      keepPassing(slots, critic, input, actions).kept.map((s) => s.date)
    ).toEqual(['2026-11-19'])
  })
})

describe('planning the next 15 days', () => {
  it('writes the brief, the calendar and passes the critic', async () => {
    const ai = agents({
      'brief-writer': [brief],
      'calendar-planner': [calendar],
      'strategy-critic': [{ issues: [] }]
    })
    const { ctx, log, fallbacks } = context(ai)
    const plan = await planFifteenDays(input, ctx)
    expect(plan.source).toEqual({
      brief: 'agent',
      planner: 'agent',
      critic: 'agent'
    })
    expect(plan.dropped).toBe(0)
    expect(plan.notes).toEqual([])
    expect(plan.slots.map((s) => [s.date, s.emailType])).toEqual([
      ['2026-11-17', 'offer'],
      ['2026-11-18', 'story'],
      ['2026-11-20', 'launch'],
      ['2026-11-23', 'gift guide']
    ])
    expect(plan.slots[0]).toMatchObject({
      offer: { id: 'offer:CANDLE10', code: 'CANDLE10', percent: 10 },
      products: [{ id: 'p-cedar-candle', title: 'Cedar candle' }],
      audience: { id: 'aud-engaged', label: 'Engaged subscribers' },
      why: 'Use the candle offer before it ends, while stock lasts.',
      evidence: [
        {
          id: 'offer:CANDLE10',
          fact: '10% off with CANDLE10, until 2026-11-22.'
        },
        { id: 'stock:p-cedar-candle', fact: 'Cedar candle has only 7 left.' }
      ]
    })
    expect(log.entries.map((e) => [e.agent, e.verdict])).toEqual([
      ['brief-writer', 'ok'],
      ['calendar-planner', 'ok'],
      ['strategy-critic', 'ok']
    ])
    expect(fallbacks.entries()).toEqual([])
    expect(ai.mock.calls.map((c) => c[0].purpose)).toEqual([
      'plan',
      'plan',
      'review'
    ])
  })

  it('gives the planner its last plan and every problem, keeps the best round, and drops what still fails', async () => {
    const withExtra = {
      slots: [
        ...calendar.slots,
        slot({
          actionIndex: 2,
          date: '2026-11-25',
          emailType: 'story',
          productIds: []
        })
      ]
    }
    const ai = agents({
      'brief-writer': [brief],
      'calendar-planner': [withExtra, withExtra, withExtra],
      'strategy-critic': [
        {
          issues: [{ slotIndex: 1, problem: 'The studio email adds little.' }]
        },
        { issues: [{ slotIndex: 1, problem: 'Still adds little.' }] },
        { issues: [] }
      ]
    })
    const { ctx, fallbacks } = context(ai)
    const plan = await planFifteenDays(input, ctx)
    const planner = callsOf(ai, 'calendar-planner')
    expect(planner).toHaveLength(3)
    const second = JSON.parse(planner[1][0].request.user)
    expect(second.previous_plan).toHaveLength(5)
    expect(second.previous_plan[4]).toMatchObject({
      slotIndex: 4,
      date: '2026-11-25'
    })
    expect(second.problems_with_previous_plan).toEqual([
      'Slot 1: The studio email adds little.',
      "Slot 4: 2026-11-25 is outside its action's dates.",
      'Slot 4: 2026-11-25 is a day with no emails.'
    ])
    // The last round had only the rule problem: one email dropped.
    expect(plan.dropped).toBe(1)
    expect(plan.slots.map((s) => s.date)).not.toContain('2026-11-25')
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'calendar-rules',
        reasonCode: 'slots_dropped',
        reason: 'One email broke the calendar rules.',
        detail: { dropped: 1, rules: ['blackout', 'outside_action'] }
      })
    ])
  })

  it('drops an offer that the critic’s drop pushes over the share, and logs both causes', async () => {
    const ai = agents({
      'brief-writer': [brief],
      'calendar-planner': [
        {
          slots: [
            offerSlot,
            storySlot,
            slot({
              ...giftSlot,
              actionIndex: 3,
              date: '2026-11-19',
              productIds: []
            })
          ]
        }
      ],
      'strategy-critic': [{ issues: [{ slotIndex: 1, problem: 'Weak.' }] }]
    })
    // The planner answers once; the revision is refused: the best plan stays.
    const { ctx, fallbacks } = context(ai)
    const plan = await planFifteenDays(input, ctx)
    expect(plan.slots.map((s) => s.date)).toEqual(['2026-11-19'])
    expect(fallbacks.entries().map((e) => [e.agent, e.reasonCode])).toEqual([
      ['calendar-planner', 'planner_agent_failed'],
      ['calendar-rules', 'slots_dropped'],
      ['strategy-critic', 'slots_dropped']
    ])
    expect(fallbacks.entries()[0]).toMatchObject({
      fallback: 'Kept its best earlier plan.'
    })
  })

  it('falls back to a plain brief and a plain calendar when the agents cannot answer', async () => {
    const ai = agents({})
    const { ctx, fallbacks } = context(ai)
    const plan = await planFifteenDays(input, ctx)
    expect(plan.source).toEqual({
      brief: 'code',
      planner: 'code',
      critic: 'skipped'
    })
    expect(plan.slots.length).toBeGreaterThan(0)
    // The plain launch email goes out on launch day, with the launched product.
    const launch = plan.slots.find(
      (s) => s.emailType === 'launch' && s.products[0]?.id === 'p-oak-tray'
    )
    expect(launch?.date).toBe('2026-11-20')
    expect(fallbacks.entries().map((e) => e.reasonCode)).toEqual([
      'brief_agent_failed',
      'planner_agent_failed',
      'critic_agent_failed'
    ])
    // A refused call is not retried.
    expect(ai).toHaveBeenCalledTimes(3)
    // The log carries no codes, products or email words.
    expect(JSON.stringify(fallbacks.entries())).not.toMatch(
      /CANDLE|WELCOME|Oak|Linen|tray/i
    )
  })

  it('retries answers in the wrong shape, for the brief and the critic', async () => {
    const ai = agents({
      'brief-writer': [{ actions: 'nope' }, { wrong: true }, { actions: [] }],
      'calendar-planner': [
        { slots: [slot({ actionIndex: 7 })] },
        { slots: [slot({ actionIndex: 0 })] }
      ],
      'strategy-critic': [
        { nonsense: 1 },
        { issues: [{ slotIndex: 5, problem: 'Not here.' }] },
        { issues: [] }
      ]
    })
    const { ctx, fallbacks } = context(ai)
    const plan = await planFifteenDays(input, ctx)
    expect(callsOf(ai, 'brief-writer')).toHaveLength(3)
    expect(plan.source.brief).toBe('code')
    expect(fallbacks.entries()[0]).toMatchObject({
      agent: 'brief-writer',
      reasonCode: 'brief_answer_invalid',
      reason: 'The Brief writer kept answering in the wrong shape.'
    })
    // The planner is told exactly which action does not exist.
    expect(
      JSON.parse(callsOf(ai, 'calendar-planner')[1][0].request.user)
        .fix_these_problems_from_your_last_answer
    ).toEqual(['A slot points at action 7, which is not in the brief.'])
    // The critic gets three tries too, and its last answer counts.
    expect(callsOf(ai, 'strategy-critic')).toHaveLength(3)
    expect(plan.source.critic).toBe('agent')
  })

  it('says why no offer fits with two emails a week', async () => {
    const ai = agents({
      'brief-writer': [brief],
      'calendar-planner': [{ slots: [offerSlot, slot({})] }],
      'strategy-critic': [{ issues: [] }]
    })
    const { ctx } = context(ai)
    const plan = await planFifteenDays({ ...input, sendsPerWeek: 2 }, ctx)
    expect(plan.slots.some((s) => s.offer)).toBe(false)
    expect(plan.notes).toEqual([
      'With 2 emails a week, an offer email would be more than 40% of the week, so no offer was planned. Choose more emails a week to run an offer.'
    ])
  })

  it('keeps the agent definitions honest', () => {
    expect(
      [briefWriterAgent, calendarPlannerAgent, strategyCriticAgent].map((a) => [
        a.name,
        a.purpose
      ])
    ).toEqual([
      ['brief-writer', 'plan'],
      ['calendar-planner', 'plan'],
      ['strategy-critic', 'review']
    ])
  })
})

describe('the planner’s products', () => {
  it('shows the products the pulse names first, in stock only, and not too many', () => {
    const many = {
      ...input,
      products: [
        ...Array.from({ length: 60 }, (_, i) => ({
          id: `p-extra-${i}`,
          title: `Extra ${i}`,
          inStock: true,
          availableFrom: null
        })),
        ...input.products
      ]
    }
    const shown = productsForPlanner(many)
    expect(shown).toHaveLength(plannerProducts)
    expect(shown.slice(0, 4).map((p) => p.id)).toEqual([
      'p-linen-throw',
      'p-cedar-candle',
      'p-oak-tray',
      'p-wool-cushion'
    ])
    expect(shown.some((p) => p.id === 'p-stone-vase')).toBe(false)
  })
})

describe('the plain steps', () => {
  it('a plain brief covers launches in stock, the first offer and the competitor moves', () => {
    expect(codeBrief(input).map((a) => [a.evidenceIds, a.from])).toEqual([
      [['launch:p-linen-throw'], '2026-11-16'],
      [['launch:p-oak-tray'], '2026-11-20'],
      [['offer:WELCOME15'], '2026-11-16'],
      [['pattern:1'], '2026-11-22'],
      [['pattern:2'], '2026-11-26']
    ])
  })
  it('a plain calendar only places what the rules allow', () => {
    const actions = codeBrief(input)
    const slots = codeSlots(input, actions)
    expect([...calendarProblems(slots, input, actions)]).toEqual([])
  })
})
