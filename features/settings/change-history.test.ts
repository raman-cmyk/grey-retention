import { describe, expect, it, vi } from 'vitest'
import { changeKinds, changeText, listChangeHistory } from './change-history'

describe('a recorded change in plain words', () => {
  it.each([
    ['max_discount_changed', { from: null, to: 20 }, 'Max discount set to 20%'],
    [
      'max_discount_changed',
      { from: 20, to: 25 },
      'Max discount changed from 20% to 25%'
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
    expect(changeText('margin_floor_changed', { to_floor: 30 })).toBeNull()
    expect(changeText('discount_code_added', {})).toBeNull()
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
