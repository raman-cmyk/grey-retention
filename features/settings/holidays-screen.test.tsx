import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const actions = vi.hoisted(() => ({
  saveHoliday: vi.fn(async () => ({})),
  deleteHoliday: vi.fn(async () => ({})),
  setHolidayCountry: vi.fn(async () => ({}))
}))
vi.mock('@/features/holidays/actions', () => actions)

import type { HolidaysPage } from '@/features/holidays/data'
import type { OwnEntry } from '@/features/holidays/entries'
import { editingEntry, HolidaysScreen } from './holidays-screen'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const drop: OwnEntry = {
  id: '00000000-0000-4000-8000-0000000000d1',
  name: 'Summer drop',
  date: '2025-11-20',
  nextDate: '2026-11-20',
  kind: 'event',
  repeatsAnnually: true,
  notes: 'Tease it a week early.',
  revision: 3
}
const closed: OwnEntry = {
  ...drop,
  id: '00000000-0000-4000-8000-0000000000d2',
  name: 'Shop closed',
  date: '2026-11-01',
  nextDate: '2026-11-01',
  kind: 'holiday',
  repeatsAnnually: false,
  notes: '',
  revision: 1
}
const page = (over: Partial<HolidaysPage> = {}): HolidaysPage => ({
  today: '2026-11-17',
  managedBy: 'Grey Retention',
  country: 'AU',
  countrySource: 'guess',
  platform: [
    { date: '2026-11-27', name: 'Black Friday', category: 'commercial' },
    { date: '2026-12-25', name: 'Christmas Day', category: 'civic' }
  ],
  own: [drop, closed],
  state: 'ready',
  ...over
})
const card = (name: string) => screen.getByRole('region', { name })
const fieldsOf = (button: HTMLElement) =>
  Object.fromEntries(
    new FormData(button.closest('form')!) as unknown as [string, string][]
  )

describe('Holidays and events under Settings (UI-SETd)', () => {
  it('lists the owner’s dates with Edit and Delete for each', () => {
    render(<HolidaysScreen page={page()} owner editing={null} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Holidays and events' })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(
      screen.getByRole('link', { name: 'Back to Settings' })
    ).toHaveAttribute('href', '/settings')
    const rows = within(card('Your dates')).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent(
      'Summer dropNov 20 · Event · Every year · Tease it a week early.'
    )
    expect(rows[1]).toHaveTextContent('Shop closedNov 1 · Holiday · Past')
    expect(
      within(rows[0]!).getByRole('link', { name: 'Edit: Summer drop' })
    ).toHaveAttribute('href', `/settings/holidays?edit=${drop.id}`)
    expect(
      fieldsOf(
        within(rows[0]!).getByRole('button', { name: 'Delete: Summer drop' })
      )
    ).toEqual({ id: drop.id, revision: '3' })
  })

  it('adds a date with every field, and edits one with its own values', () => {
    render(<HolidaysScreen page={page()} owner editing={null} />)
    const add = within(card('Add a date')).getByRole('button', {
      name: 'Add date'
    })
    expect(add.className).toContain('bg-[var(--forest)]')
    expect(fieldsOf(add)).toEqual({
      id: '',
      revision: '0',
      name: '',
      date: '',
      kind: 'event',
      notes: ''
    })
    expect(
      within(card('Add a date')).getByRole('checkbox', { name: 'Every year' })
    ).not.toBeChecked()
    expect(
      within(card('Add a date')).getByLabelText('Notes for GROS (optional)')
    ).toBeVisible()
    cleanup()
    render(<HolidaysScreen page={page()} owner editing={drop} />)
    const edit = card('Edit Summer drop')
    expect(
      fieldsOf(within(edit).getByRole('button', { name: 'Save date' }))
    ).toEqual({
      id: drop.id,
      revision: '3',
      name: 'Summer drop',
      date: '2025-11-20',
      kind: 'event',
      repeats: 'on',
      notes: 'Tease it a week early.'
    })
    expect(
      within(edit).getByRole('link', { name: 'Stop editing' })
    ).toHaveAttribute('href', '/settings/holidays?from=edit')
  })

  it('leaves no Saved. behind after Stop editing, and puts the cursor in Name', async () => {
    const user = userEvent.setup()
    actions.saveHoliday.mockResolvedValueOnce({ message: 'Saved.' })
    const { rerender } = render(
      <HolidaysScreen page={page()} owner editing={drop} />
    )
    await user.click(screen.getByRole('button', { name: 'Save date' }))
    await waitFor(() =>
      expect(card('Edit Summer drop')).toHaveTextContent('Saved.')
    )
    // Stop editing opens the page with ?from=edit.
    rerender(<HolidaysScreen page={page()} owner editing={null} focusAdd />)
    expect(card('Add a date')).not.toHaveTextContent('Saved.')
    expect(within(card('Add a date')).getByLabelText('Name')).toHaveFocus()
    // Opening the page any other way leaves the cursor alone.
    cleanup()
    render(<HolidaysScreen page={page()} owner editing={null} />)
    expect(within(card('Add a date')).getByLabelText('Name')).not.toHaveFocus()
  })

  it('asks before Delete: No sends nothing', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<HolidaysScreen page={page()} owner editing={null} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete: Summer drop' })
    )
    expect(ask).toHaveBeenCalledWith(
      'Delete “Summer drop”? The plan stops using it.'
    )
    expect(actions.deleteHoliday).not.toHaveBeenCalled()
  })

  it('shows the country’s holidays, and lets only the owner change the country', () => {
    render(<HolidaysScreen page={page()} owner editing={null} />)
    const platform = card('Holidays in the plan')
    expect(platform).toHaveTextContent(
      'Australia · Guessed from your timezone · The next 90 days, kept up to date by Grey Retention'
    )
    expect(within(platform).getAllByRole('listitem')[0]).toHaveTextContent(
      'Black FridayNov 27 · Shopping day'
    )
    expect(
      fieldsOf(within(platform).getByRole('button', { name: 'Save country' }))
    ).toEqual({ country: 'AU' })
    cleanup()
    render(
      <HolidaysScreen
        page={page({ countrySource: 'saved', platform: [] })}
        owner
        editing={null}
      />
    )
    expect(card('Holidays in the plan')).not.toHaveTextContent('Guessed')
    expect(card('Holidays in the plan')).toHaveTextContent(
      'No holidays in the next 90 days.'
    )
  })

  it('shows staff the dates and holidays with no buttons and no form', () => {
    render(<HolidaysScreen page={page()} owner={false} editing={null} />)
    expect(within(card('Your dates')).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByRole('region', { name: 'Add a date' })).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('link', { name: /^Edit/ })).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(card('Holidays in the plan')).toHaveTextContent('Black Friday')
  })

  it('says why the dates are missing, and still shows the holidays', () => {
    for (const [state, words] of [
      ['demo', 'Your own dates are not kept in the demo.'],
      ['load_failed', 'Your dates could not be read just now.'],
      ['missing_table', 'Your dates need a database update.']
    ] as const) {
      render(
        <HolidaysScreen
          page={page({ state, own: null })}
          owner
          editing={null}
        />
      )
      expect(card('Your dates')).toHaveTextContent(words)
      expect(screen.queryByRole('region', { name: 'Add a date' })).toBeNull()
      expect(card('Holidays in the plan')).toHaveTextContent('Black Friday')
      cleanup()
    }
    render(<HolidaysScreen page={page({ own: [] })} owner editing={null} />)
    expect(card('Your dates')).toHaveTextContent('No dates yet.')
  })

  it('opens only the owner’s own date for editing', () => {
    expect(editingEntry([drop, closed], true, drop.id)).toBe(drop)
    expect(editingEntry([drop], false, drop.id)).toBeNull()
    expect(editingEntry([drop], true, 'someone-else')).toBeNull()
    expect(editingEntry([drop], true, [drop.id, drop.id])).toBeNull()
    expect(editingEntry(null, true, drop.id)).toBeNull()
    expect(editingEntry([drop], true, undefined)).toBeNull()
  })
})
