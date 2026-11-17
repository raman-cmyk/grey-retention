import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { pickReference } from './reference'
import {
  maxFollowedEmails,
  maxSampleEmails,
  pageRows,
  readReferenceRows,
  toReferences,
  type ReferenceRows
} from './reference-source'

const now = Date.parse('2026-11-17T12:00:00Z')
const at = { now, timezone: 'UTC' }
const grid = ['header_logo', 'hero_image', 'product_grid_2col', 'footer']

const facts = (sentAt: string, subject: string) => ({
  version: 1,
  subject,
  preview: null,
  offer: { kind: 'none', value: null, code: null },
  angle: 'launch',
  cta: null,
  sentAt,
  blockSequence: grid,
  textRatio: null,
  sections: grid.length
})

type EmailRow = ReferenceRows['emails'][number]
const mail = (over: Partial<EmailRow> & { id: string }): EmailRow => ({
  capture_id: 'pine',
  inbox_message_id: `m-${over.id}`,
  subject: `Subject ${over.id}`,
  received_at: '2026-11-10T09:00:00Z',
  industry: 'home',
  email_type: 'bestsellers',
  angle: 'launch',
  synthetic: false,
  facts: null,
  ...over
})
const sectionsOf = (id: string, heights = [80, 600, 700]) =>
  [
    ['header_logo', null],
    ['hero_image', 'product_feature'],
    ['product_grid_2col', null]
  ].map(([block, owner], i) => ({
    inbox_message_id: `m-${id}`,
    // Out of order on purpose: the rows are sorted by ordinal.
    ordinal: 3 - i,
    block_type: block,
    owner_block_type: owner,
    height: heights[i],
    purpose: null,
    styles: null,
    image_path: null
  }))

const rows = (over: Partial<ReferenceRows> = {}): ReferenceRows => ({
  followed: ['pine'],
  hidden: [],
  brands: [
    { id: 'pine', brand_name: 'Pine & Co', domain: 'pine.example' },
    { id: 'oak', brand_name: null, domain: 'oak.example' }
  ],
  emails: [mail({ id: 'e1' })],
  sections: sectionsOf('e1'),
  history: [],
  ...over
})

describe('toReferences', () => {
  it('turns the rows into reference emails with their sections in order', () => {
    const { emails, followed } = toReferences(rows(), at)
    expect(followed).toEqual(new Set(['pine']))
    expect(emails).toEqual([
      {
        id: 'e1',
        brandId: 'pine',
        brand: 'Pine & Co',
        synthetic: false,
        subject: 'Subject e1',
        industry: 'home',
        emailType: 'bestsellers',
        angle: 'launch',
        receivedAt: '2026-11-10T09:00:00Z',
        winner: false,
        // Sorted by ordinal; the owner's label wins over the labeller's.
        sections: [
          {
            blockType: 'product_grid_2col',
            height: 700,
            purpose: null,
            styles: [],
            image: null
          },
          {
            blockType: 'product_feature',
            height: 600,
            purpose: null,
            styles: [],
            image: null
          },
          {
            blockType: 'header_logo',
            height: 80,
            purpose: null,
            styles: [],
            image: null
          }
        ]
      }
    ])
  })

  it('keeps only followed brands and sample brands, never a hidden one', () => {
    const { emails, followed } = toReferences(
      rows({
        followed: ['pine', 'elm'],
        hidden: ['elm', 'birch'],
        emails: [
          mail({ id: 'e1' }),
          mail({ id: 'e2', capture_id: 'stranger' }),
          mail({ id: 'e3', capture_id: 'oak', synthetic: true }),
          mail({ id: 'e4', capture_id: 'elm' }),
          mail({ id: 'e5', capture_id: 'birch', synthetic: true })
        ],
        sections: ['e1', 'e2', 'e3', 'e4', 'e5'].flatMap((id) => sectionsOf(id))
      }),
      at
    )
    expect(emails.map((e) => e.id)).toEqual(['e1', 'e3'])
    expect(followed).toEqual(new Set(['pine']))
    // A brand with no name is called by its domain.
    expect(emails[1].brand).toBe('oak.example')
  })

  it('leaves out an email with no sections, and reads a missing label as unsure', () => {
    const { emails } = toReferences(
      rows({
        emails: [
          mail({ id: 'e1' }),
          mail({ id: 'e2' }),
          mail({ id: 'e3', inbox_message_id: null })
        ],
        sections: [
          {
            inbox_message_id: 'm-e1',
            ordinal: 1,
            block_type: null,
            owner_block_type: null,
            height: null,
            purpose: 'offer',
            styles: ['dark'],
            // DST-004b: the section's stored picture, for the match score.
            image_path: 'sect/m-e1/1.jpg'
          }
        ]
      }),
      at
    )
    expect(emails.map((e) => e.id)).toEqual(['e1'])
    // Only this email's own crop of this section is kept.
    const other = toReferences(
      rows({
        sections: [
          {
            ...sectionsOf('e1')[0]!,
            image_path: 'sect/m-e2/0.jpg'
          }
        ]
      }),
      at
    )
    expect(other.emails[0]?.sections[0]?.image).toBeNull()
    expect(emails[0].sections).toEqual([
      {
        blockType: 'unsure',
        height: null,
        purpose: 'offer',
        styles: ['dark'],
        image: 'sect/m-e1/1.jpg'
      }
    ])
  })

  it('marks a layout its brand keeps sending as a winner, from its whole year of sends', () => {
    const sent = (id: string, day: string) => ({
      id,
      capture_id: 'pine',
      facts: facts(day, `Campaign ${id}`)
    })
    const { emails } = toReferences(
      rows({
        // Only w3 is a reference; its brand sent the layout twice before.
        emails: [
          mail({
            id: 'w3',
            received_at: '2026-11-12T10:00:00Z',
            facts: facts('2026-11-12T10:00:00Z', 'Campaign w3')
          }),
          mail({
            id: 'one',
            capture_id: 'oak',
            synthetic: true,
            facts: facts('2026-11-12T10:00:00Z', 'Alone')
          })
        ],
        history: [
          sent('w1', '2026-11-03T10:00:00Z'),
          sent('w2', '2026-11-10T10:00:00Z')
        ],
        sections: ['w3', 'one'].flatMap((id) => sectionsOf(id))
      }),
      at
    )
    expect(Object.fromEntries(emails.map((e) => [e.id, e.winner]))).toEqual({
      w3: true,
      one: false
    })
  })

  it('feeds the pick', () => {
    const { emails, followed } = toReferences(rows(), at)
    expect(
      pickReference(
        emails,
        { industry: 'home', emailType: 'bestseller' },
        { mode: 'remix', now, followed }
      ).email?.id
    ).toBe('e1')
  })
})

type Op = [string, unknown[]]
type Answer = { data: unknown; error: unknown }

/**
 * A Supabase client that records every query and answers each from its
 * table's handler (which sees the query's operations).
 */
function fakeDb(handlers: Record<string, (ops: Op[]) => Answer>) {
  const calls: { table: string; ops: Op[] }[] = []
  const db = {
    from(table: string) {
      const call = { table, ops: [] as Op[] }
      calls.push(call)
      const chain: Record<string, unknown> = {}
      for (const op of [
        'select',
        'eq',
        'or',
        'gte',
        'not',
        'order',
        'limit',
        'in',
        'range',
        'maybeSingle'
      ])
        chain[op] = (...args: unknown[]) => {
          call.ops.push([op, args])
          return chain
        }
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(handlers[table](call.ops)).then(resolve)
      return chain
    }
  }
  return { db: db as never, calls }
}

const ok = (data: unknown): Answer => ({ data, error: null })
const has = (ops: Op[], op: string, ...args: unknown[]) =>
  ops.some(([o, a]) => o === op && JSON.stringify(a) === JSON.stringify(args))

/** A sample workspace following pine, with oak hidden. */
const handlers = (over: Record<string, (ops: Op[]) => Answer> = {}) => ({
  competitor_subscriptions: () =>
    ok([{ capture_id: 'pine' }, { capture_id: 'pine' }, { capture_id: 'oak' }]),
  competitor_hidden: () => ok([{ capture_id: 'oak' }]),
  brand_profiles: () => ok({ synthetic: true }),
  competitor_emails: (ops: Op[]) =>
    has(ops, 'select', 'id, capture_id, facts')
      ? ok([{ id: 'h1', capture_id: 'pine', facts: null }])
      : has(ops, 'eq', 'synthetic', true)
        ? ok([mail({ id: 's1', capture_id: 'birch', synthetic: true })])
        : ok([mail({ id: 'e1' })]),
  competitor_captures: () => ok(rows().brands),
  email_sections: (ops: Op[]) =>
    ok(
      (ops.find(([o]) => o === 'in')![1][1] as string[]).flatMap((m) =>
        sectionsOf(m.slice(2))
      )
    ),
  ...over
})

describe('readReferenceRows', () => {
  it('scopes every workspace read to the tenant and leaves hidden brands out', async () => {
    const { db, calls } = fakeDb(handlers())
    const read = await readReferenceRows(db, 'tenant-1', now)
    for (const table of [
      'competitor_subscriptions',
      'competitor_hidden',
      'brand_profiles'
    ])
      expect(
        has(
          calls.find((c) => c.table === table)!.ops,
          'eq',
          'tenant_id',
          'tenant-1'
        )
      ).toBe(true)
    expect(has(calls[0].ops, 'eq', 'active', true)).toBe(true)
    // oak is followed but hidden: neither followed nor read.
    expect(read.followed).toEqual(['pine'])
    expect(read.hidden).toEqual(['oak'])
    const emailReads = calls.filter((c) => c.table === 'competitor_emails')
    const own = emailReads.find((c) =>
      has(c.ops, 'in', 'capture_id', ['pine'])
    )!
    expect(has(own.ops, 'eq', 'labels_state', 'tagged')).toBe(true)
    expect(has(own.ops, 'gte', 'received_at', '2025-11-16T12:00:00.000Z')).toBe(
      true
    )
    expect(has(own.ops, 'limit', maxFollowedEmails)).toBe(true)
    const samples = emailReads.find((c) => has(c.ops, 'eq', 'synthetic', true))!
    expect(has(samples.ops, 'not', 'capture_id', 'in', '(oak)')).toBe(true)
    expect(has(samples.ops, 'limit', maxSampleEmails)).toBe(true)
    expect(read.emails.map((e) => e.id)).toEqual(['e1', 's1'])
    expect(read.history).toEqual([
      { id: 'h1', capture_id: 'pine', facts: null }
    ])
  })

  it('reads no sample brands for a real store, nor for a store not yet known', async () => {
    for (const profile of [{ synthetic: false }, null]) {
      const { db, calls } = fakeDb(
        handlers({ brand_profiles: () => ok(profile) })
      )
      const read = await readReferenceRows(db, 'tenant-1', now)
      expect(calls.some((c) => has(c.ops, 'eq', 'synthetic', true))).toBe(false)
      expect(read.emails.map((e) => e.id)).toEqual(['e1'])
    }
  })

  it('stops when there is nothing to read', async () => {
    const { db, calls } = fakeDb(
      handlers({
        competitor_subscriptions: () => ok([]),
        brand_profiles: () => ok({ synthetic: false })
      })
    )
    expect(await readReferenceRows(db, 'tenant-1', now)).toEqual({
      followed: [],
      hidden: ['oak'],
      brands: [],
      emails: [],
      sections: [],
      history: []
    })
    expect(calls.map((c) => c.table)).not.toContain('competitor_emails')
  })

  it('reads every section past the server’s page size, in batches of emails', async () => {
    const many = Array.from({ length: 60 }, (_, i) => mail({ id: `x${i}` }))
    const ranges: unknown[][] = []
    const { db, calls } = fakeDb(
      handlers({
        competitor_emails: (ops) =>
          has(ops, 'select', 'id, capture_id, facts') ? ok([]) : ok(many),
        email_sections: (ops) => {
          const range = ops.find(([o]) => o === 'range')![1]
          ranges.push(range)
          const [from] = range as number[]
          // The first batch is long: a full first page, then the rest.
          const ids = ops.find(([o]) => o === 'in')![1][1] as string[]
          const total = ids.length === 50 ? pageRows + 7 : 30
          const count = Math.max(0, Math.min(pageRows, total - from))
          return ok(
            Array.from({ length: count }, (_, i) => ({
              inbox_message_id: ids[(from + i) % ids.length],
              ordinal: from + i,
              block_type: 'text',
              owner_block_type: null,
              height: 100,
              purpose: null,
              styles: null,
              image_path: null
            }))
          )
        }
      })
    )
    const read = await readReferenceRows(db, 'tenant-1', now)
    expect(calls.filter((c) => c.table === 'email_sections').length).toBe(3)
    expect(ranges).toEqual([
      [0, pageRows - 1],
      [0, 10 * 40 - 1],
      [pageRows, 50 * 40 - 1]
    ])
    expect(read.sections).toHaveLength(pageRows + 7 + 30)
  })

  it('throws with the code when a read fails, so the step is tried again', async () => {
    for (const table of [
      'competitor_subscriptions',
      'competitor_hidden',
      'brand_profiles',
      'competitor_emails',
      'competitor_captures',
      'email_sections'
    ]) {
      const { db } = fakeDb(
        handlers({ [table]: () => ({ data: null, error: { code: 'XX000' } }) })
      )
      const error = await readReferenceRows(db, 'tenant-1', now).catch(
        (e: Error) => e
      )
      expect((error as Error).message).toMatch(/^reference_\w+_read_failed$/)
      expect((error as Error).cause).toEqual({ code: 'XX000' })
    }
  })
})
