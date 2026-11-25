// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memoryFallbackLog } from '@/features/fallback/log'
import type { ReferenceEmail } from '@/features/studio/reference'
import type { BuildCtx, BuiltEmail, PlannedEmail } from './build'
import {
  copyWords,
  type CopyInput,
  type CopyRecord,
  type BlueprintState,
  type CopyState,
  type LibraryCopyPort
} from './library-copy'
import { libraryStep, libraryWaits, libraryWaitSeconds } from './library-step'
import { sampleOffersFrom, sampleStoreFrom } from './ports'
import { runBuildStep } from './steps'

/**
 * DES-ENGINE-002b2: the design step of a Copy email with the library copy
 * on: the blueprint and the copy through their ports (faked here), the
 * waits, and every way back to coded blocks with its plain reason.
 */
const tenantId = '00000000-0000-4000-8000-000000000101'
const start = '2026-03-02'
const planned: PlannedEmail = {
  date: '2026-03-04',
  time: '10:00',
  emailType: 'bestseller',
  angle: 'What everyone bought this month',
  products: [
    { id: 'p-cedar-candle', title: 'Cedar candle' },
    { id: 'p-linen-throw', title: 'Linen throw' }
  ],
  offer: null,
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
}
const store = () => sampleStoreFrom(start).read(tenantId)

const reference: ReferenceEmail = {
  id: 'ref-1',
  brandId: 'pine',
  brand: 'Pine & Co',
  synthetic: true,
  subject: 'The cedar edit',
  industry: 'home',
  emailType: 'bestseller',
  angle: 'social proof',
  receivedAt: '2026-02-25T10:00:00Z',
  winner: false,
  sections: [
    { blockType: 'header_logo', height: 90 },
    { blockType: 'hero_image', height: 560 },
    { blockType: 'product_grid_2col', height: 640 },
    { blockType: 'footer', height: 200 }
  ]
}

const record = (over: Partial<CopyRecord> = {}): CopyRecord => ({
  html: '<html lang="en"><body>copy</body></html>',
  sections: [
    { ordinal: 1, kind: 'header', result: 'copied', reason: null },
    {
      ordinal: 2,
      kind: 'offer',
      result: 'library',
      reason:
        'Section 2 (offer) has a countdown timer, so it was built from the library’s Offer banner block.'
    }
  ],
  pass: false,
  leaks: [],
  footerAdded: false,
  photos: [0],
  ...over
})

function fakePort(
  blueprint: Awaited<ReturnType<LibraryCopyPort['blueprint']>>,
  copy: CopyState = { state: 'queued' }
) {
  const asked: { messageId: string; input: CopyInput; photos: number }[] = []
  const port: LibraryCopyPort = {
    blueprint: async () => blueprint,
    copy: async (messageId, input, photos) => {
      asked.push({ messageId, input, photos })
      return copy
    }
  }
  return { port, asked }
}

const ready: BlueprintState = {
  state: 'ready',
  messageId: 'm-1',
  sourceNames: ['Pine & Co', 'pine.example']
}

async function step(
  port: LibraryCopyPort,
  saved: unknown = undefined,
  checks: (html: string) => { check: string; problem: string }[] = () => []
) {
  const s = await store()
  const coded = { subject: 'Coded', html: '<p>coded</p>' } as BuiltEmail
  return libraryStep({
    port,
    emailId: 'ref-1',
    store: s,
    draft: {
      subject: 'S',
      preheader: 'P',
      blocks: [
        { type: 'hero_product', content: { headline: 'Our cedar candle' } }
      ],
      productIds: ['p-cedar-candle'],
      code: null
    } as never,
    rules: { maxDiscountPercent: 20, codes: [] },
    coded,
    saved,
    checks
  })
}

describe('the library step (DES-ENGINE-002b2)', () => {
  it('waits for a blueprint still being measured, 3 times 30 minutes, then draws coded blocks and says why', async () => {
    const { port } = fakePort({ state: 'waiting' })
    for (let waits = 0; waits < libraryWaits; waits++)
      expect(await step(port, { library: { waits } })).toEqual({
        kind: 'waiting',
        work: { library: { waits: waits + 1 } },
        seconds: libraryWaitSeconds
      })
    expect(await step(port, { library: { waits: libraryWaits } })).toEqual({
      kind: 'coded',
      reasonCode: 'library_waiting',
      reason: copyWords.waiting
    })
  })

  it('says in plain words why a blueprint cannot be used (hidden, failed, none)', async () => {
    const { port, asked } = fakePort({
      state: 'unusable',
      reason: 'you no longer follow its brand, or you hid it in Inspiration'
    })
    expect(await step(port)).toEqual({
      kind: 'coded',
      reasonCode: 'library_unusable',
      reason:
        'The design of the email you chose in Inspiration could not be copied (you no longer follow its brand, or you hid it in Inspiration), so this email was made with coded blocks.'
    })
    expect(asked).toEqual([])
  })

  it('asks for the copy with the brand’s own content and Klaviyo’s tags, and waits for it', async () => {
    const { port, asked } = fakePort(ready)
    expect(await step(port)).toMatchObject({ kind: 'waiting' })
    expect(asked).toHaveLength(1)
    const { messageId, input, photos } = asked[0]!
    expect(messageId).toBe('m-1')
    expect(input.mode).toBe('klaviyo')
    expect(input.sourceNames).toEqual(['Pine & Co', 'pine.example'])
    expect(input.words.headline).toEqual(['Our cedar candle'])
    expect(input.products.map((p) => p.id)).toEqual(['p-cedar-candle'])
    // Never where photos may come from: that is the server's fixed list.
    expect(input).not.toHaveProperty('origins')
    expect(photos).toBeGreaterThan(0)
    expect(photos).toBeLessThanOrEqual(24)
    // The copy that keeps not coming: coded blocks, and why.
    expect(await step(port, { library: { waits: libraryWaits } })).toEqual({
      kind: 'coded',
      reasonCode: 'library_copying',
      reason: copyWords.copying
    })
  })

  it('draws coded blocks when the copy failed, leaked or failed a hard check', async () => {
    expect(
      await step(
        fakePort(ready, {
          state: 'failed',
          reason: 'the copy could not be drawn'
        }).port
      )
    ).toMatchObject({
      kind: 'coded',
      reasonCode: 'library_failed',
      reason: copyWords.failed('the copy could not be drawn')
    })
    expect(
      await step(
        fakePort(ready, {
          state: 'done',
          record: record({ leaks: [{ kind: 'name', value: 'Pine & Co' }] })
        }).port
      )
    ).toEqual({
      kind: 'coded',
      reasonCode: 'library_leaks',
      reason: copyWords.leaks
    })
    expect(
      await step(
        fakePort(ready, { state: 'done', record: record() }).port,
        undefined,
        () => [{ check: 'alt', problem: 'A picture has no words.' }]
      )
    ).toEqual({
      kind: 'coded',
      reasonCode: 'library_check_alt',
      reason: `${copyWords.checks} A picture has no words.`
    })
  })

  it('a done copy that passes the checks is the email, with each section’s outcome', async () => {
    const got = await step(
      fakePort(ready, { state: 'done', record: record() }).port
    )
    expect(got.kind).toBe('email')
    if (got.kind !== 'email') return
    expect(got.email.html).toBe(record().html)
    expect(got.email.subject).toBe('Coded')
    expect(got.email.library).toEqual({
      emailId: 'ref-1',
      sections: record().sections,
      footerAdded: false
    })
  })
})

describe('Copy in the design step, behind the switch (DES-ENGINE-002b2)', () => {
  const ctx = (
    over: Omit<Partial<BuildCtx>, 'fallbacks'> & { library?: LibraryCopyPort }
  ) => ({
    tenantId,
    callerKey: 'email-build:b1',
    fallbacks: memoryFallbackLog(),
    clock: () => Date.parse('2026-03-01T00:00:00Z'),
    ...over
  })
  /** Sections (Copy of `reference`), content and copy, saved as the job saves them. */
  async function saved(mode: 'copy' | 'remix' | null) {
    const progress: Record<string, unknown> = {}
    for (const s of ['sections', 'content', 'copy'] as const) {
      const made = await runBuildStep(
        s,
        {
          planned,
          store: await store(),
          offers: sampleOffersFrom(start),
          progress
        },
        ctx(
          mode
            ? {
                reference: {
                  mode,
                  chosen: 'ref-1',
                  load: async () => ({
                    emails: [reference],
                    followed: new Set(['pine'])
                  })
                }
              }
            : {}
        )
      )
      if (!made.ok || !('output' in made)) throw new Error(`${s} failed`)
      progress[s] = JSON.parse(JSON.stringify(made.output))
    }
    return progress
  }
  const design = async (
    progress: Record<string, unknown>,
    c: ReturnType<typeof ctx>
  ) =>
    runBuildStep(
      'design',
      {
        planned,
        store: await store(),
        offers: sampleOffersFrom(start),
        progress
      },
      c
    )

  it('waits for the copy, then stores it; the coded email stays the fallback', async () => {
    const progress = await saved('copy')
    expect(progress.sections).toMatchObject({
      reference: { emailId: 'ref-1', mode: 'copy' }
    })
    const waiting = await design(
      progress,
      ctx({ library: fakePort(ready).port })
    )
    expect(waiting).toEqual({
      ok: true,
      waiting: 'design',
      work: { library: { waits: 1 } },
      seconds: libraryWaitSeconds
    })
    // A copy whose HTML passes the hard checks is the email (here: the
    // coded email's own HTML stands for a copy that passes).
    const coded = await design(progress, ctx({}))
    if (!coded.ok || !('email' in coded)) throw new Error('not drawn')
    const c = ctx({
      library: fakePort(ready, {
        state: 'done',
        record: record({ html: coded.email.html })
      }).port
    })
    const done = await design(progress, c)
    expect(done).toMatchObject({ ok: true, done: 'design' })
    if (!done.ok || !('email' in done)) return
    expect(done.email.library?.sections).toEqual(record().sections)
    expect(c.fallbacks.entries()).toEqual([])
    // A copy whose HTML fails the hard checks: coded blocks, logged.
    const bad = ctx({
      library: fakePort(ready, {
        state: 'done',
        record: record({ html: '<p>copy</p>' })
      }).port
    })
    const failed = await design(progress, bad)
    expect(failed).toMatchObject({ ok: true, done: 'design' })
    if (!failed.ok || !('email' in failed)) return
    expect(failed.email.library).toBeUndefined()
    expect(failed.email.html).toBe(coded.email.html)
    expect(bad.fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'design-library',
        reasonCode: expect.stringMatching(/^library_check_/),
        reason: expect.stringContaining(copyWords.checks)
      })
    ])
  })

  it('logs why it drew coded blocks, once, in plain words', async () => {
    const progress = await saved('copy')
    const c = ctx({
      library: fakePort({
        state: 'unusable',
        reason: 'it has no stored copy that can be measured'
      }).port
    })
    const made = await design(progress, c)
    expect(made).toMatchObject({ ok: true, done: 'design' })
    if (!made.ok || !('email' in made)) return
    expect(made.email.library).toBeUndefined()
    expect(c.fallbacks.entries()).toEqual([
      expect.objectContaining({
        agent: 'design-library',
        reasonCode: 'library_unusable',
        reason:
          'The design of the email you chose in Inspiration could not be copied (it has no stored copy that can be measured), so this email was made with coded blocks.',
        fallback: 'Drew the email with its coded blocks.'
      })
    ])
  })

  it('leaves Remix, Scratch and the switch off unchanged', async () => {
    for (const mode of ['remix', null] as const) {
      const progress = await saved(mode)
      const { port, asked } = fakePort(ready)
      const made = await design(progress, ctx({ library: port }))
      expect(made).toMatchObject({ ok: true, done: 'design' })
      expect(asked).toEqual([])
    }
    const progress = await saved('copy')
    const off = await design(progress, ctx({}))
    expect(off).toMatchObject({ ok: true, done: 'design' })
  })
})
