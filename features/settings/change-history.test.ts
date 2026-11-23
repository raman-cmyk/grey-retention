import { describe, expect, it, vi } from 'vitest'
import {
  changeKinds,
  changeText,
  listChangeHistory,
  mergeChanges
} from './change-history'

describe('a recorded change in plain words', () => {
  it.each([
    ['max_discount_changed', { from: null, to: 20 }, 'Max discount set to 20%'],
    [
      'brand_book_corrected',
      { section: 'voice', action: 'replace' },
      "Brand book: line about the brand's voice changed"
    ],
    [
      'brand_book_corrected',
      { section: 'customers.love', action: 'add' },
      'Brand book: line about what customers love added'
    ],
    [
      'brand_book_corrected',
      { section: 'facts.returnDays', action: 'replace', value: '30' },
      'Brand book: returns within 30 days'
    ],
    [
      'brand_book_corrected',
      { section: 'facts.returnDays', action: 'replace', value: '0' },
      'Brand book: no returns'
    ],
    [
      'brand_book_corrected',
      { section: 'facts.freeShipping', action: 'replace', value: 'over 75' },
      'Brand book: free shipping over 75'
    ],
    [
      'brand_book_corrected',
      { section: 'facts.deliveryDays', action: 'replace', value: '3-7' },
      'Brand book: delivery in 3 to 7 days'
    ],
    [
      'brand_book_corrected',
      { section: 'facts.guaranteeDays', action: 'remove' },
      'Brand book: money-back guarantee removed'
    ],
    [
      'brand_book_correction_withdrawn',
      { section: 'marketing', action: 'remove' },
      "Brand book: change about the brand's marketing undone"
    ],
    [
      'brand_book_correction_withdrawn',
      { section: 'facts.returnDays', action: 'replace' },
      'Brand book: change to the return policy undone'
    ],
    [
      'max_discount_changed',
      { from: 20, to: 25 },
      'Max discount changed from 20% to 25%'
    ],
    [
      'revenue_goal_set',
      { month: '2026-11-01', to_amount: 20000, to_currency: 'USD' },
      'Revenue goal for November 2026 set to $20,000'
    ],
    [
      'revenue_goal_set',
      {
        month: '2026-12-01',
        from_amount: 20000,
        from_currency: 'AUD',
        to_amount: 22500.5,
        to_currency: 'AUD'
      },
      'Revenue goal for December 2026 changed to A$22,500.50 (was A$20,000)'
    ],
    [
      'revenue_goal_set',
      {
        month: '2026-11-01',
        from_amount: 25000,
        from_currency: 'GBP',
        to_amount: null,
        to_currency: null
      },
      'Revenue goal for November 2026 removed (was £25,000)'
    ],
    [
      'margin_floor_changed',
      { from_margin: null, from_floor: null, to_margin: 60, to_floor: 30 },
      'Margin floor set to 30% on a 60% margin'
    ],
    [
      'margin_floor_changed',
      { from_margin: 60, from_floor: 30, to_margin: 55, to_floor: 0 },
      'Margin floor changed to 0% on a 55% margin (was 30% on 60%)'
    ],
    [
      'margin_floor_changed',
      { from_margin: 55, from_floor: 25, to_margin: null, to_floor: null },
      'Margin floor removed'
    ],
    [
      'discount_code_added',
      { code: 'WELCOME10', percent: 10, expires_at: null },
      'Code WELCOME10 added (10% off)'
    ],
    [
      'discount_code_added',
      { code: 'BF25', percent: 25, expires_at: '2026-11-30T23:59:00+00:00' },
      'Code BF25 added (25% off, until 30 Nov 2026)'
    ],
    [
      'discount_code_retired',
      { code: 'BF25', ended: true },
      'Code BF25 retired: it ended'
    ],
    [
      'discount_code_retired',
      { code: 'BF25', ended: false },
      'Code BF25 retired'
    ],
    [
      'klaviyo_connection_changed',
      { to_status: 'connected', to_mode: 'live' },
      'Klaviyo connected'
    ],
    [
      'klaviyo_connection_changed',
      { to_status: 'connected', to_mode: 'fixture' },
      'Klaviyo connected (sample data)'
    ],
    [
      'klaviyo_connection_changed',
      { to_status: 'disconnected' },
      'Klaviyo disconnected'
    ],
    [
      'klaviyo_connection_changed',
      { to_status: 'expired' },
      'Klaviyo stopped working with this key'
    ],
    [
      'klaviyo_key_saved',
      { hint: 'pk_abcde••••••••wxyz' },
      'Klaviyo key pk_abcde••••••••wxyz saved'
    ],
    [
      'klaviyo_key_refused',
      { hint: 'pk_abcde••••••••wxyz' },
      'Klaviyo refused the key pk_abcde••••••••wxyz'
    ]
  ])('%s %j', (kind, detail, sentence) => {
    expect(changeText(kind, detail)).toBe(sentence)
  })

  it('says how the email limit and segment order changed (SEG-EXP-a)', () => {
    const set = { to_window: 7, to_cap: 3, order_changed: false }
    expect(changeText('exposure_policy_changed', set)).toBe(
      'Email limit set: at most 3 marketing emails per person in 7 days'
    )
    const changed = {
      ...set,
      from_window: 7,
      from_cap: 3,
      to_window: 1,
      to_cap: 1
    }
    expect(changeText('exposure_policy_changed', changed)).toBe(
      'Email limit changed to at most 1 marketing email per person in 1 day (was 3 in 7)'
    )
    expect(
      changeText('exposure_policy_changed', { ...changed, order_changed: true })
    ).toBe(
      'Email limit changed to at most 1 marketing email per person in 1 day (was 3 in 7); Segment order changed'
    )
    const order = { from_window: 7, from_cap: 3, ...set, order_changed: true }
    expect(changeText('exposure_policy_changed', order)).toBe(
      'Segment order changed'
    )
    // Nothing readable, or nothing changed, explains nothing.
    expect(changeText('exposure_policy_changed', { to_cap: 'x' })).toBeNull()
    expect(
      changeText('exposure_policy_changed', {
        from_window: 7,
        from_cap: 3,
        ...set
      })
    ).toBeNull()
    expect(changeKinds).toContain('exposure_policy_changed')
  })

  it('gives a code’s last day in the store’s time zone', () => {
    // 23:59 on 30 Nov in Los Angeles is already 1 Dec in UTC.
    const detail = {
      code: 'BF25',
      percent: 25,
      expires_at: '2026-12-01T07:59:00Z'
    }
    expect(
      changeText('discount_code_added', detail, 'America/Los_Angeles')
    ).toBe('Code BF25 added (25% off, until 30 Nov 2026)')
    expect(changeText('discount_code_added', detail, 'UTC')).toBe(
      'Code BF25 added (25% off, until 1 Dec 2026)'
    )
    expect(changeText('discount_code_added', detail, 'Not/AZone')).toBe(
      'Code BF25 added (25% off)'
    )
  })

  it('explains nothing it cannot read', () => {
    expect(changeText('max_discount_changed', { to: 'lots' })).toBeNull()
    expect(
      changeText('revenue_goal_set', {
        month: 'soon',
        to_amount: 5,
        to_currency: 'USD'
      })
    ).toBeNull()
    expect(changeText('revenue_goal_set', { month: '2026-11-01' })).toBeNull()
    expect(changeText('margin_floor_changed', { to_floor: 30 })).toBeNull()
    expect(changeText('discount_code_added', {})).toBeNull()
    expect(
      changeText('brand_book_corrected', {
        section: 'constructor',
        action: 'add'
      })
    ).toBeNull()
    expect(
      changeText('brand_book_corrected', {
        section: 'voice',
        action: 'rewrite'
      })
    ).toBeNull()
    expect(
      changeText('brand_book_corrected', {
        section: 'facts.returnDays',
        action: 'replace',
        value: 'two weeks'
      })
    ).toBeNull()
    expect(
      changeText('klaviyo_connection_changed', { to_status: 'odd' })
    ).toBeNull()
    expect(changeText('membership_update', {})).toBeNull()
  })
})

describe('the workspace’s change history', () => {
  const rows = [
    {
      id: 'e1',
      kind: 'max_discount_changed',
      actor_id: 'p1',
      detail: { from: 20, to: 25 },
      created_at: '2026-11-14T10:00:00Z'
    },
    {
      id: 'e2',
      kind: 'klaviyo_connection_changed',
      actor_id: null,
      detail: { to_status: 'expired' },
      created_at: '2026-11-14T09:00:00Z'
    },
    {
      id: 'e3',
      kind: 'discount_code_added',
      actor_id: 'p9',
      detail: { code: 'OLD5', percent: 5 },
      created_at: '2026-11-13T09:00:00Z'
    },
    {
      id: 'e4',
      kind: 'discount_code_added',
      actor_id: 'p2',
      detail: 'not an object',
      created_at: '2026-11-12T09:00:00Z'
    }
  ]
  const members = [
    { profileId: 'p1', name: 'Raman', email: 'owner@shop.example', isMe: true },
    { profileId: 'p2', name: '', email: 'staff@shop.example', isMe: false }
  ]
  function db(answer: { data: unknown; error: unknown }) {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(async () => answer)
    }
    return { client: { from: vi.fn(() => chain) } as never, chain }
  }

  it('lists the changes newest first, with who made each', async () => {
    const { client, chain } = db({ data: rows, error: null })
    expect(await listChangeHistory(client, 'tenant-1', members)).toEqual([
      {
        id: 'e1',
        text: 'Max discount changed from 20% to 25%',
        by: 'you',
        at: '2026-11-14T10:00:00Z'
      },
      {
        id: 'e2',
        text: 'Klaviyo stopped working with this key',
        by: 'GROS',
        at: '2026-11-14T09:00:00Z'
      },
      {
        id: 'e3',
        text: 'Code OLD5 added (5% off)',
        by: 'someone',
        at: '2026-11-13T09:00:00Z'
      }
    ])
    expect(chain.eq).toHaveBeenCalledWith('tenant_id', 'tenant-1')
    expect(chain.in).toHaveBeenCalledWith('kind', [...changeKinds])
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false })
  })

  it('says it could not read the record', async () => {
    const { client } = db({ data: null, error: { code: '42501' } })
    expect(await listChangeHistory(client, 'tenant-1', members)).toBeNull()
  })

  it('reads at most 200 changes', async () => {
    const { client, chain } = db({ data: [], error: null })
    await listChangeHistory(client, 'tenant-1', members, { limit: 5000 })
    expect(chain.limit).toHaveBeenCalledWith(200)
  })
})

describe('Recent changes: the record and the team’s together (UI-SETc)', () => {
  const at = (id: string, when: string) => ({
    id,
    text: id,
    by: 'you',
    at: when
  })
  const record = [
    at('code', '2026-11-14T09:00:00Z'),
    at('max', '2026-11-12T09:00:00Z')
  ]
  const team = [at('invite', '2026-11-13T09:00:00Z')]

  it('lists both, newest first, at most the limit', () => {
    expect(mergeChanges(record, team)).toEqual({
      items: [record[0], team[0], record[1]],
      partial: false
    })
    expect(mergeChanges(record, team, 2)?.items.map((c) => c.id)).toEqual([
      'code',
      'invite'
    ])
  })

  it('says when one could not be read, and is null when neither could', () => {
    expect(mergeChanges(null, team)).toEqual({ items: team, partial: true })
    expect(mergeChanges(record, null)?.partial).toBe(true)
    expect(mergeChanges([], [])).toEqual({ items: [], partial: false })
    expect(mergeChanges(null, null)).toBeNull()
  })
})
