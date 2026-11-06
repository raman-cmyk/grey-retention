import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import { deleteHoliday, saveHoliday, setHolidayCountry } from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const entry = '00000000-0000-4000-8000-000000000777'
function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
const good = {
  revision: '0',
  name: 'Brand anniversary',
  date: '2027-03-14',
  kind: 'holiday',
  repeats: 'on',
  notes: ''
}

let rpc: ReturnType<typeof vi.fn>
beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
  auth.requireRequestContext.mockResolvedValue({
    tenantId: tenant,
    tenantRole: 'owner'
  })
  rpc = vi.fn(async () => ({ data: { id: entry, revision: 1 }, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => vi.clearAllMocks())

describe('saveHoliday', () => {
  it('adds an entry for the owner’s workspace', async () => {
    expect(await saveHoliday({}, form(good))).toEqual({
      message: 'Added “Brand anniversary”.'
    })
    expect(rpc).toHaveBeenCalledWith('save_holiday', {
      t: tenant,
      holiday_id: null,
      expected_revision: 0,
      name: 'Brand anniversary',
      event_date: '2027-03-14',
      kind: 'holiday',
      repeats_annually: true,
      notes: ''
    })
  })

  it('edits an entry with its revision', async () => {
    expect(
      await saveHoliday({}, form({ ...good, id: entry, revision: '3' }))
    ).toEqual({ message: 'Saved.' })
    expect(rpc).toHaveBeenCalledWith(
      'save_holiday',
      expect.objectContaining({ holiday_id: entry, expected_revision: 3 })
    )
  })

  it('refuses staff and demo sessions before reading the form', async () => {
    auth.requireRequestContext.mockResolvedValueOnce({
      tenantId: tenant,
      tenantRole: 'staff'
    })
    const data = form(good)
    const read = vi.spyOn(data, 'get')
    expect((await saveHoliday({}, data)).error).toMatch(
      /Only the workspace owner/
    )
    expect(read).not.toHaveBeenCalled()
    env.values = { AUTH_MODE: 'demo' }
    expect((await saveHoliday({}, form(good))).error).toMatch(/sign in again/)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('refuses bad input without saving', async () => {
    expect((await saveHoliday({}, form({ ...good, name: 'X' }))).error).toBe(
      'Name: at least 2 characters.'
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains refusals in plain words', async () => {
    const cases = [
      [
        { code: 'PT409', message: 'This entry changed in another window' },
        /changed in another window/
      ],
      [
        { code: 'PT409', message: 'This entry was removed in another window' },
        /was removed/
      ],
      [{ code: '42501' }, /Only the workspace owner/],
      [{ code: '23514' }, /Check the entry/],
      [{ code: 'XX000' }, /Nothing was changed/]
    ] as const
    for (const [error, text] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect((await saveHoliday({}, form(good))).error).toMatch(text)
    }
  })
})

describe('deleteHoliday', () => {
  it('deletes with the revision the owner saw', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await deleteHoliday({}, form({ id: entry, revision: '2' }))).toEqual(
      { message: 'Deleted.' }
    )
    expect(rpc).toHaveBeenCalledWith('delete_holiday', {
      t: tenant,
      holiday_id: entry,
      expected_revision: 2
    })
  })

  it('needs an id and a revision', async () => {
    expect(
      (await deleteHoliday({}, form({ id: 'x', revision: '2' }))).error
    ).toBe('Reload the page and try again.')
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('setHolidayCountry', () => {
  it('saves a country from the list only', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await setHolidayCountry({}, form({ country: 'AU' }))).toEqual({
      message: 'Country saved.'
    })
    expect(rpc).toHaveBeenCalledWith('set_holiday_country', {
      t: tenant,
      country: 'AU'
    })
    expect((await setHolidayCountry({}, form({ country: 'FR' }))).error).toBe(
      'Choose a country from the list.'
    )
  })
})
