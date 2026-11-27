// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { blueprint } from '@/features/design-engine/fixtures'

vi.mock('server-only', () => ({}))
const observer = vi.hoisted(() => ({
  allowed: vi.fn(async <T>(rows: T[]) => rows)
}))
vi.mock('@/features/inbox/observer-access', () => ({
  observerAllowed: observer.allowed
}))
const {
  blockBlueprints,
  checkedBlocks,
  recentPicks,
  storedPick,
  workspaceLibrary
} = await import('./read')

/**
 * DES-ENGINE-004b: the library as one workspace may use it. The database
 * applies the rule (`library_blocks_for`); these tests are the app's own
 * second check: never another workspace's private block, the Observer
 * selection on shared blocks, this build's own picks left out.
 */
const mine = '00000000-0000-4000-8000-000000000101'
const theirs = '00000000-0000-4000-8000-000000000102'
const row = (over: Record<string, unknown>) => ({
  id: 'b',
  tenant_id: null,
  kind: 'hero',
  facts: { height: 200 },
  uses: 1,
  brands: 1,
  email_types: [],
  width: 600,
  hidden: false,
  emails: [{ id: 'e1', message: 'm1', external_id: 'x1', synthetic: false }],
  ...over
})

function fakeDb(o: {
  rpc?: Record<string, unknown[]>
  rows?: Record<string, Record<string, unknown>[]>
}) {
  const calls: { fn: string; args: unknown }[] = []
  return {
    calls,
    db: {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args })
        return { data: o.rpc?.[fn] ?? [], error: null }
      },
      from: (table: string) => {
        // The filters are recorded, not applied: the app's own checks are
        // what is tested.
        const rows = o.rows?.[table] ?? []
        const q: Record<string, unknown> = {}
        for (const m of ['select', 'eq', 'in', 'not', 'neq', 'order', 'limit'])
          q[m] = (...args: unknown[]) => {
            calls.push({ fn: `${table}.${m}`, args })
            return q
          }
        q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
        q.then = (done: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(done)
        return q
      }
    } as never
  }
}

describe('the library one workspace may use (DES-ENGINE-004b)', () => {
  it('never returns another workspace’s private block, even if the database did', async () => {
    const { db, calls } = fakeDb({
      rpc: {
        library_blocks_for: [
          row({ id: 'shared' }),
          row({
            id: 'own',
            tenant_id: mine,
            geometry_message: null,
            email_id: null
          }),
          row({
            id: 'other',
            tenant_id: theirs,
            geometry_message: null,
            email_id: null
          })
        ]
      }
    })
    const got = await workspaceLibrary(db, mine)
    expect(got.map((b) => [b.id, b.yours])).toEqual([
      ['shared', false],
      ['own', true]
    ])
    expect(calls[0]).toEqual({
      fn: 'library_blocks_for',
      args: { t: mine, with_hidden: false }
    })
    await expect(workspaceLibrary(db, 'not-a-uuid')).rejects.toThrow()
  })

  it('applies the Observer selection to shared blocks: a withdrawn email’s layout is never offered', async () => {
    observer.allowed.mockImplementationOnce(async (rows) =>
      rows.filter((r) => (r as { id: string }).id !== 'e2')
    )
    const { db } = fakeDb({
      rpc: {
        library_blocks_for: [
          row({ id: 'kept' }),
          row({
            id: 'withdrawn',
            emails: [
              { id: 'e2', message: 'm2', external_id: 'x2', synthetic: false }
            ]
          }),
          row({ id: 'no-email', emails: [] }),
          // Its geometry's email withdrawn, another allowed email has the layout.
          row({
            id: 'revived',
            emails: [
              { id: 'e2', message: 'm2', external_id: 'x2', synthetic: false },
              { id: 'e3', message: 'm3', external_id: 'x3', synthetic: false }
            ]
          })
        ]
      }
    })
    expect((await workspaceLibrary(db, mine)).map((b) => b.id)).toEqual([
      'kept',
      'revived'
    ])
  })

  it('leaves hidden layouts out unless asked (the screen shows them)', async () => {
    const rows = [row({ id: 'a' }), row({ id: 'h', hidden: true })]
    const { db } = fakeDb({ rpc: { library_blocks_for: rows } })
    expect((await workspaceLibrary(db, mine)).map((b) => b.id)).toEqual(['a'])
    expect(
      (await workspaceLibrary(db, mine, { withHidden: true })).map(
        (b) => b.hidden
      )
    ).toEqual([false, true])
  })

  it('reads the recent picks of this workspace only, this build’s own left out', async () => {
    const { db, calls } = fakeDb({
      rows: {
        email_copies: [
          { build_id: 'b2', tenant_id: mine, blocks: ['x', 'y'] },
          { build_id: 'b1', tenant_id: mine, blocks: ['z'] },
          { build_id: 'b3', tenant_id: theirs, blocks: ['w'] }
        ]
      }
    })
    expect(await recentPicks(db, mine, 'b1')).toEqual(['x', 'y'])
    expect(calls).toContainEqual({
      fn: 'email_copies.neq',
      args: ['build_id', 'b1']
    })
  })

  it('reads a build’s stored pick only in its own workspace', async () => {
    const own = fakeDb({
      rows: { email_copies: [{ tenant_id: mine, blocks: ['a', 'b'] }] }
    })
    expect(await storedPick(own.db, mine, 'b1')).toEqual(['a', 'b'])
    const other = fakeDb({
      rows: { email_copies: [{ tenant_id: theirs, blocks: ['a'] }] }
    })
    expect(await storedPick(other.db, mine, 'b1')).toBeNull()
  })

  it('draws only shared blocks and the workspace’s own', async () => {
    const { db } = fakeDb({
      rows: {
        library_blocks: [
          { id: 's', tenant_id: null, blueprint: blueprint() },
          { id: 'o', tenant_id: mine, blueprint: blueprint() },
          { id: 't', tenant_id: theirs, blueprint: blueprint() },
          { id: 'bad', tenant_id: null, blueprint: { version: 9 } }
        ]
      }
    })
    expect([
      ...(await blockBlueprints(db, mine, ['s', 'o', 't', 'bad'])).keys()
    ]).toEqual(['s', 'o'])
  })

  it('checks at reference time, with the Observer selection on top', async () => {
    observer.allowed.mockImplementationOnce(async (rows) =>
      rows.filter((r) => (r as { id: string }).id !== 'e2')
    )
    const { db } = fakeDb({
      rpc: {
        library_blocks_check: [
          {
            id: 'a',
            tenant_id: null,
            geometry_message: 'm1',
            geometry_upload: null,
            emails: [
              { id: 'e1', message: 'm1', external_id: 'x', synthetic: false }
            ]
          },
          {
            id: 'b',
            tenant_id: null,
            geometry_message: 'm2',
            geometry_upload: null,
            emails: [
              { id: 'e2', message: 'm2', external_id: 'y', synthetic: false }
            ]
          },
          {
            id: 'c',
            tenant_id: mine,
            geometry_message: null,
            geometry_upload: 'u1',
            emails: []
          }
        ]
      }
    })
    expect(
      (await checkedBlocks(db, mine, ['a', 'b', 'c'])).map((b) => b.id)
    ).toEqual(['a', 'c'])
  })
})
