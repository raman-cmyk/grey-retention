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
    templateStartedAt: null,
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
          callMs: 8_000
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
/** Pushes until the push answers ok (each run a new call, as the build does). */
async function untilDone(
  pusher: ReturnType<typeof setup>['pusher'],
  draft: DraftInput,
  runs = 20
) {
  let result = await pusher.createDraft(draft)
  for (let n = 0; !result.ok && n < runs; n++)
    result = await pusher.createDraft(draft)
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
      written: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    expect(memory.saves.find((s) => s.checks)?.checks).toEqual([
      { id: 'images', pass: true, problems: [] },
      { id: 'footer', pass: true, problems: [] },
      { id: 'size', pass: true, problems: [] }
    ])
  })

  it('puts an A/B design test into one draft: design B added, then an even split with no winner, verified', async () => {
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

  it('refuses, and says so loudly, when design B cannot be taken out', async () => {
    const { account, pusher } = setup({
      abTest: 'refused',
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

  it('takes design B out when the time runs out before the even test is verified, and goes on next run', async () => {
    // 3 s an answer, 8 s a request, 25 s a push.
    const clock = { now: Date.parse('2026-11-11T12:00:00Z'), perCall: 3_000 }
    const { account, memory, pusher } = setup({}, { clock })
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
    expect(result).toMatchObject({ ok: true, designs: 'both' })
    expect(account.campaigns.size).toBe(1)
    expect(memory.row()?.ab).toBe('verified')
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
      { outage: '/api/campaign-messages' },
      { outage: '/api/campaign-variations' }
    ] satisfies DraftFaults[]) {
      const { account, pusher } = setup(faults)
      const first = await pusher.createDraft(ab())
      expect(first.ok, JSON.stringify(faults)).toBe(false)
      if (faults.rateLimit)
        expect(first).toEqual({
          ok: false,
          code: 'rate_limited',
          retryAfterSeconds: 30
        })
      expect(await untilDone(pusher, ab())).toMatchObject({
        ok: true,
        designs: 'both'
      })
      expect(account.campaigns.size).toBe(1)
      expect(account.images.size).toBe(2)
      expect(variationsOf(account)).toHaveLength(2)
    }
  })

  it('goes on with a slow Klaviyo inside the cron’s 20 s', async () => {
    const clock = { now: Date.parse('2026-11-11T12:00:00Z'), perCall: 2_500 }
    const { account, pusher } = setup({}, { clock, budgetMs: 20_000 })
    expect(await untilDone(pusher, ab(), 40)).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(account.campaigns.size).toBe(1)
  })

  it('takes over the message Klaviyo makes itself, and keeps our designs when Klaviyo renames them', async () => {
    const auto = setup({ autoMessage: true })
    expect(await auto.pusher.createDraft(ab())).toMatchObject({
      ok: true,
      designs: 'both'
    })
    expect(variationsOf(auto.account).map((v) => v.name)).toEqual([
      'Design A',
      'Design B'
    ])
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
      code: 'unavailable'
    })
    expect(await lag.pusher.createDraft(input())).toMatchObject({ ok: true })
    expect(lag.account.messages.size).toBe(1)

    const partial = setup({ dropRelationships: true })
    expect(await partial.pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'unavailable'
    })
    expect(partial.account.variations.size).toBe(1)
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
