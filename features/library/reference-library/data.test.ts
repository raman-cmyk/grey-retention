// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Result = { data: unknown; error: { code: string } | null }
const db = vi.hoisted(() => ({
  on: true,
  tables: {} as Record<string, Result>,
  calls: [] as {
    table: string
    filters: [string, unknown][]
    limit?: number
  }[],
  signed: [] as { bucket: string; paths: string[] }[]
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () =>
    db.on
      ? {
          storage: {
            from: (bucket: string) => ({
              createSignedUrls: async (paths: string[]) => {
                db.signed.push({ bucket, paths })
                // Storage refuses what this member may not read.
                return {
                  data: paths.map((path) =>
                    path.includes('not-mine')
                      ? { path, signedUrl: '', error: 'Object not found' }
                      : {
                          path,
                          signedUrl: `https://db.test/${path}?token=t`,
                          error: null
                        }
                  ),
                  error: null
                }
              }
            })
          },
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
            chain.not = () => chain
            chain.gte = () => chain
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
const { latestUploads } = await import('./model')
const tenant = '00000000-0000-4000-8000-000000000101'

afterEach(() => {
  db.on = true
  db.tables = {}
  db.calls = []
  db.signed = []
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

  it('says when there may be older uploads than the latest 40', async () => {
    const upload = (n: number) => ({
      id: `i${n}`,
      subject: `Upload ${n}`,
      original_body: 'Hello',
      readable_text: 'Hello',
      content_format: 'text',
      source_description: 'Pasted email',
      created_at: '2026-11-02T10:00:00Z'
    })
    db.tables = {
      competitor_subscriptions: { data: [], error: null },
      reference_imports: {
        data: Array.from({ length: 39 }, (_, i) => upload(i)),
        error: null
      }
    }
    expect((await referenceLibrary(tenant))?.uploadsCapped).toBe(false)
    expect(db.calls.find((c) => c.table === 'reference_imports')?.limit).toBe(
      latestUploads
    )
    db.tables.reference_imports = {
      data: Array.from({ length: 40 }, (_, i) => upload(i)),
      error: null
    }
    expect((await referenceLibrary(tenant))?.uploadsCapped).toBe(true)
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

  it('shows the stored screenshot where there is one, signed with the member’s own session', async () => {
    const email = (id: string, screenshot_path: string | null) => ({
      id,
      capture_id: 'c1',
      subject: `Email ${id}`,
      text_content: 'Hello',
      safe_html: '<p>Hello</p>',
      received_at: '2026-11-02T10:00:00Z',
      synthetic: true,
      screenshot_path,
      screenshot_width: 640,
      screenshot_height: 2400
    })
    db.tables = {
      competitor_subscriptions: {
        data: [
          {
            id: 's1',
            capture_id: 'c1',
            label: 'Northwind',
            revision: 1,
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
          email('e1', 'shot/11111111-1111-4111-8111-111111111111.jpg'),
          email('e2', null),
          email('e3', 'shot/not-mine.jpg')
        ],
        error: null
      }
    }
    const library = await referenceLibrary(tenant)
    const byId = Object.fromEntries(
      (library?.items ?? []).map((i) => [i.id, i])
    )
    expect(byId.e1?.screenshot).toEqual({
      url: 'https://db.test/shot/11111111-1111-4111-8111-111111111111.jpg?token=t',
      width: 640,
      height: 2400
    })
    expect(byId.e2?.screenshot).toBeNull()
    // A picture storage refuses is simply not shown.
    expect(byId.e3?.screenshot).toBeNull()
    expect(db.signed).toEqual([
      {
        bucket: 'inbox-assets',
        paths: [
          'shot/11111111-1111-4111-8111-111111111111.jpg',
          'shot/not-mine.jpg'
        ]
      }
    ])
  })
})
