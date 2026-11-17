import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { pickReference } from './reference'
import {
  maxReferenceEmails,
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
    styles: null
  }))

const rows = (over: Partial<ReferenceRows> = {}): ReferenceRows => ({
  followed: ['pine'],
  brands: [
    { id: 'pine', brand_name: 'Pine & Co', domain: 'pine.example' },
    { id: 'oak', brand_name: null, domain: 'oak.example' }
  ],
  emails: [mail({ id: 'e1' })],
  sections: sectionsOf('e1'),
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
            styles: []
          },
          {
            blockType: 'product_feature',
            height: 600,
            purpose: null,
            styles: []
          },
          { blockType: 'header_logo', height: 80, purpose: null, styles: [] }
        ]
      }
    ])
  })

  it('keeps only followed brands and sample brands', () => {
    const { emails } = toReferences(
      rows({
        emails: [
          mail({ id: 'e1' }),
          mail({ id: 'e2', capture_id: 'stranger' }),
          mail({ id: 'e3', capture_id: 'oak', synthetic: true })
        ],
        sections: [
          ...sectionsOf('e1'),
          ...sectionsOf('e2'),
          ...sectionsOf('e3')
        ]
      }),
      at
    )
    expect(emails.map((e) => e.id)).toEqual(['e1', 'e3'])
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
            styles: ['dark']
          }
        ]
      }),
      at
    )
    expect(emails.map((e) => e.id)).toEqual(['e1'])
    expect(emails[0].sections).toEqual([
      { blockType: 'unsure', height: null, purpose: 'offer', styles: ['dark'] }
    ])
  })

  it('marks a layout its brand keeps sending as a winner', () => {
    const dated = (id: string, day: string) =>
      mail({ id, received_at: day, facts: facts(day, `Campaign ${id}`) })
    const { emails } = toReferences(
      rows({
        emails: [
          dated('w1', '2026-11-03T10:00:00Z'),
          dated('w2', '2026-11-10T10:00:00Z'),
          dated('w3', '2026-11-12T10:00:00Z'),
          mail({
            id: 'one',
            capture_id: 'oak',
            synthetic: true,
            facts: facts('2026-11-12T10:00:00Z', 'Alone')
          })
        ],
        sections: ['w1', 'w2', 'w3', 'one'].flatMap((id) => sectionsOf(id))
      }),
      at
    )
    expect(Object.fromEntries(emails.map((e) => [e.id, e.winner]))).toEqual({
      w1: true,
      w2: true,
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

/** A Supabase client that answers each table with its rows and records the query. */
function fakeDb(answers: Record<string, { data: unknown; error: unknown }>) {
  const calls: { table: string; ops: [string, unknown[]][] }[] = []
  const db = {
    from(table: string) {
      const call = { table, ops: [] as [string, unknown[]][] }
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
        'in'
      ])
        chain[op] = (...args: unknown[]) => {
          call.ops.push([op, args])
          return chain
        }
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(answers[table]).then(resolve)
      return chain
    }
  }
  return { db: db as never, calls }
}

describe('readReferenceRows', () => {
  const answers = {
    competitor_subscriptions: {
      data: [{ capture_id: 'pine' }, { capture_id: 'pine' }],
      error: null
    },
    competitor_emails: { data: [mail({ id: 'e1' })], error: null },
    competitor_captures: { data: rows().brands, error: null },
    email_sections: { data: sectionsOf('e1'), error: null }
  }

  it('reads the followed brands, then their and sample brands’ tagged emails of the last year', async () => {
    const { db, calls } = fakeDb(answers)
    const read = await readReferenceRows(db, 'tenant-1', now)
    expect(read.followed).toEqual(['pine'])
    expect(read.sections).toHaveLength(3)
    const ops = (table: string) =>
      Object.fromEntries(calls.find((c) => c.table === table)!.ops)
    expect(calls[0]).toMatchObject({ table: 'competitor_subscriptions' })
    expect(ops('competitor_subscriptions').eq).toEqual(['active', true])
    const emails = ops('competitor_emails')
    expect(emails.or).toEqual(['synthetic.eq.true,capture_id.in.(pine)'])
    expect(emails.gte).toEqual(['received_at', '2025-11-16T12:00:00.000Z'])
    expect(emails.limit).toEqual([maxReferenceEmails])
    expect(ops('email_sections').in).toEqual(['inbox_message_id', ['m-e1']])
  })

  it('reads sample brands alone when nothing is followed, and stops when there is no email', async () => {
    const { db, calls } = fakeDb({
      ...answers,
      competitor_subscriptions: { data: [], error: null },
      competitor_emails: { data: [], error: null }
    })
    const read = await readReferenceRows(db, 'tenant-1', now)
    expect(read).toEqual({ followed: [], brands: [], emails: [], sections: [] })
    expect(
      Object.fromEntries(
        calls.find((c) => c.table === 'competitor_emails')!.ops
      ).or
    ).toEqual(['synthetic.eq.true'])
    expect(calls.map((c) => c.table)).not.toContain('email_sections')
  })

  it('throws when a read fails, so the step is tried again', async () => {
    for (const table of Object.keys(answers)) {
      const { db } = fakeDb({
        ...answers,
        [table]: { data: null, error: { code: 'x' } }
      })
      await expect(readReferenceRows(db, 'tenant-1', now)).rejects.toThrow(
        /^reference_/
      )
    }
  })
})
