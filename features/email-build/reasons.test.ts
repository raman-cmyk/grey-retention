// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memoryFallbackLog } from '@/features/fallback/log'
import { ladderPlaces } from '@/features/offers/ladder'
import { gatherEvidence } from '@/features/strategy/pulse'
import { sampleStore } from '@/features/strategy/sample'
import { builtEmail, plannedEmail, type PlannedEmail } from './build'
import { sampleOffersFrom, sampleStoreFrom } from './ports'
import {
  fittedEmail,
  maxReasons,
  reasonLines,
  reasonsFor,
  type DesignReason
} from './reasons'
import { runBuildStep } from './steps'

/**
 * PICK-104 (owner pick #104, "One-line design reasons"): each main choice
 * of an email gets one plain sentence that says why, built from the facts
 * GROS used when it made the choice, and nothing when there is no fact.
 */
const planned = (over: Partial<PlannedEmail> = {}): PlannedEmail => ({
  date: '2026-11-20',
  time: '09:00',
  emailType: 'bestseller',
  angle: 'What everyone bought this month',
  products: [
    { id: 'p1', title: 'Cedar candle' },
    { id: 'p2', title: 'Linen throw' }
  ],
  offer: null,
  audience: { id: 'a1', label: 'Engaged subscribers' },
  ...over
})
const email = (over: Record<string, unknown> = {}) =>
  builtEmail.parse({
    sample: false,
    ai: false,
    name: 'Fri 20 Nov · Bestseller',
    subject: 'Our cedar candle is back',
    preheader: 'Warm nights start here.',
    html: '<p>B</p>',
    approach: 'A',
    copy: 'plain',
    plannedSendAt: '2026-11-20T09:00:00Z',
    audienceId: 'a1',
    productIds: ['p1', 'p2'],
    code: null,
    changes: [],
    ...over
  })
const sold = (id: string, title: string, n: number) => ({
  id: `bestseller:${id}`,
  fact: `${title} sold ${n} in the last 30 days.`
})
const kinds = (reasons: readonly DesignReason[]) => reasons.map((r) => r.kind)

describe('a product reason (the plan’s own fact about it)', () => {
  it('says the units sold, from the plan’s evidence, and names that fact', () => {
    const reasons = reasonsFor({
      planned: planned({ evidence: [sold('p1', 'Cedar candle', 118)] }),
      email: email(),
      progress: {}
    })
    expect(reasons).toEqual([
      {
        kind: 'product',
        text: 'Cedar candle is in this email because it is one of your bestsellers: it sold 118 in the 30 days before this plan.',
        facts: [{ from: 'plan', key: 'evidence:bestseller:p1' }]
      }
    ])
  })

  it('says “the hero” only when the locked hero section shows it', () => {
    const progress = {
      content: {
        sections: [
          { family: 'header_logo', products: [] },
          { family: 'hero_product', products: [{ id: 'p1' }] }
        ]
      }
    }
    const [hero] = reasonsFor({
      planned: planned({ evidence: [sold('p1', 'Cedar candle', 118)] }),
      email: email(),
      progress
    })
    expect(hero!.text).toBe(
      'The hero shows Cedar candle because it is one of your bestsellers: it sold 118 in the 30 days before this plan.'
    )
    // A copied design's sections are another email's: no hero claim.
    const [copied] = reasonsFor({
      planned: planned({ evidence: [sold('p1', 'Cedar candle', 118)] }),
      email: email({
        library: { emailId: 'e1', sections: [], footerAdded: false }
      }),
      progress
    })
    expect(copied!.text).toMatch(/^Cedar candle is in this email because/)
  })

  it('says a launch, with the day from the fact', () => {
    const reasons = reasonsFor({
      planned: planned({
        evidence: [
          { id: 'launch:p1', fact: 'Cedar candle launches on 2026-11-20.' },
          {
            id: 'launch:p2',
            fact: 'Linen throw is new (launched 2026-11-02).'
          }
        ]
      }),
      email: email(),
      progress: {}
    })
    expect(reasons.map((r) => r.text)).toEqual([
      'Cedar candle is in this email because it is new: it launches on 20 Nov.',
      'Linen throw is in this email because it is new: it launched on 2 Nov.'
    ])
    expect(reasons[1]!.facts).toEqual([
      { from: 'plan', key: 'evidence:launch:p2' }
    ])
  })

  it('reads the pulse’s facts as the pulse writes them', () => {
    // The sample store's own pulse: a template drift breaks this test.
    const evidence = gatherEvidence(sampleStore('2026-03-02')).evidence
    const pick = (id: string) => evidence.find((e) => e.id === id)!
    const reasons = reasonsFor({
      planned: planned({
        products: [
          { id: 'p-cedar-candle', title: 'Cedar candle' },
          { id: 'p-oak-tray', title: 'Oak tray' }
        ],
        evidence: [
          pick('bestseller:p-cedar-candle'),
          pick('launch:p-oak-tray')
        ].map(({ id, fact }) => ({ id, fact }))
      }),
      email: email({ productIds: ['p-cedar-candle', 'p-oak-tray'] }),
      progress: {}
    })
    expect(reasons.map((r) => r.text)).toEqual([
      'Cedar candle is in this email because it is one of your bestsellers: it sold 118 in the 30 days before this plan.',
      'Oak tray is in this email because it is new: it launches on 6 Mar.'
    ])
  })

  it('says nothing for a product without a fact, a replaced product, or a fact in other words', () => {
    // No evidence at all (a plan made before it, or none for this email).
    expect(
      reasonsFor({ planned: planned(), email: email(), progress: {} })
    ).toEqual([])
    // The plan's fact is about another product than the email shows.
    expect(
      reasonsFor({
        planned: planned({ evidence: [sold('p9', 'Oak tray', 30)] }),
        email: email(),
        progress: {}
      })
    ).toEqual([])
    // The Content locker replaced the planned product.
    expect(
      reasonsFor({
        planned: planned({ evidence: [sold('p1', 'Cedar candle', 118)] }),
        email: email({ productIds: ['p2'] }),
        progress: {}
      })
    ).toEqual([])
    // A stock fact, or a sentence not in the pulse's words, is no reason.
    expect(
      reasonsFor({
        planned: planned({
          evidence: [
            { id: 'stock:p1', fact: 'Cedar candle has only 7 left.' },
            { id: 'bestseller:p2', fact: 'Linen throw sells very well.' }
          ]
        }),
        email: email(),
        progress: {}
      })
    ).toEqual([])
  })
})

describe('an offer reason (the offer ladder, #40)', () => {
  const offer = { id: 'offer:SMALL10', code: 'SMALL10', percent: 10 }
  const offerEmail = (over: Record<string, unknown> = {}) =>
    email({
      code: 'SMALL10',
      offer: { percent: 10, expiresAt: null },
      ...over
    })
  const text = (p: Partial<PlannedEmail>, e = offerEmail()) =>
    reasonsFor({ planned: planned(p), email: e, progress: {} }).find(
      (r) => r.kind === 'offer'
    )?.text

  it('says where the ladder put it, from the place the plan kept', () => {
    expect(
      text({
        offer,
        ladder: { step: 1, steps: 2, before: null, lowest: true }
      })
    ).toBe(
      'The offer is 10% off with SMALL10, on the first of 2 offer days in this plan: a sale starts with your smallest discount code of at least 10% and steps up from there.'
    )
    expect(
      text(
        {
          offer: { id: 'offer:MID15', code: 'MID15', percent: 15 },
          ladder: { step: 2, steps: 2, before: 10, lowest: false }
        },
        offerEmail({ code: 'MID15', offer: { percent: 15, expiresAt: null } })
      )
    ).toBe(
      'The offer is 15% off with MID15, on the second of 2 offer days in this plan: a sale steps up, so it goes up from 10% in the offer email before it.'
    )
    expect(
      text({ offer, ladder: { step: 1, steps: 1, before: 10, lowest: true } })
    ).toBe(
      'The offer is 10% off with SMALL10: a sale never steps down, so it stays at 10% like the offer email before it.'
    )
    const reason = reasonsFor({
      planned: planned({
        offer,
        ladder: { step: 1, steps: 1, before: null, lowest: true }
      }),
      email: offerEmail(),
      progress: {}
    })[0]!
    expect(reason.facts).toEqual([
      { from: 'plan', key: 'offer' },
      { from: 'plan', key: 'ladder' }
    ])
  })

  it('says nothing without the ladder’s place, or when the email shows another offer', () => {
    // A plan made before PICK-104 kept no place.
    expect(text({ offer })).toBeUndefined()
    const ladder = { step: 1, steps: 1, before: null, lowest: true }
    // The Content locker dropped the offer, or the code is another one.
    expect(
      text({ offer, ladder }, email({ code: null, offer: null }))
    ).toBeUndefined()
    expect(
      text({ offer, ladder }, offerEmail({ code: 'OTHER10' }))
    ).toBeUndefined()
    expect(
      text(
        { offer, ladder },
        offerEmail({ offer: { percent: 15, expiresAt: null } })
      )
    ).toBeUndefined()
    // Not the smallest, no email before it, or a step down: no claim.
    expect(
      text({ offer, ladder: { ...ladder, lowest: false } })
    ).toBeUndefined()
    expect(text({ offer, ladder: { ...ladder, before: 25 } })).toBeUndefined()
  })
})

describe('a send time reason (PICK-97)', () => {
  const timing = {
    basis: 'segment' as const,
    strength: 'clear' as const,
    othersTried: true,
    best: '09:00',
    moved: false
  }

  it('says the time, the group and why, in PICK-97’s words', () => {
    const [reason] = reasonsFor({
      planned: planned({ timing }),
      email: email(),
      progress: {}
    })
    expect(reason).toEqual({
      kind: 'send_time',
      text: 'The suggested send time for “Engaged subscribers” is 9:00 am: when this group opens and clicks most.',
      facts: [
        { from: 'plan', key: 'time' },
        { from: 'plan', key: 'audience' },
        { from: 'plan', key: 'timing' }
      ]
    })
    expect(
      reasonsFor({
        planned: planned({
          time: '12:00',
          timing: { ...timing, moved: true }
        }),
        email: email(),
        progress: {}
      })[0]!.text
    ).toBe(
      'The suggested send time for “Engaged subscribers” is 12:00 pm: moved from 9:00 am so two emails that day are not too close.'
    )
  })

  it('says nothing when no history was counted, or for another audience', () => {
    expect(
      reasonsFor({ planned: planned(), email: email(), progress: {} })
    ).toEqual([])
    expect(
      reasonsFor({
        planned: planned({ timing }),
        email: email({ audienceId: 'a2' }),
        progress: {}
      })
    ).toEqual([])
  })
})

describe('a layout reason (the inspiration email, DST-002b)', () => {
  const reference = {
    emailId: 'e1',
    mode: 'copy',
    reason:
      'We copy Glow Co’s email “The candle edit” (2 Nov 2026), the email you chose in Inspiration.'
  }

  it('says the reason the sections step saved, first', () => {
    const reasons = reasonsFor({
      planned: planned({ evidence: [sold('p1', 'Cedar candle', 118)] }),
      email: email(),
      progress: { sections: { reference } }
    })
    expect(kinds(reasons)).toEqual(['layout', 'product'])
    expect(reasons[0]).toEqual({
      kind: 'layout',
      text: reference.reason,
      facts: [{ from: 'sections', key: 'reference:e1' }]
    })
  })

  it('says nothing for a text email, from scratch, or an odd saved step', () => {
    expect(
      reasonsFor({
        planned: planned(),
        email: email({ format: 'text', text: 'Hi' }),
        progress: { sections: { reference } }
      })
    ).toEqual([])
    expect(
      reasonsFor({ planned: planned(), email: email(), progress: {} })
    ).toEqual([])
    for (const progress of [
      null,
      'odd',
      { sections: { reference: { emailId: 'e1' } } },
      { content: { sections: 'odd' } }
    ])
      expect(
        reasonsFor({ planned: planned(), email: email(), progress })
      ).toEqual([])
  })
})

describe('the reasons together', () => {
  it('puts the most visible first and keeps at most five', () => {
    const reasons = reasonsFor({
      planned: planned({
        offer: { id: 'offer:SMALL10', code: 'SMALL10', percent: 10 },
        ladder: { step: 1, steps: 1, before: null, lowest: true },
        timing: {
          basis: 'store',
          strength: 'close',
          othersTried: true,
          best: '09:00',
          moved: false
        },
        evidence: [
          sold('p1', 'Cedar candle', 118),
          sold('p2', 'Linen throw', 42)
        ]
      }),
      email: email({
        code: 'SMALL10',
        offer: { percent: 10, expiresAt: null }
      }),
      progress: {
        sections: {
          reference: {
            emailId: 'e1',
            mode: 'remix',
            reason: 'We remix Glow Co’s email “Edit” (2 Nov 2026).'
          }
        }
      }
    })
    expect(kinds(reasons)).toEqual([
      'layout',
      'product',
      'offer',
      'send_time',
      'product'
    ])
    expect(reasons).toHaveLength(maxReasons)
    // Every number in them is the stored fact's own.
    expect(
      reasons
        .map((r) => r.text)
        .join(' ')
        .match(/\d+/g)
    ).toEqual([
      '2',
      '2026',
      '118',
      '30',
      '10',
      '10',
      '10',
      '9',
      '00',
      '42',
      '30'
    ])
    expect(reasonLines(reasons)).toHaveLength(5)
    expect(reasonLines(undefined)).toEqual([])
  })
})

describe('stored with the email (the design step)', () => {
  const start = '2026-03-02'
  const tenantId = '00000000-0000-4000-8000-000000000101'
  const slot = {
    date: '2026-03-04',
    time: '10:00',
    emailType: 'bestseller',
    angle: 'What everyone bought this month',
    products: [
      { id: 'p-cedar-candle', title: 'Cedar candle' },
      { id: 'p-linen-throw', title: 'Linen throw' }
    ],
    offer: null,
    audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' },
    why: 'Remind subscribers of the store’s best products.',
    evidence: [
      {
        id: 'bestseller:p-cedar-candle',
        fact: 'Cedar candle sold 118 in the last 30 days.'
      }
    ],
    timing: {
      basis: 'usual',
      strength: 'none',
      othersTried: false,
      best: '10:00',
      moved: false
    }
  }
  async function build(raw: unknown) {
    const parsed = plannedEmail.parse(raw)
    const progress: Record<string, unknown> = {}
    const ctx = {
      tenantId,
      callerKey: 'email-build:b1',
      fallbacks: memoryFallbackLog(),
      clock: () => Date.parse('2026-03-01T00:00:00Z')
    }
    for (const step of ['sections', 'content', 'copy', 'design'] as const) {
      const made = await runBuildStep(
        step,
        {
          planned: parsed,
          store: await sampleStoreFrom(start).read(tenantId),
          offers: sampleOffersFrom(start),
          progress,
          planStart: start
        },
        ctx
      )
      if (!made.ok) throw new Error(`${step} failed: ${made.code}`)
      if ('email' in made) return builtEmail.parse(made.email)
      if (!('output' in made)) throw new Error(`${step} did not finish`)
      progress[step] = JSON.parse(JSON.stringify(made.output))
    }
    throw new Error('no email')
  }

  it('keeps the reasons the plan’s facts give, as the worker stores them', async () => {
    const made = await build(slot)
    expect(made.reasons?.map((r) => r.text)).toEqual([
      'The hero shows Cedar candle because it is one of your bestsellers: it sold 118 in the 30 days before the plan starting 2 Mar.',
      'The suggested send time for “Engaged subscribers (sample)” is 10:00 am: not enough history yet; your usual send time.'
    ])
  })

  it('stores none for a slot planned before it (no facts kept)', async () => {
    const made = await build({
      ...slot,
      evidence: undefined,
      timing: undefined
    })
    expect(made.reasons).toBeUndefined()
    // An odd stored list never stops the email being read.
    expect(
      builtEmail.parse({ ...made, reasons: [{ kind: 'nope' }] }).reasons
    ).toBeUndefined()
  })
})

describe('the ladder’s place for each offer email (ladderPlaces)', () => {
  const offers = [
    { id: 'offer:A5', code: 'A5', percent: 5, until: null },
    { id: 'offer:B10', code: 'B10', percent: 10, until: null },
    { id: 'offer:C15', code: 'C15', percent: 15, until: '2026-11-20' },
    { id: 'offer:D25', code: 'D25', percent: 25, until: null }
  ]

  it('counts the offer days, the percent before, and the smallest of at least 10%', () => {
    expect(
      ladderPlaces(
        [
          { date: '2026-11-16', percent: 10 },
          { date: '2026-11-18', percent: null },
          { date: '2026-11-23', percent: 25 },
          { date: '2026-11-23', percent: 25 }
        ],
        offers,
        null
      )
    ).toEqual([
      { step: 1, steps: 2, before: null, lowest: true },
      null,
      // C15 no longer works that day: 25% is not the smallest (10% is).
      { step: 2, steps: 2, before: 10, lowest: false },
      { step: 2, steps: 2, before: 10, lowest: false }
    ])
  })

  it('goes on from the earlier email it picked up, and with no code of 10% any code', () => {
    expect(
      ladderPlaces([{ date: '2026-11-16', percent: 25 }], offers, {
        percent: 25
      })
    ).toEqual([{ step: 1, steps: 1, before: 25, lowest: false }])
    expect(
      ladderPlaces([{ date: '2026-11-16', percent: 5 }], [offers[0]!], null)
    ).toEqual([{ step: 1, steps: 1, before: null, lowest: true }])
  })
})

describe('the review fixes (PICK-104)', () => {
  it('dates the sales figure to the plan, never as if it were today', () => {
    const at = (planStart?: string) =>
      reasonsFor({
        planned: planned({ evidence: [sold('p1', 'Cedar candle', 118)] }),
        email: email(),
        progress: {},
        ...(planStart !== undefined ? { planStart } : {})
      })[0]!.text
    expect(at('2026-11-16')).toBe(
      'Cedar candle is in this email because it is one of your bestsellers: it sold 118 in the 30 days before the plan starting 16 Nov.'
    )
    // A day it cannot read is left out, never shown wrong.
    for (const odd of ['2026-02-30', 'soon', ''])
      expect(at(odd)).toMatch(/in the 30 days before this plan\.$/)
  })

  it('gives no launch reason for a date that is not a real day, and never throws', () => {
    expect(
      reasonsFor({
        planned: planned({
          evidence: [
            { id: 'launch:p1', fact: 'Cedar candle launches on 2026-13-45.' },
            {
              id: 'launch:p2',
              fact: 'Linen throw is new (launched 2026-02-30).'
            }
          ]
        }),
        email: email(),
        progress: {}
      })
    ).toEqual([])
  })

  it('says “steps up from there” only when the plan has more offer days', () => {
    const [one] = reasonsFor({
      planned: planned({
        offer: { id: 'offer:SMALL10', code: 'SMALL10', percent: 10 },
        ladder: { step: 1, steps: 1, before: null, lowest: true }
      }),
      email: email({
        code: 'SMALL10',
        offer: { percent: 10, expiresAt: null }
      }),
      progress: {}
    })
    expect(one!.text).toBe(
      'The offer is 10% off with SMALL10: a sale starts with your smallest discount code of at least 10%.'
    )
  })

  it('gives no “We copy …” reason when the library copy fell back to coded blocks', () => {
    const reference = (mode: 'copy' | 'remix') => ({
      sections: {
        reference: {
          emailId: 'e1',
          mode,
          reason: `We ${mode} Glow Co’s email “Edit” (2 Nov 2026).`
        }
      }
    })
    const layout = (mode: 'copy' | 'remix', copyFellBack: boolean) =>
      reasonsFor({
        planned: planned(),
        email: email(),
        progress: reference(mode),
        copyFellBack
      }).map((r) => r.kind)
    expect(layout('copy', true)).toEqual([])
    expect(layout('copy', false)).toEqual(['layout'])
    // A remix is never a library copy: its reason stands.
    expect(layout('remix', true)).toEqual(['layout'])
  })

  it('drops the reasons, never the email, when they would make it too large', () => {
    const reasons = [
      {
        kind: 'product' as const,
        text: 'Cedar candle is in this email because it sold 118.',
        facts: [{ from: 'plan' as const, key: 'evidence:bestseller:p1' }]
      }
    ]
    const made = email({ reasons })
    const size = (e: object) =>
      new TextEncoder().encode(JSON.stringify(e)).length
    const bare = email()
    expect(fittedEmail(made, size(made))).toBe(made)
    const fitted = fittedEmail(made, size(made) - 1)
    expect(fitted).toEqual(bare)
    expect(fitted).not.toHaveProperty('reasons')
    // Too large on its own: still refused, as before.
    expect(fittedEmail(made, size(bare) - 1)).toBeNull()
    expect(fittedEmail(bare, size(bare) - 1)).toBeNull()
  })
})
