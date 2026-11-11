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
import type { DraftInput } from '@/lib/providers/klaviyo-draft'
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
  '<p><a href="{% unsubscribe_url %}">Unsubscribe</a></p><p>{% unsubscribe %} {{ organization.full_address }}</p>'
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
  name: 'Tue 17 Nov · Offer',
  subject: '20% off knitwear',
  preheader: 'This weekend only.',
  html: page('A', [hero, knit, knit]),
  plannedSendAt: '2026-11-17T18:00:00Z',
  audienceId: 'SegEng90',
  sample: false,
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
  const rows = new Map<string, PushProgress & { checks?: unknown }>()
  const saves: PushStep[] = []
  const store: PushStore = {
    async load(t, k) {
      const row = rows.get(`${t}/${k}`)
      return row ? structuredClone(row) : null
    },
    async save(t, k, step) {
      saves.push(step)
      const row = rows.get(`${t}/${k}`) ?? {
        state: 'started',
        images: {},
        templates: [],
        campaignId: null,
        messageId: null,
        createStartedAt: null,
        designs: null,
        fallback: null,
        reason: null,
        written: null
      }
      const { images, ...rest } = step
      rows.set(`${t}/${k}`, {
        ...row,
        ...rest,
        images: { ...row.images, ...(images ?? {}) }
      })
    }
  }
  return { store, rows, saves, row: () => rows.get(`${tenantId}/${key}`) }
}

function setup(faults: DraftFaults = {}, options: { live?: boolean } = {}) {
  const account = fakeDraftAccount({ faults })
  const memory = memoryStore()
  const pusher = liveDraftPusher({
    source: {
      async client() {
        return options.live === false
          ? null
          : klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
              transport: account.transport,
              maxWaits: 0
            })
      },
      async timezone() {
        return 'America/Los_Angeles'
      }
    },
    store: memory.store
  })
  return { account, memory, pusher }
}
const writes = (account: FakeDraftAccount) =>
  account.calls.filter((c) => !c.startsWith('GET'))
const only = <T>(m: Map<string, T>) => {
  expect(m.size).toBe(1)
  return [...m.entries()][0]!
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('the live Klaviyo draft push', () => {
  it('moves the pictures into Klaviyo, makes one template and a draft campaign to the planned segment', async () => {
    const { account, memory, pusher } = setup()
    const result = await pusher.createDraft(input())
    const [campaignId, campaign] = only(account.campaigns)
    expect(result).toEqual({ ok: true, campaignId, sample: false })
    expect(campaign).toMatchObject({
      name: 'Tue 17 Nov · Offer',
      description: pushMark(key),
      included: ['SegEng90']
    })
    const [, message] = only(account.messages)
    expect(message.status).toBe('draft')
    const [, variation] = only(account.variations)
    expect(variation).toMatchObject({
      name: 'Design A',
      subject: '20% off knitwear',
      preview: 'This weekend only.'
    })
    // Two pictures (one used twice), each imported once from its address.
    expect([...account.images.values()].map((i) => i.from)).toEqual([
      'https://cedar.example/images/hero.jpg?w=600&h=400',
      knit
    ])
    // The variation's template is Klaviyo's copy: it shows the Klaviyo
    // pictures and the footer tags; our own template is deleted.
    const html = account.templates.get(variation.templateId)!.html
    for (const image of account.images.values())
      expect(html).toContain(image.url)
    expect(html).not.toContain('cedar.example/images')
    expect(html).toContain('{{ organization.full_address }}')
    expect(account.templates.size).toBe(1)
    expect(memory.row()).toMatchObject({
      state: 'drafted',
      campaignId,
      designs: 'A',
      written: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
    // Only draft writes: nothing schedules or sends.
    expect(writes(account).every((c) => !/schedule|send-job/.test(c))).toBe(
      true
    )
    expect(memory.saves.find((s) => s.checks)?.checks).toEqual([
      { id: 'images', pass: true, problems: [] },
      { id: 'footer', pass: true, problems: [] },
      { id: 'size', pass: true, problems: [] }
    ])
  })

  it('puts an A/B design test into one draft with two variations, split evenly with no winner', async () => {
    const { account, memory, pusher } = setup()
    const result = await pusher.createDraft(ab())
    expect(result).toMatchObject({ ok: true, designs: 'both' })
    const [, message] = only(account.messages)
    expect(message.winnerPercentage).toBe(0)
    expect(
      message.variationIds.map((v) => account.variations.get(v)!.name)
    ).toEqual(['Design A', 'Design B'])
    // Same subject and preview; each its own design.
    const [a, b] = message.variationIds.map((v) => account.variations.get(v)!)
    expect(b!.subject).toBe(a!.subject)
    expect(account.templates.get(a!.templateId)!.html).toContain('<h1>A</h1>')
    expect(account.templates.get(b!.templateId)!.html).toContain('<h1>B</h1>')
    expect(memory.row()).toMatchObject({ designs: 'both', fallback: null })
  })

  for (const [fault, fallback] of [
    ['refused', 'ab_test_refused'],
    ['ignored', 'ab_test_not_kept']
  ] as const)
    it(`takes design B out again when Klaviyo ${fault === 'refused' ? 'refuses' : 'does not keep'} the even test`, async () => {
      const { account, memory, pusher } = setup({ abTest: fault })
      const result = await pusher.createDraft(ab())
      expect(result).toMatchObject({ ok: true, designs: 'A' })
      const [, message] = only(account.messages)
      // One variation, design A: Klaviyo's own A/B settings cannot send a winner.
      expect(
        message.variationIds.map((v) => account.variations.get(v)!.name)
      ).toEqual(['Design A'])
      expect(message.winnerPercentage).toBeNull()
      expect(memory.row()).toMatchObject({ designs: 'A', fallback })
    })

  it('makes design B the same email as A when Klaviyo will not take B out', async () => {
    const { account, memory, pusher } = setup({
      abTest: 'refused',
      deleteVariation: 'refused'
    })
    const result = await pusher.createDraft(ab())
    expect(result).toMatchObject({ ok: true, designs: 'A' })
    const [, message] = only(account.messages)
    const variations = message.variationIds.map((v) =>
      account.variations.get(v)!
    )
    expect(variations).toHaveLength(2)
    for (const v of variations)
      expect(account.templates.get(v.templateId)!.html).toContain('<h1>A</h1>')
    expect(memory.row()?.fallback).toBe('ab_test_refused_same_email')
  })

  it('gives the same draft for the same key, updated to the new content, never a second one', async () => {
    const { account, pusher } = setup()
    const first = await pusher.createDraft(input())
    const again = await pusher.createDraft(input())
    expect(again).toEqual(first)
    const changed = await pusher.createDraft(
      input({ subject: 'Knitwear, 20% off', html: page('A2', [hero, knit]) })
    )
    expect(changed).toEqual(first)
    expect(account.campaigns.size).toBe(1)
    // The pictures were imported once.
    expect(account.images.size).toBe(2)
    const [, variation] = only(account.variations)
    expect(variation.subject).toBe('Knitwear, 20% off')
    expect(account.templates.get(variation.templateId)!.html).toContain(
      '<h1>A2</h1>'
    )
  })

  it('finds the campaign whose answer was lost instead of making a second one', async () => {
    const { account, memory, pusher } = setup({ loseCreate: true })
    expect(await pusher.createDraft(input())).toEqual({
      ok: false,
      code: 'unavailable'
    })
    expect(account.campaigns.size).toBe(1)
    expect(memory.row()).toMatchObject({
      createStartedAt: expect.any(String),
      campaignId: null
    })
    const retried = await pusher.createDraft(input())
    const [campaignId] = only(account.campaigns)
    expect(retried).toMatchObject({ ok: true, campaignId })
  })

  it('picks up where it stopped after Klaviyo slowed it down or was unwell, without duplicates', async () => {
    for (const faults of [
      { rateLimit: '/api/images' },
      { outage: '/api/templates' },
      { outage: '/api/campaign-messages/' }
    ] satisfies DraftFaults[]) {
      const { account, pusher } = setup(faults)
      const first = await pusher.createDraft(ab())
      expect(first.ok).toBe(false)
      if (faults.rateLimit)
        expect(first).toEqual({
          ok: false,
          code: 'rate_limited',
          retryAfterSeconds: 30
        })
      expect(await pusher.createDraft(ab())).toMatchObject({
        ok: true,
        designs: 'both'
      })
      expect(account.campaigns.size).toBe(1)
      expect(account.images.size).toBe(2)
    }
  })

  it('never touches a draft the owner scheduled, deleted or changed in Klaviyo', async () => {
    const scheduled = setup()
    await scheduled.pusher.createDraft(input())
    const [, message] = only(scheduled.account.messages)
    message.status = 'scheduled'
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
    const [, variation] = only(edited.account.variations)
    variation.subject = 'The owner wrote this'
    expect(await edited.pusher.createDraft(input())).toEqual({
      ok: false,
      code: 'rejected',
      checks: ['externally_modified']
    })
    expect(variation.subject).toBe('The owner wrote this')
  })

  it('refuses, without calling Klaviyo, what must never reach it', async () => {
    for (const [over, checks] of [
      [{ sample: true }, ['sample']],
      [{ audienceId: 'sample engaged' }, ['audience']],
      [
        { html: '<html><img src="https://cedar.example/a.jpg"></html>' },
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
      [{ variations: [{ approach: 'A', html: page('A', []) }] }, ['variations']]
    ] as [Partial<DraftInput>, string[]][]) {
      const { account, pusher } = setup()
      expect(await pusher.createDraft(input(over))).toEqual({
        ok: false,
        code: 'rejected',
        checks
      })
      expect(account.calls).toEqual([])
    }
  })

  it('refuses a picture it cannot move into Klaviyo, and an email too big for Gmail', async () => {
    for (const [over, faults, checks] of [
      [{ html: page('A', ['http://cedar.example/a.jpg']) }, {}, ['images']],
      [{ html: page('A', ['data:image/png;base64,AAAA']) }, {}, ['images']],
      [{}, { badImage: knit }, ['images']],
      [{ html: page('A' + 'x'.repeat(110 * 1024), []) }, {}, ['size']]
    ] as [Partial<DraftInput>, DraftFaults, string[]][]) {
      const { account, pusher } = setup(faults)
      expect(await pusher.createDraft(input(over))).toEqual({
        ok: false,
        code: 'rejected',
        checks
      })
      expect(account.campaigns.size).toBe(0)
    }
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

  it('stops before a request that might not end in time, and the next run goes on from there', async () => {
    const account = fakeDraftAccount()
    const memory = memoryStore()
    let clock = Date.parse('2026-11-11T12:00:00Z')
    const pusher = liveDraftPusher({
      source: {
        client: async () =>
          klaviyoClient('pk_SAMPLE0123456789abcdefghij', {
            // Each Klaviyo answer takes 4 s.
            transport: async (request) => {
              clock += 4_000
              return account.transport(request)
            },
            maxWaits: 0
          }),
        timezone: async () => 'UTC'
      },
      store: memory.store,
      now: () => new Date(clock),
      budgetMs: 20_000,
      callMs: 10_000
    })
    // A request starts only with 10 s left: three fit (20, 16, 12 s left).
    expect(await pusher.createDraft(ab())).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfterSeconds: 30
    })
    expect(account.calls).toHaveLength(3)
    let result = await pusher.createDraft(ab())
    for (let run = 0; !result.ok && run < 10; run++)
      result = await pusher.createDraft(ab())
    expect(result).toMatchObject({ ok: true, designs: 'both' })
    expect(account.campaigns.size).toBe(1)
    expect(account.images.size).toBe(2)
  })

  it('keeps our template while a variation still points at it', async () => {
    const { account, pusher } = setup({ copiesTemplates: false })
    await pusher.createDraft(input())
    const [, variation] = only(account.variations)
    expect(account.templates.has(variation.templateId)).toBe(true)
  })
})
