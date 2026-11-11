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
  planFifteenDays,
  strategyCriticAgent,
  type PlanInput,
  type Slot
} from './plan'
import { sampleCompetitors, sampleStore } from './sample'

const tenantId = '00000000-0000-4000-8000-000000000101'
const start = '2026-11-16'
const store = sampleStore(start)
const competitors = sampleCompetitors(start)
const input: PlanInput = {
  industry: 'home',
  start,
  sendsPerWeek: 3,
  sendTime: '10:00',
  pulse: codePulse(gatherEvidence(store)),
  offers: codePulse(gatherEvidence(store)).offers,
  moves: codeMoves(
    mapPatterns({ industry: 'home', brandSize: 'small', start, ...competitors })
  ),
  products: store.products.map((p) => ({
    id: p.id,
    title: p.title,
    inStock: p.stock !== 0
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
      evidenceIds: ['date:2026-11-19:Studio-open-day'],
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
const calendar = {
  slots: [
    slot({
      actionIndex: 1,
      date: '2026-11-17',
      emailType: 'offer',
      angle: 'The candle people love, for less',
      productIds: ['p-cedar-candle'],
      offerId: 'offer:CANDLE10'
    }),
    slot({
      actionIndex: 3,
      date: '2026-11-18',
      emailType: 'story',
      angle: 'Come to the studio',
      productIds: []
    }),
    slot({}),
    slot({
      actionIndex: 2,
      date: '2026-11-23',
      time: '09:30',
      emailType: 'gift guide',
      angle: 'Gifts for slow mornings',
      productIds: ['p-linen-throw', 'p-wool-cushion']
    })
  ]
}

/** Answers per agent, in order. */
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
              goal: 'Run 30% off everything this week.',
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
      'Action 1: "offer:BIGSALE40" is not one of the fact ids.',
      'Action 1: its dates must be inside 2026-11-16 to 2026-11-30.',
      'Action 1: "offer:BIGSALE40" is not an allowed offer.',
      'Action 1: the goal writes a number, percentage or code.'
    ])
  })
})

describe('the calendar rules (code)', () => {
  it('pass a good calendar', () => {
    expect([...calendarProblems(calendar.slots, input, brief.actions)]).toEqual(
      []
    )
  })

  it('refuse the wrong days, products, offers and audiences', () => {
    const problems = calendarProblems(
      [
        slot({ date: '2026-12-01' }),
        slot({ date: '2026-11-25', actionIndex: 2 }),
        slot({ productIds: ['p-stone-vase', 'p-made-up'], date: '2026-11-21' }),
        slot({
          actionIndex: 1,
          date: '2026-11-22',
          offerId: 'offer:CANDLE10',
          audienceId: 'aud-x'
        }),
        slot({ actionIndex: 9, angle: 'Only 7 left' })
      ],
      input,
      brief.actions
    )
    expect(problems.get(0)).toContain('2026-12-01 is outside the 15 days.')
    expect(problems.get(1)).toEqual([
      "2026-11-25 is outside its action's dates.",
      '2026-11-25 is a day with no emails.'
    ])
    expect(problems.get(2)).toEqual([
      'Stone vase is out of stock.',
      '"p-made-up" is not one of the store\'s products.'
    ])
    expect(problems.get(3)).toContain(
      '"aud-x" is not one of the store\'s audiences.'
    )
    expect(problems.get(4)).toEqual([
      'there is no action 10 in the brief.',
      'the angle writes a number, percentage or code.'
    ])
  })

  it('keep to the sends per week and one email per audience per day', () => {
    const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map(
      (date) => slot({ actionIndex: 1, date, emailType: 'story' })
    )
    const problems = calendarProblems(
      [...week, slot({ actionIndex: 1, date: '2026-11-19' })],
      input,
      brief.actions
    )
    expect(problems.get(3)).toEqual([
      'the week of 2026-11-16 would have more than 3 emails.'
    ])
    expect(problems.get(4)).toContain(
      'there is already an email to this audience on 2026-11-19.'
    )
  })

  it('keep offers to at most 40% of a week and apart from each other', () => {
    const two = [
      slot({ actionIndex: 1, date: '2026-11-16', offerId: 'offer:WELCOME15' }),
      slot({ actionIndex: 1, date: '2026-11-18', offerId: 'offer:CANDLE10' })
    ]
    const problems = calendarProblems(two, input, brief.actions)
    expect(problems.get(1)).toContain('it is too close to another offer email.')
    expect(problems.get(1)).toContain(
      'too many of this week’s emails carry an offer.'
    )
    // One offer in a week of three is fine; alone in its week it is not.
    expect(calendarProblems(calendar.slots, input, brief.actions).has(0)).toBe(
      false
    )
    expect(
      calendarProblems([calendar.slots[0]], input, brief.actions).get(0)
    ).toEqual(['too many of this week’s emails carry an offer.'])
  })

  it('count emails already planned', () => {
    const problems = calendarProblems(
      [slot({ date: '2026-11-20' })],
      {
        ...input,
        existing: ['2026-11-16', '2026-11-17', '2026-11-20'].map((date) => ({
          date,
          audienceId: 'aud-engaged',
          offer: false
        }))
      },
      brief.actions
    )
    expect(problems.get(0)).toEqual([
      'there is already an email to this audience on 2026-11-20.',
      'the week of 2026-11-16 would have more than 3 emails.'
    ])
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
    expect(plan.slots[3].evidence[0].fact).toBe(
      '2 days before Public holiday: 3 of 5 similar brands. They sent a gift guide email (no offer, gifting).'
    )
    expect(log.entries.map((e) => [e.agent, e.verdict])).toEqual([
      ['brief-writer', 'ok'],
      ['calendar-planner', 'ok'],
      ['strategy-critic', 'ok']
    ])
    expect(fallbacks.entries()).toEqual([])
    const purposes = ai.mock.calls.map((c) => c[0].purpose)
    expect(purposes).toEqual(['plan', 'plan', 'review'])
  })

  it('gives the planner the critic’s and the rules’ problems, at most twice, then drops what still fails', async () => {
    const withExtra = {
      slots: [...calendar.slots, slot({ actionIndex: 2, date: '2026-11-25' })]
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
    const plannerCalls = ai.mock.calls.filter((c) =>
      c[0].callerKey.startsWith('calendar-planner')
    )
    expect(plannerCalls).toHaveLength(3)
    const second = JSON.parse(plannerCalls[1][0].request.user)
    expect(second.fix_these_problems_from_your_last_answer).toEqual([
      'Slot 1: The studio email adds little.',
      "Slot 4: 2026-11-25 is outside its action's dates.",
      'Slot 4: 2026-11-25 is a day with no emails.'
    ])
    // The blackout email still breaks a rule after two rounds: dropped.
    expect(plan.dropped).toBe(1)
    expect(plan.slots.map((s) => s.date)).not.toContain('2026-11-25')
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'strategy-critic',
        reasonCode: 'slots_dropped',
        reason:
          'One email still failed the calendar rules or the critic after 2 rounds.'
      })
    ])
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
    expect([
      ...calendarProblems(
        plan.slots.map((s) => ({
          actionIndex: 0,
          date: s.date,
          time: s.time,
          emailType: s.emailType,
          angle: s.angle,
          productIds: s.products.map((p) => p.id),
          offerId: s.offer?.id ?? null,
          audienceId: s.audience.id
        })),
        input,
        plan.brief.map((a) => ({ ...a, from: input.start, to: '2026-11-30' }))
      )
    ]).toEqual([])
    expect(fallbacks.entries().map((e) => e.reasonCode)).toEqual([
      'brief_agent_failed',
      'planner_agent_failed',
      'critic_unavailable'
    ])
    // A refused call is not retried.
    expect(ai).toHaveBeenCalledTimes(3)
  })

  it('retries a brief that fails the facts check with the exact problems', async () => {
    const bad = {
      actions: [{ ...brief.actions[0], goal: 'Launch with 20% off today.' }]
    }
    const ai = agents({
      'brief-writer': [bad, brief],
      'calendar-planner': [calendar],
      'strategy-critic': [{ issues: [] }]
    })
    const { ctx } = context(ai)
    const plan = await planFifteenDays(input, ctx)
    expect(plan.source.brief).toBe('agent')
    const retry = JSON.parse(
      ai.mock.calls.filter((c) =>
        c[0].callerKey.startsWith('brief-writer')
      )[1][0].request.user
    )
    expect(retry.fix_these_problems_from_your_last_answer).toEqual([
      'Action 1: the goal writes a number, percentage or code.'
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

describe('the plain steps', () => {
  it('a plain brief covers launches, the first offer and the competitor moves', () => {
    expect(codeBrief(input).map((a) => a.evidenceIds)).toEqual([
      ['launch:p-linen-throw'],
      ['launch:p-oak-tray'],
      ['offer:WELCOME15'],
      ['pattern:1'],
      ['pattern:2']
    ])
  })
  it('a plain calendar only places what the rules allow', () => {
    const actions = codeBrief(input)
    const slots = codeSlots(input, actions)
    expect([...calendarProblems(slots, input, actions)]).toEqual([])
  })
})
