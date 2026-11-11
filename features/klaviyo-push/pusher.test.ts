// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { klaviyoClient } from '@/lib/providers/klaviyo/client'
import { recorded } from '@/lib/providers/klaviyo/recorded'
import {
  fakeDraftAccount,
  type DraftFaults,
  type FakeDraftAccount
} from '@/lib/providers/klaviyo/recorded-drafts'
import { fakeDraftPusher, type DraftInput } from '@/lib/providers/klaviyo-draft'
import {
  liveDraftPusher,
  pushMark,
  type PushProgress,
  type PushStep,
  type PushStore
} from './pusher'

const tenantId = '00000000-0000-4000-8000-000000000101'
const key = '6f1c2d3e-4b5a-4c6d-8e7f-0123456789ab'
const footer =
  '<p>{{ organization.name }}<br>{{ organization.full_address }}<br>{% unsubscribe "Unsubscribe" %} · {% manage_preferences "Preferences" %}<br>{% web_view "View in browser" %}</p>'
const page = (title: string, pictures: string[]) =>
  `<html><body><h1>${title}</h1>${pictures
    .map((src) => `<img src="${src}" alt="">`)
    .join(
      ''
    )}<a href="https://cedar.example/p/1">Shop</a>${footer}</body></html>`
const hero = 'https://cedar.example/images/hero.jpg?w=600&amp;h=400'
const knit = 'https://cedar.example/images/knit.jpg'
const input = (over: Partial<DraftInput> = {}): DraftInput => ({
  tenantId,
  idempotencyKey: key,
  name: 'Tue 17 Nov · Mother & Daughter + #2',
  subject: '20% off knitwear',
  preheader: 'This weekend only.',
  html: page('A', [hero, knit, knit]),
  plannedSendAt: '2026-11-17T18:00:00Z',
  audienceId: 'SegEng90',
  sample: false,
  lease: { build: '00000000-0000-4000-8000-00000000b101', token: 'lease-1' },
  contentChecked: true,
  ...over
})
const ab = (over: Partial<DraftInput> = {}) =>
  input({
    variations: [
      { approach: 'A', html: page('A', [hero, knit]) },
      { approach: 'B', html: page('B', [knit]) }
    ],
    ...over
  })

/** Push steps in memory, saved as `save_klaviyo_push` does. */
function memoryStore() {
  const rows = new Map<string, PushProgress>()
  const saves: PushStep[] = []
  const blank: PushProgress = {
    state: 'started',
    images: {},
    templates: [],
    campaignId: null,
    messageId: null,
    createStartedAt: null,
    messageStartedAt: null,
    templateStartedAt: null,
    deleteAnsweredAt: null,
    audienceId: null,
    designs: null,
    fallback: null,
    ab: null,
    reason: null,
    written: null,
    target: null
  }
  const store: PushStore = {
    async load({ tenantId: t, key: k }) {
      const row = rows.get(`${t}/${k}`)
      return row ? structuredClone(row) : null
    },
    async save({ tenantId: t, key: k }, step) {
      saves.push(step)
      const row = rows.get(`${t}/${k}`) ?? blank
      const { images, ...rest } = step
      delete rest.checks
      rows.set(`${t}/${k}`, {
        ...row,
        ...rest,
        images: { ...row.images, ...(images ?? {}) }
      })
    }
  }
  return { store, rows, saves, row: () => rows.get(`${tenantId}/${key}`) }
}

type Clock = { now: number; perCall: number }
function setup(
  faults: DraftFaults = {},
  options: { live?: boolean; clock?: Clock; budgetMs?: number } = {}
) {
  const clock = options.clock
  const account = fakeDraftAccount({
    faults,
    now: clock ? () => new Date(clock.now) : undefined
  })
  const memory = memoryStore()
  const pusher = liveDraftPusher({
    source: {
      async client() {
        return options.live === false
          ? null
          : klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
              transport: async (request) => {
                if (clock) clock.now += clock.perCall
                return account.transport(request)
              },
              maxWaits: 0
            })
      },
      async timezone() {
        return 'America/Los_Angeles'
      }
    },
    store: memory.store,
    ...(clock
      ? {
          now: () => new Date(clock.now),
          budgetMs: options.budgetMs,
          callMs: 6_000
        }
      : {})
  })
  return { account, memory, pusher }
}
const writes = (account: FakeDraftAccount) =>
  account.calls.filter((c) => !c.startsWith('GET'))
const only = <T>(m: Map<string, T>) => {
  expect(m.size).toBe(1)
  return [...m.entries()][0]!
}
const variationsOf = (account: FakeDraftAccount) => {
  const [, message] = only(account.messages)
  return message.variationIds.map((v) => account.variations.get(v)!)
}
/** Our own templates (Klaviyo's copies on the variations are not ours). */
const ourTemplates = (account: FakeDraftAccount) =>
  [...account.templates.keys()].filter((id) => /^Tpl\d+$/.test(id))
/** Every variation shows the design titled `title`. */
const shows = (account: FakeDraftAccount, title: string) =>
  variationsOf(account).every((v) =>
    account.templates.get(v.templateId!)!.html.includes(`<h1>${title}</h1>`)
  )
/** Another run on the same account and store, with its own clock and time. */
const runOn = (
  account: FakeDraftAccount,
  store: PushStore,
  clock: Clock,
  budgetMs: number
) =>
  liveDraftPusher({
    source: {
      async client() {
        return klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
          transport: async (request) => {
            clock.now += clock.perCall
            return account.transport(request)
          },
          maxWaits: 0
        })
      },
      async timezone() {
        return 'America/Los_Angeles'
      }
    },
    store,
    now: () => new Date(clock.now),
    budgetMs,
    callMs: 6_000
  })
/** Pushes until the push answers ok (each run a new call, as the build does). */
async function untilDone(
  pusher: ReturnType<typeof setup>['pusher'],
  draft: DraftInput,
  runs = 20,
  /** Between runs (the build waits, e.g. for Klaviyo to show what it made). */
  between: () => void = () => {}
) {
  let result = await pusher.createDraft(draft)
  for (let n = 0; !result.ok && n < runs; n++) {
    between()
    result = await pusher.createDraft(draft)
  }
  return result
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the live Klaviyo draft push', () => {
  it('checks the audience, moves the pictures, makes a template, the campaign, then its message, in that order', async () => {
    const { account, memory, pusher } = setup()
    const result = await pusher.createDraft(input())
    const [campaignId, campaign] = only(account.campaigns)
    expect(result).toEqual({ ok: true, campaignId, sample: false })
    expect(campaign).toMatchObject({
      name: 'Tue 17 Nov · Mother & Daughter + #2',
      description: pushMark(key),
      included: ['SegEng90'],
      messageIds: [expect.any(String)]
    })
    expect(writes(account)).toEqual([
      'POST /api/images',
      'POST /api/images',
      'POST /api/templates',
      'POST /api/campaigns',
      'POST /api/campaign-messages',
      expect.stringMatching(/^DELETE \/api\/templates\/Tpl/)
    ])
    expect(account.calls[0]).toBe('GET /api/segments/SegEng90')
    const [variation] = variationsOf(account)
    expect(variation).toMatchObject({
      name: 'Design A',
      subject: '20% off knitwear',
      preview: 'This weekend only.'
    })
    // The variation's template is Klaviyo's copy: it shows the Klaviyo
    // pictures and the footer tags; ours is deleted.
    const html = account.templates.get(variation!.templateId!)!.html
    for (const image of account.images.values())
      expect(html).toContain(image.url)
    expect(html).not.toContain('cedar.example/images')
    expect(account.templates.size).toBe(1)
    expect(memory.row()).toMatchObject({
      state: 'drafted',
      campaignId,
      audienceId: 'SegEng90',
      designs: 'A',
      ab: null,
      target: null,
      written: expect.stringMatching(/^[a-f0-9]{16}$/)
    })
    expect(memory.saves.find((s) => s.checks)?.checks).toEqual([
      { id: 'images', pass: true, problems: [] },
      { id: 'footer', pass: true, problems: [] },
      { id: 'size', pass: true, problems: [] }
    ])
  })

  it('puts an A/B design test into one draft: both designs and an even split with no winner, in one request, verified', async () => {
    const { account, memory, pusher } = setup()
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'both'
    })
    const [, message] = only(account.messages)
    expect(message.winnerPercentage).toBe(0)
    const [a, b] = variationsOf(account)
    expect([a!.name, b!.name]).toEqual(['Design A', 'Design B'])
    expect(b!.subject).toBe(a!.subject)
    expect(account.templates.get(a!.templateId!)!.html).toContain('<h1>A</h1>')
    expect(account.templates.get(b!.templateId!)!.html).toContain('<h1>B</h1>')
    expect(memory.row()).toMatchObject({ designs: 'both', ab: 'verified' })
  })

  for (const [fault, fallback] of [
    ['refused', 'ab_test_refused'],
    ['ignored', 'ab_test_not_kept']
  ] as const)
    it(`takes design B out at once when Klaviyo ${fault === 'refused' ? 'refuses' : 'does not keep'} the even test`, async () => {
      const { account, memory, pusher } = setup({ abTest: fault })
      expect(await pusher.createDraft(ab())).toMatchObject({
        ok: true,
        designs: 'A'
      })
      const [, message] = only(account.messages)
      // One variation, design A: Klaviyo's own A/B settings cannot send a winner.
      expect(variationsOf(account).map((v) => v.name)).toEqual(['Design A'])
      expect(message.winnerPercentage).toBeNull()
      expect(memory.row()).toMatchObject({ designs: 'A', fallback, ab: null })
      // The same key again stays design A, without trying the test again.
      expect(
        await pusher.createDraft(ab({ subject: 'Knitwear, 20% off' }))
      ).toMatchObject({ ok: true, designs: 'A' })
      expect(variationsOf(account).map((v) => v.subject)).toEqual([
        'Knitwear, 20% off'
      ])
    })

  it('refuses, and says so loudly, when Klaviyo keeps its own test and design B cannot be taken out', async () => {
    const { account, pusher } = setup({
      abTest: 'ignored',
      deleteVariation: 'refused'
    })
    expect(await pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['ab_test']
    })
    expect(console.error).toHaveBeenCalled()
    expect(variationsOf(account)).toHaveLength(2)
  })

  for (const [faults, designs] of [
    [{}, 'both'],
    [{ abTest: 'ignored' }, 'A']
  ] as const)
    it(`never leaves two designs with Klaviyo’s own test, whatever the time, and goes on next run (${designs})`, async () => {
      // 3 s an answer, 6 s a request, 30 s a push.
      const clock = { now: Date.parse('2026-11-11T12:00:00Z'), perCall: 3_000 }
      const { account, memory, pusher } = setup(faults, { clock })
      let result = await pusher.createDraft(ab())
      for (let n = 0; !result.ok && n < 20; n++) {
        expect(result).toMatchObject({ ok: false })
        // Never a two-variation draft left with Klaviyo's own settings.
        for (const m of account.messages.values())
          expect(m.variationIds.length === 2 && m.winnerPercentage !== 0).toBe(
            false
          )
        result = await pusher.createDraft(ab())
      }
      expect(result).toMatchObject({ ok: true, designs })
      expect(account.campaigns.size).toBe(1)
      expect(memory.row()?.ab).toBe(designs === 'both' ? 'verified' : null)
    })

  it('gives the same draft for the same key, updated to new content, with no new template for the same design', async () => {
    const { account, pusher } = setup()
    const first = await pusher.createDraft(input())
    const templatesMade = () =>
      account.calls.filter((c) => c === 'POST /api/templates').length
    expect(await pusher.createDraft(input())).toEqual(first)
    expect(templatesMade()).toBe(1)
    expect(
      await pusher.createDraft(
        input({ subject: 'Knitwear, 20% off', html: page('A2', [hero, knit]) })
      )
    ).toEqual(first)
    expect(account.campaigns.size).toBe(1)
    expect(account.images.size).toBe(2)
    expect(templatesMade()).toBe(2)
    const [variation] = variationsOf(account)
    expect(variation!.subject).toBe('Knitwear, 20% off')
    expect(account.templates.get(variation!.templateId!)!.html).toContain(
      '<h1>A2</h1>'
    )
  })

  it('finds the campaign whose answer was lost, by its time, name and mark, whatever its name holds', async () => {
    const { account, memory, pusher } = setup({ loseCreate: true })
    expect(await pusher.createDraft(input())).toEqual({
      ok: false,
      code: 'unavailable'
    })
    expect(memory.row()?.createStartedAt).toEqual(expect.any(String))
    expect(await pusher.createDraft(input())).toMatchObject({ ok: true })
    expect(account.campaigns.size).toBe(1)
  })

  it('finds the template whose answer was lost by its exact name', async () => {
    const { account, pusher } = setup({ loseTemplate: true })
    expect((await pusher.createDraft(input())).ok).toBe(false)
    expect(await pusher.createDraft(input())).toMatchObject({ ok: true })
    expect(
      account.calls.filter((c) => c === 'POST /api/templates')
    ).toHaveLength(1)
  })

  it('picks up where it stopped after Klaviyo slowed it down or was unwell, without duplicates', async () => {
    for (const faults of [
      { rateLimit: '/api/images' },
      { outage: '/api/templates' },
      { outage: '/api/campaign-messages' }
    ] satisfies DraftFaults[]) {
      const clock = { now: Date.parse('2026-11-11T12:00:00Z'), perCall: 100 }
      const { account, pusher } = setup(faults, { clock })
      const first = await pusher.createDraft(ab())
      expect(first.ok, JSON.stringify(faults)).toBe(false)
      if (faults.rateLimit)
        expect(first).toEqual({
          ok: false,
          code: 'rate_limited',
          retryAfterSeconds: 30
        })
      // A create answered 503 is never sent again before it could show.
      expect(
        await untilDone(pusher, ab(), 20, () => (clock.now += 180_000))
      ).toMatchObject({ ok: true, designs: 'both' })
      expect(account.campaigns.size).toBe(1)
      expect(account.messages.size).toBe(1)
      expect(account.images.size).toBe(2)
      expect(variationsOf(account)).toHaveLength(2)
    }
  })

  it('goes on with a slow Klaviyo inside the cron’s 25 s', async () => {
    const clock = { now: Date.parse('2026-11-11T12:00:00Z'), perCall: 2_500 }
    const { account, pusher } = setup({}, { clock, budgetMs: 25_000 })
    expect(await untilDone(pusher, ab(), 40)).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(account.campaigns.size).toBe(1)
  })

  it('takes over the message Klaviyo makes itself (one design), and keeps our designs when Klaviyo renames them', async () => {
    const auto = setup({ autoMessage: true })
    expect(await auto.pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'A'
    })
    expect(variationsOf(auto.account).map((v) => v.name)).toEqual(['Design A'])
    expect(auto.account.messages.size).toBe(1)
    const renamed = setup({ renameVariations: true })
    expect(await renamed.pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(
      await renamed.pusher.createDraft(ab({ subject: 'S2' }))
    ).toMatchObject({ ok: true, designs: 'both' })
    expect(variationsOf(renamed.account).map((v) => v.subject)).toEqual([
      'S2',
      'S2'
    ])
  })

  it('waits for Klaviyo to show a message it just made, and never reads a partial answer as "none"', async () => {
    const lag = setup({ lagRead: true })
    expect(await lag.pusher.createDraft(input())).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 30
    })
    expect(await lag.pusher.createDraft(input())).toMatchObject({ ok: true })
    expect(lag.account.messages.size).toBe(1)

    // An A/B draft not yet seen safe never fails its build: it waits, and
    // says so loudly.
    const partial = setup({ dropRelationships: true })
    expect(await partial.pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 30
    })
    expect(console.error).toHaveBeenCalled()
    expect(partial.memory.row()?.ab).toBe('pending')
    // Made in one request with its test, and never a second message.
    expect(partial.account.messages.size).toBe(1)
    expect((await partial.pusher.createDraft(ab())).ok).toBe(false)
    expect(partial.account.messages.size).toBe(1)
    // One design: an unreadable answer is Klaviyo being unwell.
    const one = setup({ dropRelationships: true })
    expect(await one.pusher.createDraft(input())).toEqual({
      ok: false,
      code: 'unavailable'
    })
  })

  it('never touches a draft the owner scheduled, deleted or changed in Klaviyo', async () => {
    const scheduled = setup()
    await scheduled.pusher.createDraft(input())
    only(scheduled.account.messages)[1].status = 'scheduled'
    const before = writes(scheduled.account).length
    expect(await scheduled.pusher.createDraft(input())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['not_draft']
    })
    expect(writes(scheduled.account)).toHaveLength(before)

    const deleted = setup()
    await deleted.pusher.createDraft(input())
    deleted.account.messages.clear()
    for (let i = 0; i < 2; i++)
      expect(await deleted.pusher.createDraft(input())).toEqual({
        ok: false,
        code: 'rejected',
        checks: ['externally_modified']
      })
    expect(deleted.account.campaigns.size).toBe(1)

    const edited = setup()
    await edited.pusher.createDraft(input())
    const [variation] = variationsOf(edited.account)
    variation!.subject = 'The owner wrote this'
    expect(await edited.pusher.createDraft(input())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['externally_modified']
    })
    expect(variation!.subject).toBe('The owner wrote this')
  })

  it('does not take its own update stopped half way for a change in Klaviyo', async () => {
    const { account, pusher } = setup()
    await pusher.createDraft(ab())
    // The new content: design A is changed, then Klaviyo is unwell.
    account.faults.outage = '/api/campaign-variations/'
    const update = ab({ subject: 'New subject' })
    expect(await untilDone(pusher, update)).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(variationsOf(account).map((v) => v.subject)).toEqual([
      'New subject',
      'New subject'
    ])
  })

  it('refuses, without calling Klaviyo, what must never reach it', async () => {
    for (const [over, checks] of [
      [{ sample: true }, ['sample']],
      [{ lease: undefined }, ['lease']],
      [{ audienceId: 'sample-engaged' }, ['audience']],
      [{ audienceId: 'sample engaged' }, ['audience']],
      [
        {
          html: '<html><p>{% unsubscribe %} {{ organization.full_address }}</p></html>'
        },
        ['footer']
      ],
      [
        {
          variations: [
            { approach: 'B', html: page('B', []) },
            { approach: 'A', html: page('A', []) }
          ]
        },
        ['variations']
      ],
      [
        { variations: [{ approach: 'A', html: page('A', []) }] },
        ['variations']
      ],
      [
        {
          html: page(
            'A',
            Array.from(
              { length: 41 },
              (_, i) => `https://cedar.example/${i}.jpg`
            )
          )
        },
        ['images']
      ],
      [{ html: page('A', ['http://cedar.example/a.jpg']) }, ['images']],
      [{ html: page('A', ['data:image/png;base64,AAAA']) }, ['images']],
      [{ html: page('A', ['https://cedar.example/a.webp']) }, ['images']],
      [{ html: `<img src=https://cedar.example/a.jpg>${footer}` }, ['images']],
      [{ html: page('A' + 'x'.repeat(110 * 1024), []) }, ['size']]
    ] as [Partial<DraftInput>, string[]][]) {
      const { account, pusher } = setup()
      expect(
        await pusher.createDraft(input(over)),
        JSON.stringify(checks)
      ).toEqual({ ok: false, code: 'rejected', checks })
      expect(account.calls).toEqual([])
    }
  })

  it('refuses an audience the account does not have, or a changed one, before any write', async () => {
    const missing = setup()
    expect(
      await missing.pusher.createDraft(input({ audienceId: 'SegGone' }))
    ).toEqual({ ok: false, code: 'rejected', checks: ['audience'] })
    expect(writes(missing.account)).toEqual([])
    const changed = setup()
    await changed.pusher.createDraft(input())
    expect(
      await changed.pusher.createDraft(input({ audienceId: 'SegVIP' }))
    ).toEqual({ ok: false, code: 'rejected', checks: ['audience'] })
  })

  it('refuses a picture Klaviyo will not import', async () => {
    const { account, pusher } = setup({ badImage: knit })
    expect(await pusher.createDraft(input())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['images']
    })
    expect(account.campaigns.size).toBe(0)
  })

  it('needs the workspace’s live Klaviyo and a key that may write drafts', async () => {
    expect(
      await setup({}, { live: false }).pusher.createDraft(input())
    ).toEqual({ ok: false, code: 'auth' })
    for (const response of [recorded.badKey, recorded.noScope]) {
      const account = fakeDraftAccount()
      const pusher = liveDraftPusher({
        source: {
          client: async () =>
            klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
              transport: async (request) =>
                request.method === 'GET'
                  ? account.transport(request)
                  : response,
              maxWaits: 0
            }),
          timezone: async () => 'UTC'
        },
        store: memoryStore().store
      })
      expect(await pusher.createDraft(input())).toEqual({
        ok: false,
        code: 'auth'
      })
    }
  })

  it('keeps our template while a variation still points at it', async () => {
    const { account, pusher } = setup({ copiesTemplates: false })
    await pusher.createDraft(input())
    const [variation] = variationsOf(account)
    expect(account.templates.has(variation!.templateId!)).toBe(true)
  })
})

describe('pushing the same email again (what the reviews found)', () => {
  it('changes only the subject without a new template, and never sends a deleted one', async () => {
    const { account, pusher } = setup()
    await pusher.createDraft(input())
    const made = () =>
      account.calls.filter((c) => c === 'POST /api/templates').length
    expect(made()).toBe(1)
    // The fake refuses a template id it does not have.
    expect(
      await pusher.createDraft(input({ subject: 'New subject' }))
    ).toMatchObject({
      ok: true
    })
    expect(made()).toBe(1)
    expect(variationsOf(account)[0]!.subject).toBe('New subject')
    // And again: the draft is ours as we left it.
    expect(
      await pusher.createDraft(input({ subject: 'New subject' }))
    ).toMatchObject({
      ok: true
    })
  })

  it('shows the design last pushed: A, then B, then A again', async () => {
    const { account, pusher } = setup()
    for (const title of ['H1', 'H2', 'H1']) {
      expect(
        await pusher.createDraft(input({ html: page(title, [hero]) }))
      ).toMatchObject({
        ok: true
      })
      const [v] = variationsOf(account)
      expect(account.templates.get(v!.templateId!)!.html).toContain(
        `<h1>${title}</h1>`
      )
    }
  })

  it('checks an A/B draft whose first read back failed before anything else', async () => {
    const { account, memory, pusher } = setup({ lagRead: true })
    expect((await pusher.createDraft(ab())).ok).toBe(false)
    expect(memory.row()?.ab).toBe('pending')
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(only(account.messages)[1].winnerPercentage).toBe(0)
    expect(memory.row()?.ab).toBe('verified')
  })

  it('never deletes a template a variation still points at, after a new design', async () => {
    const { account, pusher } = setup({ copiesTemplates: false })
    await pusher.createDraft(input())
    await pusher.createDraft(input({ html: page('A2', [hero]) }))
    const [v] = variationsOf(account)
    expect(account.templates.get(v!.templateId!)!.html).toContain('<h1>A2</h1>')
  })

  it('keeps a finished draft finished when cleaning up a template fails', async () => {
    const { account, pusher } = setup({ outage: '/api/templates/' })
    expect(await pusher.createDraft(input())).toMatchObject({ ok: true })
    expect(account.campaigns.size).toBe(1)
  })
})

describe('an A/B draft when Klaviyo answers oddly (the third review)', () => {
  it('knows design A by the ids Klaviyo answered, when it renames the designs and the first read back fails', async () => {
    const { account, memory, pusher } = setup({
      renameVariations: true,
      lagRead: true,
      abTest: 'ignored',
      reverseReads: true
    })
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: false,
      code: 'rate_limited'
    })
    expect(memory.row()?.ab).toBe('pending')
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'A'
    })
    expect(variationsOf(account)).toHaveLength(1)
    expect(shows(account, 'A')).toBe(true)
    expect(only(account.messages)[1].winnerPercentage).toBeNull()
    // Design A's own variation was kept: nothing had to be written again.
    expect(
      account.calls.filter((c) =>
        c.startsWith('PATCH /api/campaign-variations')
      )
    ).toEqual([])
  })

  it('keeps both designs when Klaviyo renames them and the first read back fails, and updates them later', async () => {
    const { account, pusher } = setup({ renameVariations: true, lagRead: true })
    expect((await pusher.createDraft(ab())).ok).toBe(false)
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(
      await pusher.createDraft(ab({ subject: 'Knitwear, 20% off' }))
    ).toMatchObject({ ok: true, designs: 'both' })
    const [a, b] = variationsOf(account)
    expect([a!.subject, b!.subject]).toEqual([
      'Knitwear, 20% off',
      'Knitwear, 20% off'
    ])
    expect(account.templates.get(a!.templateId!)!.html).toContain('<h1>A</h1>')
    expect(account.templates.get(b!.templateId!)!.html).toContain('<h1>B</h1>')
  })

  it('takes over an A/B message whose answer was lost, and checks it first', async () => {
    const kept = setup({ loseMessage: true })
    expect(await kept.pusher.createDraft(ab())).toMatchObject({
      ok: false,
      code: 'rate_limited'
    })
    expect(await kept.pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(kept.account.messages.size).toBe(1)
    expect(only(kept.account.messages)[1].winnerPercentage).toBe(0)

    const lost = setup({
      loseMessage: true,
      renameVariations: true,
      abTest: 'ignored'
    })
    expect((await lost.pusher.createDraft(ab())).ok).toBe(false)
    expect(await lost.pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'A'
    })
    expect(variationsOf(lost.account)).toHaveLength(1)
    expect(shows(lost.account, 'A')).toBe(true)
  })

  it('makes an unfinished A/B draft safe before it refuses changed input', async () => {
    const { account, memory, pusher } = setup({
      lagRead: true,
      abTest: 'ignored'
    })
    expect((await pusher.createDraft(ab())).ok).toBe(false)
    expect(await pusher.createDraft(ab({ contentChecked: false }))).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['release_qa']
    })
    expect(variationsOf(account)).toHaveLength(1)
    expect(shows(account, 'A')).toBe(true)
    expect(memory.row()).toMatchObject({ designs: 'A', ab: null })
  })

  it('waits for Klaviyo to show design B gone, then goes on with design A', async () => {
    const { account, memory, pusher } = setup({
      abTest: 'ignored',
      lagDelete: true
    })
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: false,
      code: 'rate_limited'
    })
    expect(memory.row()?.ab).toBe('pending')
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'A'
    })
    expect(variationsOf(account)).toHaveLength(1)
    expect(memory.row()).toMatchObject({
      designs: 'A',
      fallback: 'ab_test_not_kept'
    })
  })

  it('checks the even test again after changing a two-design draft', async () => {
    const { account, pusher } = setup({ resetTestOnUpdate: true })
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'both'
    })
    // Klaviyo sets its own test again when the variations change.
    expect(
      await pusher.createDraft(ab({ subject: 'Knitwear, 20% off' }))
    ).toMatchObject({ ok: true, designs: 'A' })
    const [, message] = only(account.messages)
    expect(message.variationIds).toHaveLength(1)
    expect(message.winnerPercentage).toBeNull()
  })

  it('removes the template of design B when only design A went in', async () => {
    const { account, pusher } = setup({ abTest: 'refused' })
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'A'
    })
    expect(ourTemplates(account)).toEqual([])
  })

  it('never sends a template whose delete answer was lost', async () => {
    const { account, pusher } = setup({ loseDelete: true })
    for (const title of ['H1', 'H2', 'H1']) {
      expect(
        await pusher.createDraft(input({ html: page(title, [hero]) }))
      ).toMatchObject({ ok: true })
      expect(shows(account, title)).toBe(true)
    }
  })

  it('takes a subject Klaviyo trimmed as the one it was given', async () => {
    const { account, pusher } = setup({ trimsText: true })
    const draft = input({ subject: '  20% off   knitwear ' })
    expect(await pusher.createDraft(draft)).toMatchObject({ ok: true })
    const before = writes(account).length
    expect(await pusher.createDraft(draft)).toMatchObject({ ok: true })
    expect(writes(account).length).toBe(before)
  })

  it('says so loudly when it leaves a changed draft with two designs and a winner', async () => {
    const { account, pusher } = setup()
    await pusher.createDraft(ab())
    const [, message] = only(account.messages)
    message.winnerPercentage = 20
    account.variations.get(message.variationIds[1]!)!.subject = 'Edited'
    expect(await pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['externally_modified']
    })
    expect(console.error).toHaveBeenCalled()
  })
})

describe('an A/B draft left half made (the fourth review)', () => {
  const lostAb = () => setup({ loseMessage: true, abTest: 'ignored' })

  it('checks an A/B message whose create answer was lost before the input checks', async () => {
    const { account, memory, pusher } = lostAb()
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: false,
      code: 'rate_limited'
    })
    expect(memory.row()).toMatchObject({ ab: 'pending', messageId: null })
    expect(await pusher.createDraft(ab({ contentChecked: false }))).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['release_qa']
    })
    expect(variationsOf(account)).toHaveLength(1)
    expect(only(account.messages)[1].winnerPercentage).toBeNull()
  })

  it('waits, never fails, when Klaviyo is unwell while it looks for that message', async () => {
    const { account, pusher } = lostAb()
    await pusher.createDraft(ab())
    account.faults.outage = '/api/campaigns/'
    expect(await pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 30
    })
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'A'
    })
    expect(variationsOf(account)).toHaveLength(1)
  })

  it('checks that message whatever the time left', async () => {
    const { account, memory, pusher } = lostAb()
    await pusher.createDraft(ab())
    const late = runOn(
      account,
      memory.store,
      { now: Date.now(), perCall: 3_000 },
      1_000
    )
    expect((await late.createDraft(ab())).ok).toBe(false)
    expect(variationsOf(account)).toHaveLength(1)
    expect(only(account.messages)[1].winnerPercentage).toBeNull()
  })

  it('takes design B out of a draft not yet seen safe that the owner changed, then leaves it', async () => {
    const { account, pusher } = setup({ lagRead: true })
    expect((await pusher.createDraft(ab())).ok).toBe(false)
    variationsOf(account)[0]!.subject = 'The owner wrote this'
    only(account.messages)[1].winnerPercentage = 20
    expect(await pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['externally_modified']
    })
    expect(variationsOf(account).map((v) => v.subject)).toEqual([
      'The owner wrote this'
    ])
    expect(only(account.messages)[1].winnerPercentage).toBeNull()
  })

  it('sets the even test meanwhile when Klaviyo answers a delete it does not do, and says so', async () => {
    const { account, memory, pusher } = setup({
      lagRead: true,
      deleteIgnored: true
    })
    expect((await pusher.createDraft(ab())).ok).toBe(false)
    // Klaviyo did not keep the even test.
    only(account.messages)[1].winnerPercentage = 20
    for (let n = 0; n < 3; n++)
      expect(await pusher.createDraft(ab())).toEqual({
        ok: false,
        code: 'rate_limited',
        retryAfterSeconds: 30
      })
    const [, message] = only(account.messages)
    expect(message.variationIds).toHaveLength(2)
    expect(message.winnerPercentage).toBe(0)
    expect(console.error).toHaveBeenCalled()
    expect(memory.row()).toMatchObject({
      designs: 'A',
      fallback: 'ab_test_not_kept',
      ab: 'pending'
    })
  })

  it('makes a two-design draft safe when a change to it is refused half way', async () => {
    const { account, memory, pusher } = setup({
      resetTestOnUpdate: true,
      refuseUpdate: 2
    })
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(
      await pusher.createDraft(ab({ subject: 'Knitwear, 20% off' }))
    ).toEqual({ ok: false, code: 'rejected' })
    const [, message] = only(account.messages)
    expect(message.variationIds).toHaveLength(1)
    expect(message.winnerPercentage).toBeNull()
    expect(memory.row()?.ab).toBeNull()
  })

  it('keeps Klaviyo’s own wait while an A/B draft is not yet seen safe', async () => {
    const { account, pusher } = setup({ lagRead: true, retryAfter: 120 })
    expect((await pusher.createDraft(ab())).ok).toBe(false)
    account.faults.rateLimit = '/api/campaign-messages/'
    expect(await pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 120
    })
  })

  it('tells the designs apart by what they show when Klaviyo answers no ids, renames them and lists them in another order', async () => {
    const faults = {
      dropCreateIds: true,
      renameVariations: true,
      reverseReads: true,
      lagRead: true
    }
    const known = setup(faults)
    expect((await known.pusher.createDraft(ab())).ok).toBe(false)
    only(known.account.messages)[1].winnerPercentage = 20
    expect(await known.pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'A'
    })
    expect(variationsOf(known.account)).toHaveLength(1)
    expect(shows(known.account, 'A')).toBe(true)

    // Klaviyo's copies are not our HTML: no design can be told apart, so
    // no winner at least, and refused loudly.
    const unknown = setup({ ...faults, changesCopies: true })
    expect((await unknown.pusher.createDraft(ab())).ok).toBe(false)
    only(unknown.account.messages)[1].winnerPercentage = 20
    expect(await unknown.pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['ab_test']
    })
    expect(console.error).toHaveBeenCalled()
    expect(only(unknown.account.messages)[1].winnerPercentage).toBe(0)
  })

  it('leaves an A/B draft that has a third variation, deleting nothing', async () => {
    const { account, pusher } = setup()
    await pusher.createDraft(ab())
    const [mid, message] = only(account.messages)
    const [, b] = variationsOf(account)
    account.variations.set('VarExtra', { ...b!, messageId: mid })
    message.variationIds.push('VarExtra')
    expect(await pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['externally_modified']
    })
    expect(
      account.calls.filter((c) =>
        c.startsWith('DELETE /api/campaign-variations')
      )
    ).toEqual([])
    expect(variationsOf(account)).toHaveLength(3)
  })

  it('goes from two designs to one and back without closing the draft', async () => {
    const { account, memory, pusher } = setup({ lagDelete: true })
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(await untilDone(pusher, input())).toMatchObject({ ok: true })
    expect(variationsOf(account)).toHaveLength(1)
    expect(memory.row()?.ab).toBeNull()
    expect(await pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'A'
    })
  })
})

describe('an A/B draft when Klaviyo stays odd (the fifth review)', () => {
  const unnamed = {
    dropCreateIds: true,
    renameVariations: true,
    lagRead: true
  }

  for (const winner of [0, 20])
    it(`takes Klaviyo being unwell while it tells the designs apart as a reason to try again (winner ${winner})`, async () => {
      const { account, memory, pusher } = setup(unnamed)
      expect((await pusher.createDraft(ab())).ok).toBe(false)
      only(account.messages)[1].winnerPercentage = winner
      account.faults.outage = '/api/templates/'
      expect(await pusher.createDraft(ab())).toMatchObject({
        ok: false,
        code: winner ? 'rate_limited' : 'unavailable'
      })
      expect(memory.row()?.reason).not.toBe('externally_modified')
      expect(await pusher.createDraft(ab())).toMatchObject({
        ok: true,
        designs: winner ? 'A' : 'both'
      })
      expect(variationsOf(account)).toHaveLength(winner ? 1 : 2)
      if (winner) expect(shows(account, 'A')).toBe(true)
    })

  it('refuses, without closing the draft, two designs it cannot tell apart', async () => {
    const { account, memory, pusher } = setup({
      ...unnamed,
      changesCopies: true
    })
    expect((await pusher.createDraft(ab())).ok).toBe(false)
    for (let n = 0; n < 2; n++)
      expect(await pusher.createDraft(ab())).toEqual({
        ok: false,
        code: 'rejected',
        checks: ['ab_test']
      })
    expect(memory.row()?.reason).toBe('designs_unknown')
    expect(only(account.messages)[1].winnerPercentage).toBe(0)
  })

  it('gives up on a delete Klaviyo answers and never does, after 10 minutes, loudly', async () => {
    const clock = { now: Date.parse('2026-11-11T12:00:00Z'), perCall: 100 }
    const { account, memory, pusher } = setup(
      { lagRead: true, deleteIgnored: true },
      { clock }
    )
    expect((await pusher.createDraft(ab())).ok).toBe(false)
    only(account.messages)[1].winnerPercentage = 20
    let result = await pusher.createDraft(ab())
    let runs = 1
    for (; runs < 20 && !result.ok && result.code === 'rate_limited'; runs++) {
      clock.now += 2 * 60_000
      result = await pusher.createDraft(ab())
    }
    expect(result).toEqual({ ok: false, code: 'rejected', checks: ['ab_test'] })
    expect(runs).toBeLessThanOrEqual(7)
    expect(memory.row()).toMatchObject({ reason: 'ab_test_unsafe' })
    expect(only(account.messages)[1].winnerPercentage).toBe(0)
    expect(console.error).toHaveBeenCalled()
    // A rebuild of the same email stops at once, never waiting again.
    clock.now += 60_000
    expect(await pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['ab_test']
    })
  })
})

describe('the fake pusher', () => {
  it('refuses variations the live one refuses, and can answer design A only', async () => {
    expect(
      await fakeDraftPusher().createDraft(
        input({
          variations: [
            { approach: 'B', html: '' },
            { approach: 'A', html: '' }
          ]
        })
      )
    ).toEqual({ ok: false, code: 'rejected', checks: ['variations'] })
    expect(
      await fakeDraftPusher({ designs: 'A' }).createDraft(ab())
    ).toMatchObject({ ok: true, designs: 'A' })
    expect(await fakeDraftPusher().createDraft(input())).not.toHaveProperty(
      'designs'
    )
  })
})
