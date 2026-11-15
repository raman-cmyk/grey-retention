// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memoryFallbackLog } from '@/features/fallback/log'
import type { PlannedEmail } from './build'
import { sampleOffersFrom, sampleStoreFrom, type Store } from './ports'
import { runBuildStep, storeFingerprint } from './steps'

/**
 * REL-STO: a build's steps read the store fresh, so the first step saves
 * what it read (`storeFingerprint`) and a later step on other store data
 * starts over (`store_changed`, "Your store data changed while this email
 * was being made. Try again.").
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
const ctx = () => ({
  tenantId,
  callerKey: 'email-build:b1',
  fallbacks: memoryFallbackLog(),
  clock: () => Date.parse('2026-03-01T00:00:00Z')
})
const run = (step: string, s: Store, progress: unknown) =>
  runBuildStep(
    step,
    { planned, store: s, offers: sampleOffersFrom(start), progress },
    ctx()
  )
/** The steps before `upTo`, saved as the job saves them. */
async function savedUpTo(upTo: 'content' | 'copy' | 'design') {
  const progress: Record<string, unknown> = {}
  for (const step of ['sections', 'content', 'copy'] as const) {
    if (step === upTo) break
    const made = await run(step, await store(), progress)
    if (!made.ok || !('output' in made)) throw new Error(`${step} failed`)
    progress[step] = JSON.parse(JSON.stringify(made.output))
  }
  return progress
}
const withPrice = (s: Store, price: string): Store => ({
  ...s,
  products: s.products.map((p) =>
    p.id === 'p-linen-throw' ? { ...p, price } : p
  )
})

describe('the store a build started from (REL-STO)', () => {
  it('the first step saves what it read', async () => {
    const progress = await savedUpTo('content')
    expect(progress.sections).toMatchObject({
      store: storeFingerprint(await store())
    })
    expect(storeFingerprint(await store())).toMatch(/^[0-9a-f]{32}$/)
  })

  it.each(['content', 'copy', 'design'] as const)(
    'the %s step starts over on other store data: a price, a new product, a sold-out one, the brand',
    async (step) => {
      const progress = await savedUpTo(step)
      const s = await store()
      for (const changed of [
        withPrice(s, '$99.00'),
        {
          ...s,
          products: [
            ...s.products,
            { ...s.products[0], id: 'p-new', title: 'New mug' }
          ]
        },
        {
          ...s,
          products: s.products.map((p) =>
            p.id === 'p-cedar-candle' ? { ...p, featurable: false } : p
          )
        },
        { ...s, brand: { ...s.brand, accent: '#000000' } }
      ])
        expect(await run(step, changed, progress)).toEqual({
          ok: false,
          code: 'store_changed'
        })
    }
  )

  it('goes on when the store is read again the same, in another order, or with a new timezone or customer words', async () => {
    const progress = await savedUpTo('content')
    const s = await store()
    for (const same of [
      s,
      { ...s, products: [...s.products].reverse() },
      // Later steps use the timezone and words the steps before saved.
      { ...s, timezone: 'Pacific/Kiritimati' },
      { ...s, customerWords: ['smells like a forest'] }
    ])
      expect(await run('content', same, progress)).toMatchObject({
        ok: true,
        done: 'content'
      })
  })

  it('a build saved before this goes on as before (no store saved)', async () => {
    const progress = await savedUpTo('content')
    const older = { ...(progress.sections as Record<string, unknown>) }
    delete older.store
    expect(
      await run('content', withPrice(await store(), '$99.00'), {
        sections: older
      })
    ).toMatchObject({ ok: true, done: 'content' })
  })

  it('a saved store that is not text cannot be read', async () => {
    const progress = await savedUpTo('content')
    expect(
      await run('content', await store(), {
        sections: { ...(progress.sections as object), store: 7 }
      })
    ).toEqual({ ok: false, code: 'step_progress_invalid' })
  })

  it('the same data gives the same fingerprint, whatever its key order', async () => {
    const s = await store()
    const reordered = Object.fromEntries(Object.entries(s).reverse()) as Store
    expect(storeFingerprint(reordered)).toBe(storeFingerprint(s))
    expect(storeFingerprint(withPrice(s, '$1.00'))).not.toBe(
      storeFingerprint(s)
    )
  })
})
