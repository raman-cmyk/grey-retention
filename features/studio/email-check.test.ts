// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { checkWholeEmail, type EmailCheckPorts } from './email-check'
import {
  emailChecklist,
  emailCriticProblems,
  maxEmailPictureBytes,
  type EmailPicture,
  type EmailVerdict
} from './email-critic'
import type { BuildView } from './waits'

/** DST-006d part 2b: the whole-email check, on fake ports. */
const html = '<!doctype html><p>The email</p>'
const key = 'e-abc'
const now = 1_000_000
const until = now + 20 * 60_000
const at = (n: number) => `0000000${n}-3333-4333-8333-333333333333`
const drawn = (view: 'desktop' | 'phone' | 'dark', n: number): BuildView => ({
  id: at(n),
  key,
  view,
  state: 'drawn',
  path: `email/${at(n)}.jpg`,
  height: 2100,
  cut: false,
  wide: false,
  bytes: 4,
  etag: '"v"'
})
const queued = (view: 'desktop' | 'phone' | 'dark', n: number): BuildView => ({
  id: at(n),
  key,
  view,
  state: 'queued'
})
const failed = (view: 'desktop' | 'phone' | 'dark', n: number): BuildView => ({
  id: at(n),
  key,
  view,
  state: 'failed',
  failure: 'timeout'
})
const all = [drawn('desktop', 1), drawn('phone', 2), drawn('dark', 3)]
const picture = (width: number): EmailPicture => ({
  bytes: new Uint8Array([1, 2, 3, 4]),
  contentType: 'image/jpeg',
  width,
  height: 2100,
  cut: false,
  wide: false
})
const nines = Object.fromEntries(
  emailChecklist.map((k) => [k, 9])
) as EmailVerdict['scores']
const passed: EmailVerdict = { pass: true, scores: nines, problems: [] }

function ports(
  over: Partial<{
    views: BuildView[]
    ask: EmailCheckPorts['ask']
    picture: EmailCheckPorts['picture']
    verdict: EmailVerdict | null
    fits: boolean
  }> = {}
) {
  return {
    ask: vi.fn(over.ask ?? (async () => {})),
    views: vi.fn(async () => over.views ?? all),
    picture: vi.fn(
      over.picture ?? (async (v) => picture(v.view === 'phone' ? 375 : 600))
    ),
    judge: vi.fn<EmailCheckPorts['judge']>(async () =>
      over.verdict === undefined ? passed : over.verdict
    ),
    fits: () => over.fits ?? true,
    now: () => now
  } satisfies EmailCheckPorts
}
const check = (
  p: EmailCheckPorts,
  change: { until?: number; waits?: number } = {}
) => checkWholeEmail({ html, key, until, waits: 1, ...change }, p)

describe('the whole-email check (DST-006d part 2b)', () => {
  it('asks for the three views once, then waits until the studio’s time is up', async () => {
    const p = ports({ views: [] })
    expect(await check(p)).toEqual({ wait: { seconds: 1200 } })
    expect(p.ask).toHaveBeenCalledWith(key, html)
    expect(p.views).toHaveBeenCalledWith(key)
    // Asked again when one is missing (the same views: the command keeps them).
    const partly = ports({ views: [queued('desktop', 1)] })
    expect(await check(partly)).toMatchObject({ wait: {} })
    expect(partly.ask).toHaveBeenCalledTimes(1)
    // Never more than an hour, never less than a minute.
    expect(
      await check(ports({ views: [] }), { until: now + 5 * 3_600_000 })
    ).toEqual({
      wait: { seconds: 3_600 }
    })
    expect(await check(ports({ views: [] }), { until: now + 1_000 })).toEqual({
      wait: { seconds: 60 }
    })
  })

  it('waits while desktop or phone is drawing, and for dark only while there is time', async () => {
    expect(
      await check(
        ports({
          views: [queued('desktop', 1), drawn('phone', 2), drawn('dark', 3)]
        })
      )
    ).toMatchObject({ wait: {} })
    const darkLate = ports({
      views: [drawn('desktop', 1), drawn('phone', 2), queued('dark', 3)]
    })
    expect(await check(darkLate)).toMatchObject({ wait: {} })
    // Its time up, the email is judged without dark.
    expect(await check(darkLate, { until: now })).toMatchObject({ pass: true })
    expect(darkLate.judge).toHaveBeenCalledWith({
      desktop: picture(600),
      phone: picture(375)
    })
  })

  it('judges the whole email with every view it has, and passes only what the critic passes', async () => {
    const p = ports()
    expect(await check(p)).toEqual({ pass: true, verdict: passed })
    expect(p.judge).toHaveBeenCalledWith({
      desktop: picture(600),
      phone: picture(375),
      dark: picture(600)
    })
    expect(p.ask).not.toHaveBeenCalled()
    expect(
      await check(
        ports({
          verdict: {
            pass: false,
            scores: { ...nines, button: 6, phone: 7 },
            // Even a fix shaped like code's own line is never logged.
            problems: [
              'The SAVE20 code (bold) scored 3 of 10.',
              'Make the SAVE20 code larger.'
            ]
          }
        })
      )
    ).toEqual({
      pass: false,
      reason: 'not_passed',
      // Code's own line from the scores, never the critic's words.
      problem: 'The button (easy to see and tap, clear words) scored 6 of 10.'
    })
    expect(await check(ports({ verdict: null }))).toEqual({
      pass: false,
      reason: 'no_verdict'
    })
  })

  it('passes on every line code writes for the critic, and none of its fixes', async () => {
    for (const item of emailChecklist) {
      const scores = Object.fromEntries(
        emailChecklist.map((k) => [k, k === item ? 5 : 9])
      ) as EmailVerdict['scores']
      const verdict = emailCriticProblems(
        { scores, fixes: ['Show the code SAVE20 bigger.'] },
        { desktop: picture(600), phone: picture(375) }
      )
      const out = await check(ports({ verdict }))
      expect(out).toMatchObject({ pass: false, problem: verdict.problems[0] })
      expect(JSON.stringify(out)).not.toContain('SAVE20')
    }
    const wide = emailCriticProblems(
      {
        scores: Object.fromEntries(emailChecklist.map((k) => [k, 9])) as never,
        fixes: []
      },
      { desktop: picture(600), phone: { ...picture(375), wide: true } }
    )
    // The phone view as the browser measured it: wider than its screen.
    const widePhone = ports({
      verdict: wide,
      picture: async (v) =>
        v.view === 'phone' ? { ...picture(375), wide: true } : picture(600)
    })
    expect(await check(widePhone)).toMatchObject({
      problem: wide.problems[0]
    })
  })

  it('draws coded when the time or the waits are up, or desktop or phone failed or cannot be read back', async () => {
    for (const [p, change, reason] of [
      [ports({ views: [] }), { until: now }, 'no_time_left'],
      [ports({ views: [] }), { waits: 6 }, 'no_time_left'],
      [ports({ views: [drawn('desktop', 1)] }), { until: now }, 'no_time'],
      [
        ports({
          views: [queued('desktop', 1), drawn('phone', 2), drawn('dark', 3)]
        }),
        { until: now - 1 },
        'no_time'
      ],
      [
        ports({
          views: [failed('desktop', 1), drawn('phone', 2), drawn('dark', 3)]
        }),
        {},
        'view_failed'
      ],
      [
        ports({
          picture: async (v) => (v.view === 'phone' ? null : picture(600))
        }),
        {},
        'view_unusable'
      ]
    ] as const)
      expect(await check(p, change)).toEqual({ pass: false, reason })
    // A dark view that failed or cannot be read is left out.
    const noDark = ports({
      views: [drawn('desktop', 1), drawn('phone', 2), failed('dark', 3)]
    })
    expect(await check(noDark)).toMatchObject({ pass: true })
    const darkGone = ports({
      picture: async (v) =>
        v.view === 'dark' ? null : picture(v.view === 'phone' ? 375 : 600)
    })
    expect(await check(darkGone)).toMatchObject({ pass: true })
    expect(darkGone.judge.mock.calls[0]![0]).not.toHaveProperty('dark')
  })

  it('reads the database’s refusals as reasons and lets anything else throw (the step is tried again)', async () => {
    for (const [error, reason] of [
      [
        Object.assign(new Error('Too large.'), { name: 'EmailNotDrawable' }),
        'not_drawable'
      ],
      [{ code: '22023', details: 'too_many_previews' }, 'too_many'],
      [
        { code: '22023', message: 'A render needs the email’s page' },
        'not_drawable'
      ],
      [
        { code: 'PT409', message: "This key is another email's" },
        'not_drawable'
      ]
    ] as const)
      expect(
        await check(
          ports({
            views: [],
            ask: async () => {
              throw error
            }
          })
        )
      ).toEqual({ pass: false, reason })
    for (const error of [
      { code: 'PT409', message: 'Lease unavailable' },
      new Error('network down')
    ])
      await expect(
        check(
          ports({
            views: [],
            ask: async () => {
              throw error
            }
          })
        )
      ).rejects.toBe(error)
  })

  it('needs room for the critic’s three tries, pauses for them while a wait is left, even past the window', async () => {
    const fits = vi.fn((calls?: number) => (calls ?? 1) <= 1)
    const p = { ...ports(), fits }
    expect(await check(p)).toEqual({ paused: { seconds: 1200 } })
    expect(fits).toHaveBeenCalledWith(3)
    expect(p.judge).not.toHaveBeenCalled()
    // The views are in: past the window, the next claim still judges them.
    expect(await check({ ...ports(), fits }, { until: now - 1 })).toEqual({
      paused: { seconds: 60 }
    })
    // With no wait left, the email is coded.
    expect(await check({ ...ports(), fits }, { waits: 6 })).toEqual({
      pass: false,
      reason: 'no_time'
    })
  })

  it('takes no view larger than the AI call can, and judges without dark when it did not come in time', async () => {
    const big = (v: { view: string }) =>
      Promise.resolve({
        ...picture(v.view === 'phone' ? 375 : 600),
        bytes: new Uint8Array(maxEmailPictureBytes + 1)
      })
    expect(
      await check(
        ports({
          picture: async (v) =>
            v.view === 'desktop'
              ? big(v)
              : picture(v.view === 'phone' ? 375 : 600)
        })
      )
    ).toEqual({ pass: false, reason: 'view_unusable' })
    const bigDark = ports({
      picture: async (v) =>
        v.view === 'dark' ? big(v) : picture(v.view === 'phone' ? 375 : 600)
    })
    expect(await check(bigDark)).toMatchObject({ pass: true })
    expect(bigDark.judge.mock.calls[0]![0]).not.toHaveProperty('dark')
    // Dark never asked for (a claim lost between asks): once the window is
    // over, the email is judged without it, never asked again.
    const noDark = ports({ views: [drawn('desktop', 1), drawn('phone', 2)] })
    expect(await check(noDark, { until: now })).toMatchObject({ pass: true })
    expect(noDark.ask).not.toHaveBeenCalled()
    // Within the window it is asked for again.
    const askDark = ports({ views: [drawn('desktop', 1), drawn('phone', 2)] })
    expect(await check(askDark)).toMatchObject({ wait: {} })
    expect(askDark.ask).toHaveBeenCalledTimes(1)
  })
})
