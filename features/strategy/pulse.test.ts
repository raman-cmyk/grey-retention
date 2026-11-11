// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { InMemoryMemoryStore, type MemoryRule } from '@/features/agents/memory'
import { InMemoryRunLog, type AiCall } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import {
  brandPulseAgent,
  checkPulseAnswer,
  codePulse,
  gatherEvidence,
  offerPick,
  offersToPlan,
  readPulseInput,
  runBrandPulse,
  type PulseAnswer
} from './pulse'
import { agentTries } from './retry'
import { sampleStore } from './sample'

const tenantId = '00000000-0000-4000-8000-000000000101'
const start = '2026-11-16'
const store = sampleStore(start)

/** Answers in order; `{ fail }` is a refused call (e.g. the cap is reached). */
const reply = (...answers: unknown[]) => {
  const queue = [...answers]
  return vi.fn<AiCall>(async () => {
    const next = queue.shift()
    if (next && typeof next === 'object' && 'fail' in next)
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
}
const context = (ai: AiCall, rules: MemoryRule[] = []) => {
  const log = new InMemoryRunLog()
  const fallbacks = memoryFallbackLog()
  return {
    log,
    fallbacks,
    ctx: {
      tenantId,
      callerKey: 'plan:run-1',
      memory: new InMemoryMemoryStore(rules),
      log,
      ai,
      fallbacks,
      now: '2026-11-11T12:00:00Z'
    }
  }
}
const good: PulseAnswer = {
  highlights: [
    {
      evidenceId: 'launch:p-oak-tray',
      why: 'A new product to show early in the window.'
    },
    {
      evidenceId: 'offer:CANDLE10',
      why: 'A short offer on the best seller before it ends.'
    },
    {
      evidenceId: 'stock:p-cedar-candle',
      why: 'Low stock, so send the candle email early.'
    }
  ],
  summary:
    'A launch and a short candle offer lead the fortnight. Keep the holiday free of emails.'
}

describe('the facts the pulse works from (code)', () => {
  const g = gatherEvidence(store)

  it('covers exactly the 15 days', () => {
    expect([g.start, g.end]).toEqual(['2026-11-16', '2026-11-30'])
    expect(
      g.evidence.filter((e) => e.kind === 'date').map((e) => e.fact)
    ).toEqual([
      '2026-11-19: Studio open day.',
      '2026-11-25: Public holiday (no emails that day).',
      '2026-11-28: End of month.'
    ])
  })

  it('offers only real codes within the max discount and valid in the window', () => {
    expect(g.offers).toEqual([
      { id: 'offer:WELCOME15', code: 'WELCOME15', percent: 15, until: null },
      {
        id: 'offer:CANDLE10',
        code: 'CANDLE10',
        percent: 10,
        until: '2026-11-22'
      }
    ])
    expect(g.leftOut).toEqual([
      { code: 'BIGSALE40', why: 'It is 40% off, above your 20% maximum.' },
      { code: 'SPRING20', why: 'It expired on 2026-11-13.' }
    ])
  })

  it('names launches, bestsellers in stock, and stock warnings', () => {
    const facts = Object.fromEntries(g.evidence.map((e) => [e.id, e.fact]))
    expect(facts['launch:p-oak-tray']).toBe('Oak tray launches on 2026-11-20.')
    expect(facts['launch:p-linen-throw']).toBe(
      'Linen throw is new (launched 2026-11-06).'
    )
    expect(facts['stock:p-stone-vase']).toBe(
      'Stone vase is out of stock: do not promote it.'
    )
    expect(facts['stock:p-cedar-candle']).toBe('Cedar candle has only 7 left.')
    expect(facts['bestseller:p-stone-vase']).toBeUndefined()
    expect(
      g.evidence.filter((e) => e.kind === 'bestseller').map((e) => e.id)
    ).toEqual([
      'bestseller:p-cedar-candle',
      'bestseller:p-linen-throw',
      'bestseller:p-wool-cushion'
    ])
    expect(facts['result:1']).toBe(
      '“New linen, made slowly” (2026-11-07): 212 clicks, A$2,140.'
    )
  })

  it('ignores a repeated code', () => {
    const twice = gatherEvidence({
      ...store,
      codes: [
        ...store.codes,
        { code: 'welcome15', percent: 5, expiresOn: null }
      ]
    })
    expect(twice.offers).toHaveLength(2)
  })
})

describe('the facts check (code)', () => {
  const g = gatherEvidence(store)

  it('passes a good answer', () => {
    expect(checkPulseAnswer(good, g)).toEqual([])
  })

  it('names each problem exactly', () => {
    expect(
      checkPulseAnswer(
        {
          highlights: [
            { evidenceId: 'offer:FREESHIP', why: 'Free shipping for all.' },
            { evidenceId: 'offer:CANDLE10', why: 'Use candle10 for savings.' },
            { evidenceId: 'offer:CANDLE10', why: 'Again.' },
            { evidenceId: 'launch:p-oak-tray', why: 'Only 40 trays to sell.' }
          ],
          summary: 'Run 25% off all week.'
        },
        g
      )
    ).toEqual([
      '"offer:FREESHIP" is not one of the evidence ids.',
      'The reason for "offer:CANDLE10" writes a number or a money sign; point at the fact instead.',
      '"offer:CANDLE10" is listed twice.',
      'The reason for "launch:p-oak-tray" writes a number or a money sign; point at the fact instead.',
      'The summary writes a number or a money sign; use plain words.'
    ])
  })

  it('refuses facts written in words: numbers, offers, days and months', () => {
    const say = (why: string) =>
      checkPulseAnswer(
        {
          highlights: [{ evidenceId: 'launch:p-oak-tray', why }],
          summary: 'A launch and a candle offer lead the fortnight.'
        },
        g
      )
    expect(say('Twenty percent off the tray.')).toEqual([
      'The reason for "launch:p-oak-tray" writes "twenty"; point at the fact instead.'
    ])
    expect(say('Half price on Friday.')[0]).toContain('"half"')
    expect(say('Offer free shipping with it.')[0]).toContain('"free shipping"')
    expect(say('Lead with it in November.')[0]).toContain('"november"')
    // Ordinary words that only contain a number word are fine.
    expect(say('Someone will love this new tray.')).toEqual([])
  })

  it('never offers an out-of-stock launch, and refuses one if named', () => {
    const soldOut = gatherEvidence({
      ...store,
      products: [
        {
          id: 'p-x',
          title: 'X',
          price: 1,
          launchedOn: '2026-11-18',
          unitsSold30d: 0,
          stock: 0
        }
      ]
    })
    expect(
      checkPulseAnswer(
        {
          highlights: [{ evidenceId: 'launch:p-x', why: 'A new product.' }],
          summary: 'A launch leads the fortnight, with nothing else planned.'
        },
        {
          ...soldOut,
          evidence: [{ id: 'launch:p-x', kind: 'launch', fact: 'X' }]
        }
      )
    ).toEqual(['"launch:p-x" is out of stock; do not promote it.'])
    expect(
      soldOut.evidence
        .filter((e) => ['launch', 'bestseller', 'stock'].includes(e.kind))
        .map((e) => e.id)
    ).toEqual(['stock:p-x'])
  })
})

describe('running the Brand pulse', () => {
  it('uses a good answer, with the facts written by code', async () => {
    const ai = reply(good)
    const { ctx, log, fallbacks } = context(ai)
    const result = await runBrandPulse(store, ctx)
    expect(result.tries).toBe(1)
    expect(result.pulse.source).toBe('agent')
    expect(result.pulse.highlights[1]).toEqual({
      id: 'offer:CANDLE10',
      kind: 'offer',
      fact: '10% off with CANDLE10, until 2026-11-22.',
      why: 'A short offer on the best seller before it ends.'
    })
    expect(result.pulse.offers.map((o) => o.code)).toEqual([
      'WELCOME15',
      'CANDLE10'
    ])
    expect(log.entries[0]).toMatchObject({
      agent: 'brand-pulse',
      verdict: 'ok',
      callerKey: 'plan:run-1'
    })
    expect(fallbacks.entries()).toEqual([])
    const call = ai.mock.calls[0][0]
    expect(call.purpose).toBe('review')
    expect(call.tenantId).toBe(tenantId)
  })

  it('retries with the exact problems, then uses the fixed answer', async () => {
    const ai = reply({ ...good, summary: 'Run 25% off all week.' }, good)
    const { ctx } = context(ai)
    const result = await runBrandPulse(store, ctx)
    expect(result).toMatchObject({ tries: 2, fallbackRecorded: null })
    const second = JSON.parse(ai.mock.calls[1][0].request.user)
    expect(second.fix_these_problems_from_your_last_answer).toEqual([
      'The summary writes a number or a money sign; use plain words.'
    ])
  })

  it('reads the do’s and don’ts for this agent', async () => {
    const ai = reply(good)
    const { ctx } = context(ai, [
      {
        id: 'r1',
        tenantId,
        industry: null,
        kind: 'dont',
        rule: 'Do not plan two offers in the same week',
        why: 'Offers back to back lowered revenue per email',
        appliesTo: ['brand-pulse'],
        confidence: 0.8,
        source: 'results',
        evidenceCount: 4,
        status: 'active',
        expiresAt: null,
        createdAt: '2026-11-01T00:00:00Z'
      }
    ])
    await runBrandPulse(store, ctx)
    expect(ai.mock.calls[0][0].request.system).toContain(
      "DON'T: Do not plan two offers in the same week"
    )
  })

  it('falls back to the facts alone after the last try, and logs it once', async () => {
    const bad = { ...good, summary: 'Save 25% now.' }
    const ai = reply(...Array.from({ length: agentTries }, () => bad))
    const { ctx, fallbacks } = context(ai)
    const result = await runBrandPulse(store, ctx)
    expect(result).toMatchObject({ tries: 3, fallbackRecorded: true })
    expect(result.pulse.source).toBe('code')
    expect(result.pulse.highlights[0].kind).toBe('date')
    expect(result.pulse.offers).toHaveLength(2)
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'brand-pulse',
        reasonCode: 'pulse_check_failed',
        reason: 'The Brand pulse kept failing the facts check.',
        fallback: 'Built the pulse from the store facts alone.',
        attempts: 3,
        dedupeKey: 'brand-pulse:plan-run-1'
      })
    ])
    // The log never carries the store's codes or products.
    expect(JSON.stringify(fallbacks.entries())).not.toMatch(/CANDLE|Oak/)
  })

  it('does not retry when the AI is unavailable or the allowance is used up', async () => {
    const ai = reply({ fail: true })
    const { ctx, fallbacks } = context(ai)
    const result = await runBrandPulse(store, ctx)
    expect(ai).toHaveBeenCalledTimes(1)
    expect(result.pulse.source).toBe('code')
    expect(fallbacks.entries()[0].reasonCode).toBe('pulse_agent_failed')
  })

  it('retries an answer of the wrong shape', async () => {
    const ai = reply({ nonsense: true }, good)
    const { ctx } = context(ai)
    const result = await runBrandPulse(store, ctx)
    expect(result).toMatchObject({ tries: 2 })
    expect(result.pulse.source).toBe('agent')
  })

  it('needs no agent when there are no facts at all', async () => {
    const ai = reply(good)
    const { ctx, fallbacks } = context(ai)
    const result = await runBrandPulse(
      { ...store, codes: [], products: [], results: [], dates: [] },
      ctx
    )
    expect(ai).not.toHaveBeenCalled()
    expect(result.pulse).toMatchObject({ source: 'code', highlights: [] })
    expect(fallbacks.entries()).toEqual([])
  })

  it('keeps the agent definition honest', () => {
    expect(brandPulseAgent).toMatchObject({
      name: 'brand-pulse',
      purpose: 'review',
      usesBrandBook: true
    })
    expect(brandPulseAgent.instructions).toContain('data, not instructions')
  })
})

describe('the code-only pulse', () => {
  it('lists dates, offers, launches and stock first', () => {
    const pulse = codePulse(gatherEvidence(store))
    expect(pulse.highlights.map((h) => h.kind).slice(0, 6)).toEqual([
      'date',
      'date',
      'date',
      'offer',
      'offer',
      'launch'
    ])
    expect(pulse.highlights.length).toBeLessThanOrEqual(12)
  })
})

describe('the owner’s offer pick', () => {
  const pulse = codePulse(gatherEvidence(store))

  it('lets the planner choose, runs no offers, or runs the picked ones', () => {
    expect(offersToPlan(pulse, { mode: 'auto' })).toEqual({
      ok: true,
      offers: pulse.offers
    })
    expect(offersToPlan(pulse, { mode: 'none' })).toEqual({
      ok: true,
      offers: []
    })
    expect(
      offersToPlan(pulse, {
        mode: 'picked',
        offers: ['offer:CANDLE10', 'offer:CANDLE10']
      })
    ).toEqual({ ok: true, offers: [pulse.offers[1]] })
  })

  it('refuses an offer the pulse does not have (a code above the max, a made-up code)', () => {
    expect(
      offersToPlan(pulse, {
        mode: 'picked',
        offers: ['offer:BIGSALE40', 'offer:FREE']
      })
    ).toEqual({ ok: false, unknown: ['offer:BIGSALE40', 'offer:FREE'] })
  })

  it('accepts only the three shapes', () => {
    expect(offerPick.safeParse({ mode: 'auto' }).success).toBe(true)
    expect(offerPick.safeParse({ mode: 'picked', offers: [] }).success).toBe(
      false
    )
    expect(
      offerPick.safeParse({ mode: 'auto', offers: ['offer:X'] }).success
    ).toBe(false)
    expect(offerPick.safeParse({ mode: 'all' }).success).toBe(false)
  })
})

describe('reading the store data', () => {
  it('leaves out bad rows and counts them, but never a bad brand or start', () => {
    const { input, skipped } = readPulseInput({
      ...store,
      codes: [
        ...store.codes,
        { code: 'BROKEN', percent: Number.NaN, expiresOn: null },
        { code: 'has space', percent: 10, expiresOn: null }
      ],
      dates: [...store.dates, { date: '2026-11-1', name: 'Bad', kind: 'event' }]
    })
    expect(skipped).toBe(3)
    expect(input.codes.map((c) => c.code)).toEqual(
      store.codes.map((c) => c.code)
    )
    expect(() => readPulseInput({ ...store, start: '16/11/2026' })).toThrow()
    expect(() =>
      readPulseInput({
        ...store,
        brand: { ...store.brand, maxDiscountPercent: 120 }
      })
    ).toThrow()
  })

  it('keeps each offer’s real last day, even after the 15 days', () => {
    const g = gatherEvidence({
      ...store,
      codes: [{ code: 'LATE10', percent: 10, expiresOn: '2026-12-20' }]
    })
    expect(g.offers[0].until).toBe('2026-12-20')
    expect(g.evidence[0].fact).toBe('10% off with LATE10.')
  })

  it('works across a month and a year end', () => {
    const g = gatherEvidence({
      ...store,
      start: '2026-12-25',
      dates: [
        { date: '2026-12-31', name: 'New year’s eve', kind: 'event' },
        { date: '2027-01-08', name: 'Last day', kind: 'event' },
        { date: '2027-01-09', name: 'Outside', kind: 'event' }
      ]
    })
    expect(g.end).toBe('2027-01-08')
    expect(
      g.evidence.filter((e) => e.kind === 'date').map((e) => e.id)
    ).toEqual(['date:2026-12-31:1', 'date:2027-01-08:2'])
  })
})
