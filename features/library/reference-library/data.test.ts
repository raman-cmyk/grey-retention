// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Result = { data: unknown; error: { code: string } | null }
const db = vi.hoisted(() => ({
  on: true,
  tables: {} as Record<string, Result>,
  calls: [] as { table: string; filters: [string, unknown][]; limit?: number }[]
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    db.on
      ? {
          from: (table: string) => {
            const call = {
              table,
              filters: [] as [string, unknown][],
              limit: undefined as number | undefined
            }
            db.calls.push(call)
            const answer = () => db.tables[table] ?? { data: [], error: null }
            const chain: Record<string, unknown> = {}
            chain.select = () => chain
            chain.eq = (column: string, value: unknown) => {
              call.filters.push([column, value])
              return chain
            }
            chain.in = (column: string, value: unknown) => {
              call.filters.push([column, value])
              return Object.assign(Promise.resolve(answer()), chain)
            }
            chain.order = () => chain
            chain.limit = async (n: number) => {
              call.limit = n
              return answer()
            }
            chain.range = async () => answer()
            return chain
          }
        }
      : null
}))

const { referenceLibrary, latestPerDomain } = await import('./data')
const tenant = '00000000-0000-4000-8000-000000000101'

afterEach(() => {
  db.on = true
  db.tables = {}
  db.calls = []
})

describe('referenceLibrary', () => {
  it('reads this workspace only and at most 20 emails per tracked domain', async () => {
    db.tables = {
      competitor_subscriptions: {
        data: [
          {
            id: 's1',
            capture_id: 'c1',
            label: 'Northwind',
            revision: 2,
            active: true
          }
        ],
        error: null
      },
      competitor_captures: {
        data: [
          {
            id: 'c1',
            domain: 'northwind.example',
            status: 'live',
            synthetic: true
          }
        ],
        error: null
      },
      competitor_emails: {
        data: [
          {
            id: 'e1',
            capture_id: 'c1',
            subject: 'Spring',
            text_content: 'New jackets',
            safe_html:
              '<p>New <a href="https://northwind.example/unsubscribe">jackets</a></p>',
            received_at: '2026-11-01T10:00:00Z',
            synthetic: true
          }
        ],
        error: null
      }
    }
    const lib = await referenceLibrary(tenant)
    expect(lib?.items).toHaveLength(1)
    const email = db.calls.find((c) => c.table === 'competitor_emails')!
    expect(email.limit).toBe(latestPerDomain)
    expect(email.filters).toContainEqual(['capture_id', 'c1'])
    for (const table of [
      'competitor_subscriptions',
      'reference_imports',
      'own_templates'
    ])
      expect(db.calls.find((c) => c.table === table)?.filters).toContainEqual([
        'tenant_id',
        tenant
      ])
    // Links are removed on the server before anything reaches the browser.
    expect(lib?.items[0]?.preview?.html).not.toMatch(/href=/)
    expect(lib?.tracked).toEqual([
      expect.objectContaining({
        domain: 'northwind.example',
        status: 'live',
        emails: 1
      })
    ])
  })

  it('sanitizes uploads and marks saved layouts as samples', async () => {
    db.tables = {
      competitor_subscriptions: { data: [], error: null },
      reference_imports: {
        data: [
          {
            id: 'i1',
            subject: 'My favourite',
            original_body:
              '<html><body><script>alert(1)</script><a href="https://x.example">Shop</a><img src="https://tracker.example/p.gif"></body></html>',
            readable_text: 'Shop',
            content_format: 'html',
            source_description: 'Pasted email',
            created_at: '2026-11-02T10:00:00Z'
          }
        ],
        error: null
      },
      own_templates: {
        data: [
          {
            id: 't1',
            name: 'Autumn layout',
            created_at: '2026-11-03T10:00:00Z'
          }
        ],
        error: null
      }
    }
    const lib = await referenceLibrary(tenant)
    const upload = lib?.items.find((i) => i.id === 'i1')
    expect(upload?.preview?.html).not.toMatch(/<script|href=|tracker\.example/)
    const layout = lib?.items.find((i) => i.id === 't1')
    expect(layout).toMatchObject({
      tab: 'yours',
      source: 'template',
      sample: true
    })
  })

  it('shows PENDING until emails arrive and ERROR when a capture failed', async () => {
    db.tables = {
      competitor_subscriptions: {
        data: [
          { id: 's1', capture_id: 'c1', label: 'a', revision: 1, active: true },
          { id: 's2', capture_id: 'c2', label: 'b', revision: 1, active: true }
        ],
        error: null
      },
      competitor_captures: {
        data: [
          {
            id: 'c1',
            domain: 'a.example',
            status: 'opt_in_pending',
            synthetic: true
          },
          { id: 'c2', domain: 'b.example', status: 'error', synthetic: true }
        ],
        error: null
      }
    }
    const lib = await referenceLibrary(tenant)
    expect(lib?.tracked.map((d) => d.status)).toEqual(['pending', 'error'])
  })

  it('claims nothing when it cannot read', async () => {
    db.tables = {
      competitor_subscriptions: { data: null, error: { code: 'XX000' } }
    }
    expect(await referenceLibrary(tenant)).toBeNull()
    db.tables = {
      competitor_subscriptions: { data: [], error: null },
      reference_imports: { data: null, error: { code: 'XX000' } }
    }
    expect(await referenceLibrary(tenant)).toBeNull()
    db.on = false
    expect(await referenceLibrary(tenant)).toBeNull()
  })
})
