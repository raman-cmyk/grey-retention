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
  connectKlaviyo: vi.fn(),
  saveMaxDiscount: vi.fn(),
  addDiscountCode: vi.fn(),
  trackDomain: vi.fn(),
  hideBrand: vi.fn(),
  setupReadModel: vi.fn(),
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
vi.mock('@/features/connections/actions', () => ({
  connectKlaviyo: mocks.connectKlaviyo
}))
vi.mock('@/features/library/inspirations/actions', () => ({
  trackDomain: mocks.trackDomain
}))
vi.mock('@/features/inspiration/actions', () => ({
  hideBrand: mocks.hideBrand
}))
vi.mock('./flow', () => ({ setupReadModel: mocks.setupReadModel }))
vi.mock('@/features/offers/actions', () => ({
  saveMaxDiscount: mocks.saveMaxDiscount,
  addDiscountCode: mocks.addDiscountCode
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

import { setupFlow } from './flow-model'
import {
  addSetupCode,
  confirmBrand,
  connectSetupKlaviyo,
  finishSetup,
  followRival,
  followSuggestion,
  hideRival,
  readStoreAgain,
  saveSetupDiscount,
  saveStore,
  skipRivals
} from './setup-actions'

const owner = { tenantId: 'tenant-1', tenantRole: 'owner' }
type Answer = { data: unknown; error: unknown }

function database(
  rpc: Answer = { data: null, error: null },
  profile: Record<string, unknown> = {},
  tables: Record<string, unknown> = {}
) {
  const calls: { rpc: [string, unknown][]; filters: unknown[][] } = {
    rpc: [],
    filters: []
  }
  const db = {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => (calls.filters.push(args), chain),
        maybeSingle: async () => ({
          data:
            table in tables
              ? tables[table]
              : {
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
      expect(await connectSetupKlaviyo({}, form({ apiKey: 'pk_x' }))).toEqual(
        answer
      )
      expect(await saveSetupDiscount({}, form({ percent: '20' }))).toEqual(
        answer
      )
      expect(await addSetupCode({}, form({ code: 'WELCOME10' }))).toEqual(
        answer
      )
      expect(await followSuggestion({}, form({ domain: 'a.example' }))).toEqual(
        answer
      )
      expect(await hideRival({}, form({ capture: 'x' }))).toEqual(answer)
      expect(await skipRivals()).toEqual(answer)
      expect(await finishSetup()).toEqual(answer)
    }
    expect(mocks.createClient).not.toHaveBeenCalled()
    expect(mocks.connectKlaviyo).not.toHaveBeenCalled()
    expect(mocks.saveMaxDiscount).not.toHaveBeenCalled()
    expect(mocks.addDiscountCode).not.toHaveBeenCalled()
    expect(mocks.trackDomain).not.toHaveBeenCalled()
    expect(mocks.hideBrand).not.toHaveBeenCalled()
  })

  it('says the store changed in another window for a stale save (PT409)', async () => {
    mocks.createClient.mockResolvedValue(
      database({ data: null, error: { code: 'PT409' } }).db
    )
    expect(
      await saveStore(
        {},
        form({ name: 'Cedar Lane', website: 'cedarlane.example' })
      )
    ).toEqual({
      error: 'Your store was changed in another window. Open setup again.'
    })
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

  it('says the website changed when the brand save is stale (PT409)', async () => {
    mocks.createClient.mockResolvedValue(
      database({ data: null, error: { code: 'PT409' } }).db
    )
    expect(
      await confirmBrand(
        {},
        form({ site: 'cedarlane.example', voice: 'New words' })
      )
    ).toEqual({
      error:
        'Your website was changed in another window. Look at what was found again.'
    })
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

  it('connects Klaviyo with the Klaviyo card’s action, then reads the catalog and history', async () => {
    const { db } = database()
    mocks.createClient.mockResolvedValue(db)
    mocks.connectKlaviyo.mockResolvedValue({ message: 'Klaviyo connected.' })
    const key = form({ apiKey: 'pk_sample_key' })
    expect(await redirected(connectSetupKlaviyo({}, key))).toBe('/setup')
    expect(mocks.connectKlaviyo).toHaveBeenCalledWith({}, key)
    expect(mocks.catalog).toHaveBeenCalledWith(db, 'tenant-1')
    expect(mocks.history).toHaveBeenCalledWith(db, 'tenant-1')
    mocks.connectKlaviyo.mockResolvedValue({
      error: 'That is not a Klaviyo private key.'
    })
    expect(await connectSetupKlaviyo({}, key)).toEqual({
      fields: { apiKey: 'That is not a Klaviyo private key.' }
    })
  })

  it('saves the biggest discount with the Settings action, its refusal under the field', async () => {
    mocks.createClient.mockResolvedValue(database().db)
    mocks.saveMaxDiscount.mockResolvedValue({ message: 'Saved.' })
    const discount = form({ percent: '20', revision: '0' })
    expect(await redirected(saveSetupDiscount({}, discount))).toBe('/setup')
    expect(mocks.saveMaxDiscount).toHaveBeenCalledWith({}, discount)
    mocks.saveMaxDiscount.mockResolvedValue({
      error: 'Enter a whole number from 0 to 100.'
    })
    expect(await saveSetupDiscount({}, discount)).toEqual({
      fields: { percent: 'Enter a whole number from 0 to 100.' }
    })
  })

  it('says each wrong code field under the field, before the Settings action', async () => {
    mocks.createClient.mockResolvedValue(database().db)
    mocks.context.mockResolvedValue({ ...owner, timezone: 'UTC' })
    expect(
      await addSetupCode(
        {},
        form({ code: 'NO SPACES', percent: '0', expires: '2026-02-30' })
      )
    ).toEqual({
      fields: {
        code: 'Enter the code exactly as it works in your store: 3 to 40 letters, numbers, - or _.',
        percent: 'Enter a whole percent from 1 to 100.',
        expires: 'Choose a valid end date.'
      }
    })
    expect(mocks.addDiscountCode).not.toHaveBeenCalled()
  })

  it('says a passed end date under its field', async () => {
    mocks.createClient.mockResolvedValue(database().db)
    mocks.context.mockResolvedValue({ ...owner, timezone: 'UTC' })
    expect(
      await addSetupCode(
        {},
        form({ code: 'OLD10', percent: '10', expires: '2020-01-01' })
      )
    ).toEqual({
      fields: { expires: 'That end date has passed. Choose a later one.' }
    })
    expect(mocks.addDiscountCode).not.toHaveBeenCalled()
    // The Settings action's own refusal lands there too.
    mocks.addDiscountCode.mockResolvedValue({
      error: 'That end date has passed. Choose a later one.'
    })
    expect(
      await addSetupCode({}, form({ code: 'OLD10', percent: '10' }))
    ).toEqual({
      fields: { expires: 'That end date has passed. Choose a later one.' }
    })
  })

  it('adds a code with the Settings action and stays on the step', async () => {
    mocks.createClient.mockResolvedValue(database().db)
    mocks.addDiscountCode.mockResolvedValue({ message: 'Added WELCOME10.' })
    expect(
      await addSetupCode({}, form({ code: 'WELCOME10', percent: '10' }))
    ).toEqual({
      message: 'Added WELCOME10.'
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
    mocks.addDiscountCode.mockResolvedValue({
      error: 'WELCOME10 is already in your list.'
    })
    expect(
      await addSetupCode({}, form({ code: 'WELCOME10', percent: '10' }))
    ).toEqual({
      error: 'WELCOME10 is already in your list.'
    })
  })

  it('follows a brand with the Inspiration action, by its website or its row', async () => {
    mocks.createClient.mockResolvedValue(database().db)
    mocks.trackDomain.mockResolvedValue({ message: 'Tracking a.example.' })
    const site = form({ domain: 'a.example' })
    expect(await followRival({}, site)).toEqual({
      message: 'Tracking a.example.'
    })
    expect(mocks.trackDomain).toHaveBeenCalledWith({}, site)
    expect(await followSuggestion({}, site)).toEqual({
      message: 'Tracking a.example.'
    })
    // Refused and not followed: under the field, or by the row.
    mocks.createClient.mockResolvedValue(
      database(undefined, {}, { competitor_captures: null }).db
    )
    mocks.trackDomain.mockResolvedValue({ error: 'That is not a domain.' })
    mocks.revalidatePath.mockClear()
    expect(await followRival({}, site)).toEqual({
      fields: { domain: 'That is not a domain.' }
    })
    expect(await followSuggestion({}, site)).toEqual({
      error: 'That is not a domain.'
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('takes a follow that was saved but could not ask for emails yet as followed, with a note', async () => {
    const { db, calls } = database(
      undefined,
      {},
      {
        competitor_captures: { id: 'cap-1' },
        competitor_subscriptions: { id: 'sub-1' }
      }
    )
    mocks.createClient.mockResolvedValue(db)
    mocks.trackDomain.mockResolvedValue({
      error:
        'Tracking a.example, but we could not ask for their emails yet. Click Track again to retry.'
    })
    expect(await followRival({}, form({ domain: 'A.example' }))).toEqual({
      message: 'Following a.example. We will try to read its emails again soon.'
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/setup')
    expect(calls.filters).toContainEqual(['domain', 'a.example'])
    expect(calls.filters).toContainEqual(['tenant_id', 'tenant-1'])
    expect(calls.filters).toContainEqual(['active', true])
  })

  it('hides a suggested brand with the Inspiration page’s action and words', async () => {
    mocks.createClient.mockResolvedValue(database().db)
    const capture = form({ capture: '00000000-0000-4000-8000-000000000999' })
    mocks.hideBrand.mockResolvedValue({})
    expect(await hideRival({}, capture)).toEqual({
      message: 'Hidden. GROS will not suggest it again.'
    })
    expect(mocks.hideBrand).toHaveBeenCalledWith({}, capture)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/setup')
    mocks.revalidatePath.mockClear()
    mocks.hideBrand.mockResolvedValue({
      error: 'That brand is no longer suggested. Open Inspiration again.'
    })
    expect(await hideRival({}, capture)).toEqual({
      error: 'That brand is no longer suggested here. Open setup again.'
    })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('skips Rivals with the owner’s mark', async () => {
    const { db, calls } = database()
    mocks.createClient.mockResolvedValue(db)
    expect(await redirected(skipRivals())).toBe('/setup')
    expect(calls.rpc).toEqual([
      ['save_onboarding_step', { t: 'tenant-1', step: 'rivals' }]
    ])
  })

  it('finishes only when every step is done, then lands on Home', async () => {
    const records = {
      domain: 'cedarlane.example',
      confirmedSite: 'cedarlane.example',
      klaviyoWorking: true,
      maxDiscountSet: true,
      following: 0,
      rivalsSkipped: false,
      finished: false
    }
    const { db, calls } = database()
    mocks.createClient.mockResolvedValue(db)
    mocks.setupReadModel.mockResolvedValue({ flow: setupFlow(records) })
    expect(await finishSetup()).toEqual({
      error: 'Finish the Rivals step first.'
    })
    expect(calls.rpc).toEqual([])
    mocks.setupReadModel.mockResolvedValue({
      flow: setupFlow({ ...records, rivalsSkipped: true })
    })
    expect(await redirected(finishSetup())).toBe('/home')
    expect(calls.rpc).toEqual([
      ['save_onboarding_step', { t: 'tenant-1', step: 'finish' }]
    ])
    mocks.createClient.mockResolvedValue(
      database({
        data: null,
        error: { code: 'PT409', details: 'klaviyo' }
      }).db
    )
    expect(await finishSetup()).toEqual({
      error: 'Finish the Klaviyo step first.'
    })
    mocks.createClient.mockResolvedValue(
      database({ data: null, error: { code: 'PT409', details: 'odd' } }).db
    )
    expect(await finishSetup()).toEqual({ error: 'Finish every step first.' })
    mocks.setupReadModel.mockResolvedValue({ flow: null })
    expect(await finishSetup()).toEqual({
      error: 'We could not read your setup. Try again in a minute.'
    })
  })
})
