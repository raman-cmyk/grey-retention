import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const klaviyo = vi.hoisted(() => ({ klaviyoData: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/features/klaviyo-data/reader', () => klaviyo)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { settingsPage } from './data'

const context = {
  tenantId: '00000000-0000-4000-8000-000000000101',
  timezone: 'Asia/Kathmandu'
}
const product = {
  id: '00000000-0000-4000-8000-000000000301',
  title: 'Field overshirt (synthetic)',
  synthetic: true
}
type Result = { data: unknown; error: { code: string } | null }
let defaultsRow: Result
let productList: Result
let productById: Result

beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
  defaultsRow = { data: null, error: null }
  productList = { data: [product], error: null }
  productById = { data: null, error: null }
  klaviyo.klaviyoData.mockResolvedValue({
    state: 'sample',
    shopify: 'missing',
    snapshot: {
      lists: [{ id: 'LSTnews01', name: 'Newsletter' }],
      segments: [{ id: 'SEGeng030', name: 'Engaged 30 days' }]
    }
  })
  supabase.createClient.mockResolvedValue({
    from: (table: string) => {
      const filters: string[] = []
      const chain: Record<string, unknown> = {}
      for (const op of ['select', 'order', 'limit']) chain[op] = () => chain
      chain.eq = (column: string) => {
        filters.push(column)
        return chain
      }
      chain.maybeSingle = async () =>
        table === 'campaign_defaults' ? defaultsRow : productById
      chain.then = (resolve: (v: unknown) => unknown) => resolve(productList)
      return chain
    }
  })
})

describe('settingsPage', () => {
  it('uses empty defaults before the first save and lists sample audiences', async () => {
    const page = await settingsPage(context, 0)
    expect(page.state).toBe('ready')
    expect(page.timezone).toBe('Asia/Kathmandu')
    expect(page.data).toMatchObject({
      defaults: { revision: 0, sendTo: [], includeFooter: true },
      products: [{ id: product.id, title: product.title }],
      productsState: 'ready',
      productsSample: true,
      audienceSource: 'sample',
      audiences: [
        { id: 'LSTnews01', name: 'Newsletter', kind: 'list' },
        { id: 'SEGeng030', name: 'Engaged 30 days', kind: 'segment' }
      ]
    })
  })

  it('reads the saved row', async () => {
    defaultsRow = {
      data: {
        featured_product_id: product.id,
        sender_name: 'Cedar Lane',
        primary_link: 'https://cedar-lane.example',
        send_to: ['LSTnews01'],
        dont_send_to: [],
        include_footer: false,
        footer_source: 'auto',
        revision: 4
      },
      error: null
    }
    const page = await settingsPage(context, 0)
    expect(page.data?.defaults).toEqual({
      featuredProductId: product.id,
      senderName: 'Cedar Lane',
      primaryLink: 'https://cedar-lane.example',
      sendTo: ['LSTnews01'],
      dontSendTo: [],
      includeFooter: false,
      footerSource: 'auto',
      revision: 4
    })
  })

  it('always offers the saved product, even past the first 200', async () => {
    const other = {
      id: '00000000-0000-4000-8000-000000000399',
      title: 'Cap',
      synthetic: false
    }
    defaultsRow = {
      data: {
        featured_product_id: other.id,
        sender_name: '',
        primary_link: '',
        send_to: [],
        dont_send_to: [],
        include_footer: true,
        footer_source: 'auto',
        revision: 1
      },
      error: null
    }
    productById = { data: other, error: null }
    const page = await settingsPage(context, 0)
    expect(page.data?.products.map((p) => p.id)).toEqual([other.id, product.id])
  })

  it('keeps the saved product when the catalogue fails to load', async () => {
    productList = { data: null, error: { code: 'XX000' } }
    const page = await settingsPage(context, 0)
    expect(page.data?.productsState).toBe('error')
  })

  it('has no audiences without a Klaviyo connection', async () => {
    klaviyo.klaviyoData.mockResolvedValue({
      state: 'not_connected',
      reason: 'expired'
    })
    const page = await settingsPage(context, 0)
    expect(page.data).toMatchObject({
      audiences: [],
      audienceSource: 'not_connected'
    })
  })

  it('tells a missing table apart from other load errors', async () => {
    defaultsRow = { data: null, error: { code: 'PGRST205' } }
    expect((await settingsPage(context, 0)).state).toBe('missing_table')
    defaultsRow = { data: null, error: { code: '42P01' } }
    expect((await settingsPage(context, 0)).state).toBe('missing_table')
    defaultsRow = { data: null, error: { code: 'PGRST301' } }
    const failed = await settingsPage(context, 0)
    expect(failed).toMatchObject({ state: 'load_failed', data: null })
  })

  it('does not read the database in the demo or without one', async () => {
    env.values = { AUTH_MODE: 'demo' }
    expect(await settingsPage(context, 0)).toMatchObject({
      state: 'demo',
      data: null
    })
    env.values = { AUTH_MODE: 'supabase' }
    supabase.createClient.mockResolvedValueOnce(null)
    expect((await settingsPage(context, 0)).state).toBe('no_database')
  })

  it('falls back to UTC for a timezone this runtime does not know', async () => {
    const page = await settingsPage({ ...context, timezone: 'Factory' }, 0)
    expect(page.timezone).toBe('UTC')
    expect(klaviyo.klaviyoData).toHaveBeenCalledWith(context.tenantId, 'UTC', 0)
  })
})
