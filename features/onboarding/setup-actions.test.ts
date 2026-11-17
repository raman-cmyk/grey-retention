// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  env: { AUTH_MODE: 'supabase' as string },
  context: vi.fn(),
  createClient: vi.fn(),
  site: vi.fn(),
  ads: vi.fn(),
  reviews: vi.fn(),
  catalog: vi.fn(),
  history: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { to })
  })
}))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext: mocks.context
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/env/server', () => ({
  getServerEnvironment: () => mocks.env
}))
vi.mock('./site/start', () => ({ startSiteReading: mocks.site }))
vi.mock('./ads/start', () => ({ startAdsReading: mocks.ads }))
vi.mock('./reviews/start', () => ({ startReviewsReading: mocks.reviews }))
vi.mock('./catalog/start', () => ({ startCatalogReading: mocks.catalog }))
vi.mock('./history/start', () => ({ startHistoryReading: mocks.history }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import { confirmBrand, readStoreAgain, saveStore } from './setup-actions'

const owner = { tenantId: 'tenant-1', tenantRole: 'owner' }
type Answer = { data: unknown; error: unknown }

function database(
  rpc: Answer = { data: null, error: null },
  profile: Record<string, unknown> = {}
) {
  const calls: { rpc: [string, unknown][]; filters: unknown[][] } = {
    rpc: [],
    filters: []
  }
  const db = {
    from: () => {
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => (calls.filters.push(args), chain),
        maybeSingle: async () => ({
          data: {
            revision: 4,
            positioning: 'Quiet weekends',
            voice: 'Calm',
            prohibitions: 'No claims',
            brand_name: 'Cedar Lane',
            domain: 'cedarlane.example',
            ...profile
          },
          error: null
        })
      }
      return chain
    },
    rpc: async (name: string, args: unknown) => (
      calls.rpc.push([name, args]),
      rpc
    )
  }
  return { db, calls }
}

const form = (fields: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}
const redirected = async (work: Promise<unknown>) =>
  ((await work.catch((e: { to?: string }) => e)) as { to?: string }).to

describe('setup actions (UI-ONBb)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.env.AUTH_MODE = 'supabase'
    mocks.context.mockResolvedValue(owner)
    for (const start of [
      mocks.site,
      mocks.ads,
      mocks.reviews,
      mocks.catalog,
      mocks.history
    ])
      start.mockResolvedValue({ ok: true, jobId: 'job' })
  })

  it('saves the store with the profile’s own command, keeps the rest, and starts the readers', async () => {
    const { db, calls } = database()
    mocks.createClient.mockResolvedValue(db)
    const to = await redirected(
      saveStore(
        {},
        form({
          name: ' Cedar Lane ',
          website: 'https://WWW.CedarLane.example/shop'
        })
      )
    )
    expect(to).toBe('/setup')
    expect(calls.filters).toContainEqual(['tenant_id', 'tenant-1'])
    expect(calls.rpc).toEqual([
      [
        'save_brand',
        {
          t: 'tenant-1',
          expected_revision: 4,
          brand_name: 'Cedar Lane',
          domain: 'cedarlane.example',
          positioning: 'Quiet weekends',
          voice: 'Calm',
          prohibitions: 'No claims'
        }
      ]
    ])
    for (const start of [mocks.site, mocks.ads, mocks.reviews])
      expect(start).toHaveBeenCalledWith(db, 'tenant-1')
  })

  it('says what is wrong next to each field, and saves nothing', async () => {
    const { db, calls } = database()
    mocks.createClient.mockResolvedValue(db)
    expect(
      await saveStore({}, form({ name: 'C', website: 'not a site' }))
    ).toEqual({
      fields: {
        name: 'Enter your store’s name, 2 to 120 letters.',
        website: 'Enter your store’s website, like cedarlane.com.'
      }
    })
    expect(
      await saveStore({}, form({ name: 'Cedar Lane', website: 'cedar:8080' }))
    ).toEqual({
      fields: { website: 'Enter your store’s website, like cedarlane.com.' }
    })
    expect(calls.rpc).toEqual([])
    expect(mocks.site).not.toHaveBeenCalled()
  })

  it('refuses staff and admins on the server', async () => {
    for (const tenantRole of ['staff', 'admin']) {
      mocks.context.mockResolvedValue({ ...owner, tenantRole })
      const answer = {
        error: 'Only the workspace owner can set up your store.'
      }
      expect(
        await saveStore(
          {},
          form({ name: 'Cedar Lane', website: 'cedarlane.example' })
        )
      ).toEqual(answer)
      expect(
        await confirmBrand({}, form({ site: 'cedarlane.example' }))
      ).toEqual(answer)
      expect(await readStoreAgain()).toEqual(answer)
    }
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('says plainly when the save is refused, and starts no reader', async () => {
    const { db } = database({ data: null, error: { code: '40001' } })
    mocks.createClient.mockResolvedValue(db)
    expect(
      await saveStore(
        {},
        form({ name: 'Cedar Lane', website: 'cedarlane.example' })
      )
    ).toEqual({
      error: 'Your store was changed in another window. Open setup again.'
    })
    expect(mocks.site).not.toHaveBeenCalled()
  })

  it('still saves the store when a reader does not start (Brand offers Try again)', async () => {
    const { db } = database()
    mocks.createClient.mockResolvedValue(db)
    mocks.site.mockResolvedValue({ ok: false, code: 'unavailable' })
    expect(
      await redirected(
        saveStore(
          {},
          form({ name: 'Cedar Lane', website: 'cedarlane.example' })
        )
      )
    ).toBe('/setup')
  })

  it('saves nothing in the demo', async () => {
    mocks.env.AUTH_MODE = 'demo'
    mocks.createClient.mockResolvedValue(database().db)
    expect(
      await saveStore(
        {},
        form({ name: 'Cedar Lane', website: 'cedarlane.example' })
      )
    ).toEqual({ error: 'Please sign in again. Nothing was changed.' })
    expect(mocks.site).not.toHaveBeenCalled()
  })

  it('confirms the brand for the website shown, saving the voice and rules when they changed', async () => {
    const { db, calls } = database()
    mocks.createClient.mockResolvedValue(db)
    const shown = form({
      site: 'cedarlane.example',
      voice: ' Warm and clear ',
      prohibitions: 'No claims'
    })
    expect(await redirected(confirmBrand({}, shown))).toBe('/setup')
    expect(calls.rpc).toEqual([
      [
        'save_brand',
        {
          t: 'tenant-1',
          expected_revision: 4,
          brand_name: 'Cedar Lane',
          domain: 'cedarlane.example',
          positioning: 'Quiet weekends',
          voice: 'Warm and clear',
          prohibitions: 'No claims'
        }
      ],
      [
        'save_onboarding_step',
        { t: 'tenant-1', step: 'brand', site_shown: 'cedarlane.example' }
      ]
    ])
    // Nothing changed: only the mark.
    const same = database()
    mocks.createClient.mockResolvedValue(same.db)
    await redirected(
      confirmBrand(
        {},
        form({
          site: 'cedarlane.example',
          voice: 'Calm',
          prohibitions: 'No claims'
        })
      )
    )
    expect(same.calls.rpc.map(([name]) => name)).toEqual([
      'save_onboarding_step'
    ])
  })

  it('never confirms blind: another website, a stale one, words too long', async () => {
    const { db, calls } = database()
    mocks.createClient.mockResolvedValue(db)
    const changed = {
      error:
        'Your website was changed in another window. Look at what was found again.'
    }
    expect(await confirmBrand({}, form({ site: 'other.example' }))).toEqual(
      changed
    )
    expect(calls.rpc).toEqual([])
    mocks.createClient.mockResolvedValue(
      database({ data: null, error: { code: 'PT409', details: 'changed' } }).db
    )
    expect(
      await confirmBrand(
        {},
        form({
          site: 'cedarlane.example',
          voice: 'Calm',
          prohibitions: 'No claims'
        })
      )
    ).toEqual(changed)
    expect(
      await confirmBrand(
        {},
        form({ site: 'cedarlane.example', voice: 'x'.repeat(5001) })
      )
    ).toEqual({ fields: { voice: 'Keep it under 5000 characters.' } })
  })

  it('reads every reader again, the Klaviyo ones only once Klaviyo is connected', async () => {
    const { db } = database()
    mocks.createClient.mockResolvedValue(db)
    mocks.catalog.mockResolvedValue({ ok: false, code: 'connect_klaviyo' })
    mocks.history.mockResolvedValue({ ok: false, code: 'connect_klaviyo' })
    expect(await readStoreAgain()).toEqual({})
    for (const start of [
      mocks.site,
      mocks.ads,
      mocks.reviews,
      mocks.catalog,
      mocks.history
    ])
      expect(start).toHaveBeenCalledWith(db, 'tenant-1')
    mocks.catalog.mockResolvedValue({ ok: false, code: 'unavailable' })
    expect(await readStoreAgain()).toEqual({
      error: 'We could not start reading your store. Try again in a minute.'
    })
    mocks.catalog.mockResolvedValue({ ok: true, jobId: 'job' })
    mocks.ads.mockResolvedValue({ ok: false, code: 'unavailable' })
    expect((await readStoreAgain()).error).toBeDefined()
  })
})
