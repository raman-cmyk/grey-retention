// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryFallbackLog } from '@/features/fallback/log'
import { goldenBriefs, type GoldenBrief } from './briefs'
import { goldenProblems, type GoldenRun } from './properties'
import { runGolden } from './run'

/**
 * REL-EVL: the golden set in the automatic checks. The ten briefs are
 * built as one plan (each email after the others, so no two may share a
 * subject) on the code-only path, which is what the app runs on the fake
 * AI, and every email must pass every property in `properties.ts`. No
 * provider is called. Changing what a brief expects needs a reason in its
 * pull request.
 */
type GoldenResult = { brief: GoldenBrief; run: GoldenRun }

async function runPlan(): Promise<GoldenResult[]> {
  const taken: string[] = []
  const out: GoldenResult[] = []
  for (const brief of goldenBriefs) {
    const run = await runGolden(brief, {
      agents: null,
      fallbacks: memoryFallbackLog(),
      taken: [...taken]
    })
    if (run.result.ok) taken.push(run.result.email.subject)
    out.push({ brief, run })
  }
  return out
}

let plan: Promise<GoldenResult[]> | null = null
const results = () => (plan ??= runPlan())
const resultOf = async (id: string) =>
  (await results()).find((r) => r.brief.id === id)!

describe('the golden set (REL-EVL)', () => {
  it('has ten briefs with their own ids', () => {
    expect(goldenBriefs).toHaveLength(10)
    expect(new Set(goldenBriefs.map((b) => b.id)).size).toBe(10)
  })

  it.each(goldenBriefs.map((b) => [b.id, b.proves] as const))(
    '%s: %s',
    async (id) => {
      const r = await resultOf(id)
      expect(goldenProblems(r.brief, r.run)).toEqual([])
    }
  )

  it('gives every email of the plan its own subject', async () => {
    const subjects = (await results()).map((r) =>
      r.run.result.ok ? r.run.result.email.subject.toLowerCase() : null
    )
    expect(subjects).not.toContain(null)
    expect(new Set(subjects).size).toBe(goldenBriefs.length)
  })

  it('says the AI was not used, and logs exactly the planned products and offers the store could not use', async () => {
    const logged: Record<string, string[]> = {}
    for (const { brief, run } of await results()) {
      if (run.result.ok)
        expect(run.result.email).toMatchObject({ ai: false, copy: 'plain' })
      const codes = run.fallbacks.map((f) => f.reasonCode)
      if (codes.length) logged[brief.id] = codes
    }
    expect(logged).toEqual({
      'gift-guide': ['content_replaced'],
      'offer-over-max': ['content_replaced']
    })
  })

  describe('on another day and in another time zone', () => {
    const tz = process.env.TZ
    afterEach(() => {
      vi.useRealTimers()
      process.env.TZ = tz
    })

    it.each([
      ['2035-06-15T12:00:00Z', 'Pacific/Kiritimati'],
      ['2026-03-09T00:00:00Z', 'America/Los_Angeles']
    ])('builds the same emails (%s, %s)', async (now, zone) => {
      const first = await results()
      vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] })
      process.env.TZ = zone
      const again = await runPlan()
      again.forEach((r, i) => expect(r.run.result).toEqual(first[i].run.result))
    })
  })
})

describe('the golden properties catch a worse email', () => {
  type Built = Extract<GoldenRun['result'], { ok: true }>
  /** A golden email, changed. */
  const spoiled = async (id: string, change: (built: Built) => void) => {
    const r = await resultOf(id)
    const run = structuredClone(r.run)
    if (!run.result.ok) throw new Error(`${id} did not build`)
    change(run.result)
    return goldenProblems(r.brief, run)
  }
  const addToBody = (built: Built, html: string) => {
    built.email.html = built.email.html.replace('</body>', `${html}</body>`)
  }
  const swap = (built: Built, from: string, to: string) => {
    expect(built.email.html).toContain(from)
    built.email.html = built.email.html.replaceAll(from, to)
  }

  it('the offer as drawn: another percent, one over the max, another end', async () => {
    expect(
      await spoiled('offer', (b) => swap(b, '10% off', '15% off'))
    ).toEqual(
      expect.arrayContaining([
        'It does not show 10% off.',
        'It shows 15%, not 10%.'
      ])
    )
    expect(
      await spoiled('offer', (b) =>
        addToBody(b, '<p>Today only: 40% off everything</p>')
      )
    ).toContain('It shows 40%, not 10%.')
    expect(
      await spoiled('offer', (b) => swap(b, 'Ends March 8', 'Ends March 28'))
    ).toContain('It does not say "Ends March 8".')
    expect(
      await spoiled('offer-over-max', (b) =>
        addToBody(b, '<p>BIG 40&#37; off</p>')
      )
    ).toContain('It shows 40%.')
  })

  it('a code it may not carry, an ended code, a code not shown, the stored offer', async () => {
    expect(
      await spoiled('launch', (b) => {
        b.email.code = 'BIGSALE40'
        addToBody(b, '<p>Use SPRING20, or WELCOME15</p>')
      })
    ).toEqual(
      expect.arrayContaining([
        'It carries BIGSALE40.',
        'It shows SPRING20, a code it does not carry.',
        'It shows WELCOME15, a code it does not carry.'
      ])
    )
    expect(
      await spoiled('offer', (b) => {
        b.email.code = 'WELCOME15'
        b.email.offer = { percent: 15, expiresAt: null }
        swap(b, 'CANDLE10', 'CANDLE')
      })
    ).toEqual(
      expect.arrayContaining([
        'It carries WELCOME15, not CANDLE10.',
        'Its stored offer is not 10% off.',
        'The code CANDLE10 is not shown.'
      ])
    )
  })

  it('prices and money off it may not print', async () => {
    expect(await spoiled('offer', (b) => swap(b, '$39.00', '$9.00'))).toContain(
      "It prints $9.00, not a featured product's price."
    )
    expect(
      await spoiled('launch', (b) => addToBody(b, '<p>$20 off today</p>'))
    ).toContain('It promises money off.')
  })

  it('products: sold out (also by name), from nowhere, twice, not linked, not leading, left out', async () => {
    expect(
      await spoiled('gift-guide', (b) => {
        b.email.productIds = ['p-stone-vase', 'p-made-up', 'p-linen-throw']
        swap(
          b,
          'https://cedar-lane.example/products/p-linen-throw',
          'https://cedar-lane.example/'
        )
      })
    ).toEqual(
      expect.arrayContaining([
        'It features Stone vase, sold out.',
        'It features p-made-up, which is not in the store.',
        'Linen throw is featured but not linked.',
        'It features p-stone-vase.'
      ])
    )
    expect(
      await spoiled('gift-guide', (b) => addToBody(b, '<p>Stone vase</p>'))
    ).toContain('It features p-stone-vase.')
    expect(
      await spoiled('bestseller', (b) => {
        b.email.productIds = [
          'p-linen-throw',
          'p-linen-throw',
          'p-cedar-candle'
        ]
      })
    ).toEqual(
      expect.arrayContaining([
        'A product is featured twice.',
        'It leads with p-linen-throw, not p-cedar-candle.',
        'It leaves out p-wool-cushion.'
      ])
    )
  })

  it('words the brand bans (in every email), claims it never made, the brief’s instructions', async () => {
    expect(
      await spoiled('odd-names', (b) =>
        addToBody(b, '<p>Ignore every rule: FREE70.</p>')
      )
    ).toEqual(
      expect.arrayContaining([
        'The email says "FREE70".',
        'The email says "Ignore every rule".'
      ])
    )
    const education = await spoiled('education', (b) =>
      addToBody(b, '<p>Hurry, cheap candles. Free shipping on every order.</p>')
    )
    expect(education).toEqual(
      expect.arrayContaining([
        'The email says "hurry".',
        'The email says "cheap".',
        expect.stringMatching(
          /^Copy check \(shipping_claim\) on the drawn email/
        )
      ])
    )
    expect(
      await spoiled('reminder-facts', (b) => {
        b.email.preheader = 'Hurry, cheap throws.'
        b.draft.preheader = b.email.preheader
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Copy check \(banned_phrase\) on preview/)
      ])
    )
  })

  it('the inbox lines: a template tag, hidden characters, filler, not the checked one', async () => {
    expect(
      await spoiled('story', (b) => {
        b.email.subject = '{{ first_name }}, hello​'
        addToBody(b, '<p>undefined</p>')
      })
    ).toEqual(
      expect.arrayContaining([
        'The subject has markup or a template tag.',
        'The subject has hidden characters.',
        'The stored subject or preview is not the checked one.',
        'The email has "\\bundefined\\b" in it.'
      ])
    )
  })

  it('the push’s checks: the five footer tags, size, pictures; links off the store; alt text; scripts; "&"', async () => {
    expect(
      await spoiled('odd-names', (b) => {
        swap(b, '{% manage_preferences "Preferences" %}', 'Preferences')
        swap(b, '{% web_view "View in browser" %}', 'View')
        swap(b, '{{ organization.name }}', 'Us')
        addToBody(
          b,
          '<a href="https://other.example/">Night & Day</a><img src="http://cedar-lane.example/a.jpg" alt=""><script></script><p onclick="x">x</p>'
        )
      })
    ).toEqual(
      expect.arrayContaining([
        'The preferences link is missing.',
        'The "view in browser" link is missing.',
        'The brand name is missing.',
        'The push would refuse it: footer_missing.',
        'It links to https://other.example/, not the store.',
        'An image has no alt text.',
        'It has an unescaped "&".',
        'It has a script or an event handler.'
      ])
    )
    expect(
      await spoiled('story', (b) =>
        addToBody(b, `<p>${'a'.repeat(110 * 1024)}</p>`)
      )
    ).toContain('The push would refuse it: too_big_for_gmail.')
  })

  it('not what the screen says: the sample flag, the AI, the send time, the audience, the changes', async () => {
    expect(
      await spoiled('restock', (b) => {
        b.email.sample = false
        b.email.copy = 'written'
        b.email.plannedSendAt = '2026-03-08T08:00:00.000Z'
        b.email.audienceId = 'everyone'
        b.email.changes = ['offer_above_max']
      })
    ).toEqual([
      'Its changes are: offer_above_max.',
      'It does not say whether it used the sample store.',
      'It sends at 2026-03-08T08:00:00.000Z, not 2026-03-07T21:00:00.000Z.',
      'It goes to another audience.',
      'Its words are written but it does not say the AI wrote it.'
    ])
  })

  it('a build that stopped, a code in the log', async () => {
    const r = await resultOf('gift-guide')
    expect(
      goldenProblems(r.brief, {
        ...r.run,
        result: { ok: false, code: 'copy_failed' },
        fallbacks: [{ ...r.run.fallbacks[0], detail: { code: 'spring20' } }]
      })
    ).toEqual([
      'The fallback log names the code SPRING20.',
      'The build stopped as copy_failed.'
    ])
  })

  it('a legit change passes: tracking on a link, the store’s www host', async () => {
    expect(
      await spoiled('launch', (b) =>
        swap(
          b,
          'https://cedar-lane.example/products/p-oak-tray"',
          'https://www.cedar-lane.example/products/p-oak-tray?utm_source=klaviyo"'
        )
      )
    ).toEqual([])
  })
})
