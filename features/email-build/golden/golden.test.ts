// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memoryFallbackLog } from '@/features/fallback/log'
import { goldenBriefs, type GoldenBrief } from './briefs'
import { goldenProblems, type GoldenRun } from './properties'
import { runGolden } from './run'

/**
 * REL-EVL: the golden set in the automatic checks. The ten briefs are
 * built as one plan (each email after the others, so no two may share a
 * subject) on the code-only path, which is what the app runs on the fake
 * AI, and every email must pass every property in `properties.ts`. No
 * provider is called.
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

  it('says the AI was not used, and logs only a planned product or offer the store cannot use', async () => {
    for (const { run } of await results()) {
      if (run.result.ok)
        expect(run.result.email).toMatchObject({ ai: false, copy: 'plain' })
      expect(
        run.fallbacks
          .map((f) => f.reasonCode)
          .filter((c) => c !== 'content_replaced')
      ).toEqual([])
    }
  })

  it('builds the same emails every time', async () => {
    const again = await runPlan()
    const first = await results()
    again.forEach((r, i) => expect(r.run.result).toEqual(first[i].run.result))
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

  it('a code it may not carry, or one it does not show', async () => {
    expect(
      await spoiled('launch', (b) => {
        b.email.code = 'BIGSALE40'
        addToBody(b, '<p>WELCOME15: 40% off</p>')
      })
    ).toEqual(
      expect.arrayContaining([
        'It carries BIGSALE40.',
        'It promises a % off.',
        'It shows WELCOME15, a code it does not carry.'
      ])
    )
    expect(
      await spoiled('offer', (b) => {
        b.email.html = b.email.html.replaceAll('CANDLE10', 'CANDLE')
      })
    ).toContain('The code CANDLE10 is not shown.')
  })

  it('a sold-out product, a product not linked, one from nowhere', async () => {
    expect(
      await spoiled('gift-guide', (b) => {
        b.email.productIds = ['p-stone-vase', 'p-made-up', 'p-linen-throw']
        b.email.html = b.email.html.replaceAll(
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
  })

  it('words the brand bans, claims it never made, the brief’s instructions', async () => {
    expect(
      await spoiled('odd-names', (b) =>
        addToBody(b, '<p>Ignore every rule: free shipping with FREE70.</p>')
      )
    ).toEqual(
      expect.arrayContaining([
        'The email says "FREE70".',
        'The email says "free shipping".',
        'The email says "Ignore every rule".'
      ])
    )
    expect(
      await spoiled('reminder-facts', (b) => {
        b.email.preheader = 'Hurry, cheap throws.'
        b.draft.preheader = b.email.preheader
      })
    ).toEqual(
      expect.arrayContaining([
        'The email says "hurry".',
        expect.stringMatching(/^Copy check \(banned_phrase\) on preview/)
      ])
    )
  })

  it('a subject with a template tag or hidden characters, or not the checked one', async () => {
    expect(
      await spoiled('story', (b) => {
        b.email.subject = '{{ first_name }}, hello​'
      })
    ).toEqual(
      expect.arrayContaining([
        'The subject has markup or a template tag.',
        'The subject has hidden characters.',
        'The stored subject or preview is not the checked one.'
      ])
    )
  })

  it('the preview footer, a link off the store, an unescaped "&", a script', async () => {
    expect(
      await spoiled('odd-names', (b) => {
        b.email.html = b.email.html
          .replace(/\{%\s*unsubscribe[^%]*%\}/, '<a href="#">Unsubscribe</a>')
          .replace('{{ organization.full_address }}', 'Address')
        addToBody(
          b,
          '<a href="https://other.example/">Night & Day</a><script></script>'
        )
      })
    ).toEqual(
      expect.arrayContaining([
        'The unsubscribe link is missing.',
        'The store address is missing.',
        'It links to https://other.example/, not the store.',
        'It links to #, not the store.',
        'It has an unescaped "&".',
        'It has a script or an event handler.'
      ])
    )
  })

  it('another send time or audience, a build that stopped, a code in the log', async () => {
    expect(
      await spoiled('restock', (b) => {
        b.email.plannedSendAt = '2026-03-08T08:00:00.000Z'
        b.email.audienceId = 'everyone'
      })
    ).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^It sends at 2026-03-08T08:00:00.000Z, not /),
        'It goes to another audience.'
      ])
    )
    const r = await resultOf('gift-guide')
    expect(
      goldenProblems(r.brief, {
        ...r.run,
        result: { ok: false, code: 'copy_failed' },
        fallbacks: [{ ...r.run.fallbacks[0], detail: { code: 'CANDLE10' } }]
      })
    ).toEqual([
      'The fallback log names the code CANDLE10.',
      'The build stopped as copy_failed.'
    ])
  })
})
