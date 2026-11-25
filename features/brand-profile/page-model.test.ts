// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const workspace = vi.hoisted(() => ({ campaignWorkspace: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const profile = vi.hoisted(() => ({ brandProfileData: vi.fn() }))
vi.mock('@/features/campaigns/data', () => workspace)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('./data', () => profile)

import { brandBookPage, brandPage } from './page-model'

/**
 * UI-BRAND: the Brand page's and the Brand book page's reads. A Brand
 * book that could not be read is said so (with Try again), never shown as
 * "not written yet".
 */
const tenant = '00000000-0000-4000-8000-000000000101'
const context = {
  tenantId: tenant,
  tenantRole: 'owner',
  timezone: 'America/New_York'
}
type Result = { data: unknown; error: unknown }

/**
 * A session whose reads answer per table, whatever the filters (a table
 * not named answers with no rows).
 */
function db(tables: Record<string, Result>) {
  const chain = (result: Result) => {
    const link: Record<string, unknown> = {}
    for (const step of ['select', 'eq', 'is', 'order']) link[step] = () => link
    link.limit = async () => result
    link.maybeSingle = async () => result
    return link
  }
  return {
    from: (table: string) => chain(tables[table] ?? { data: [], error: null })
  }
}

const book = {
  version: 5,
  content: { facts: { returnDays: 30 } },
  written_by: 'brand-book@2',
  created_at: '2026-11-24T10:00:00Z'
}

beforeEach(() => {
  workspace.campaignWorkspace.mockResolvedValue({
    context,
    data: {
      brand: {
        revision: 7,
        approved_revision: 6,
        brand_name: 'Cedar Lane',
        domain: 'cedarlane.example',
        positioning: '',
        voice: '',
        prohibitions: ''
      },
      products: [],
      offers: []
    },
    error: null
  })
  profile.brandProfileData.mockResolvedValue({
    sections: [],
    unavailable: false,
    mismatches: []
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('brandPage', () => {
  it('reads the brand version and the latest Brand book', async () => {
    supabase.createClient.mockResolvedValue(
      db({
        brand_events: { data: [], error: null },
        brand_books: { data: [book], error: null }
      })
    )
    const view = await brandPage()
    if (view.state !== 'ready') throw new Error('not ready')
    expect(view.brand).toEqual({ revision: 7, approvedRevision: 6 })
    expect(view.book).toEqual({
      version: 5,
      writtenAt: '2026-11-24T10:00:00Z'
    })
    expect(view.history).toEqual([])
    expect(view.rewrite).toBeNull()
  })

  it('says when the Brand book is being rewritten, or was not (UI-BRAND-2)', async () => {
    const soon = new Date(Date.now() + 30_000).toISOString()
    for (const [job, state] of [
      [
        {
          status: 'queued',
          updated_at: new Date().toISOString(),
          lease_until: null
        },
        'waiting'
      ],
      [
        {
          status: 'running',
          updated_at: new Date().toISOString(),
          lease_until: soon
        },
        'writing'
      ],
      [
        {
          status: 'retry_wait',
          updated_at: new Date().toISOString(),
          lease_until: null
        },
        'failed'
      ],
      [
        {
          status: 'succeeded',
          updated_at: new Date().toISOString(),
          lease_until: null
        },
        null
      ]
    ] as const) {
      supabase.createClient.mockResolvedValue(
        db({
          brand_events: { data: [], error: null },
          brand_books: { data: [book], error: null },
          job_runs: { data: [job], error: null }
        })
      )
      const view = await brandPage()
      expect(view.state === 'ready' && view.rewrite, job.status).toBe(state)
    }
    // A rewrite that cannot be read never hides the page.
    supabase.createClient.mockResolvedValue(
      db({
        brand_events: { data: [], error: null },
        brand_books: { data: [book], error: null },
        job_runs: { data: null, error: { code: '42501' } }
      })
    )
    const view = await brandPage()
    expect(view.state === 'ready' && view.rewrite).toBeNull()
  })

  it('says no book is written yet only when there is none', async () => {
    supabase.createClient.mockResolvedValue(
      db({
        brand_events: { data: [], error: null },
        brand_books: { data: [], error: null }
      })
    )
    const view = await brandPage()
    expect(view.state === 'ready' && view.book).toBeNull()
  })

  it('passes a failed Brand book read through as unreadable', async () => {
    supabase.createClient.mockResolvedValue(
      db({
        brand_events: { data: null, error: { code: '42P01' } },
        brand_books: { data: null, error: { code: '42501' } }
      })
    )
    const view = await brandPage()
    if (view.state !== 'ready') throw new Error('not ready')
    expect(view.book).toBe('unreadable')
    expect(view.history).toBeNull()
  })

  it('is an error when the workspace cannot be read', async () => {
    workspace.campaignWorkspace.mockResolvedValue({
      context,
      data: null,
      error: 'Workspace data is unavailable.'
    })
    supabase.createClient.mockResolvedValue(db({}))
    expect((await brandPage()).state).toBe('error')
  })
})

describe('brandBookPage', () => {
  it('reads the book in words, or says it could not be read', async () => {
    supabase.createClient.mockResolvedValue(
      db({
        brand_profiles: {
          data: { revision: 7, approved_revision: 7 },
          error: null
        },
        brand_books: { data: [book], error: null }
      })
    )
    const view = await brandBookPage(context as never)
    if (view.state !== 'ready') throw new Error('not ready')
    expect(view.book?.facts).toEqual([
      { text: 'Returns within 30 days', own: false }
    ])
    expect(view.brand).toEqual({ revision: 7, approvedRevision: 7 })
    expect(view.rewrite).toBeNull()
    supabase.createClient.mockResolvedValue(
      db({
        brand_profiles: { data: null, error: null },
        brand_books: { data: null, error: { code: '42501' } }
      })
    )
    expect((await brandBookPage(context as never)).state).toBe('error')
  })

  it('reads the owner’s corrections and shows every part to the owner (UI-BRAND-2)', async () => {
    const tables = {
      brand_profiles: {
        data: { revision: 7, approved_revision: 7 },
        error: null
      },
      brand_books: { data: [book], error: null },
      brand_book_corrections: {
        data: [
          {
            id: 'c1',
            section: 'facts.returnDays',
            original: null,
            action: 'replace',
            value: '30',
            created_at: '2026-11-24T09:00:00Z'
          }
        ],
        error: null
      },
      job_runs: {
        data: [
          {
            status: 'running',
            updated_at: new Date().toISOString(),
            lease_until: new Date(Date.now() + 30_000).toISOString()
          }
        ],
        error: null
      }
    }
    supabase.createClient.mockResolvedValue(db(tables))
    const view = await brandBookPage(context as never)
    if (view.state !== 'ready') throw new Error('not ready')
    expect(view.book?.facts).toEqual([
      { text: 'Returns within 30 days', own: true }
    ])
    expect(view.book?.corrections.map((c) => c.text)).toEqual([
      'Returns within 30 days'
    ])
    expect(view.book?.seen).toHaveLength(6)
    expect(view.rewrite).toBe('writing')
    // Staff see only the parts with lines.
    const staff = await brandBookPage({
      ...context,
      tenantRole: 'staff'
    } as never)
    expect(staff.state === 'ready' && staff.book?.seen).toEqual([])
    // Corrections that cannot be read: the page says it could not open.
    supabase.createClient.mockResolvedValue(
      db({
        ...tables,
        brand_book_corrections: { data: null, error: { code: '42501' } }
      })
    )
    expect((await brandBookPage(context as never)).state).toBe('error')
  })
})
