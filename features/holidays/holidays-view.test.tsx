import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installDialogPolyfill } from '@/tests/helpers/dialog-polyfill'

const actions = vi.hoisted(() => ({
  saveHoliday: vi.fn(async () => ({ message: 'Added “Summer drop”.' })),
  deleteHoliday: vi.fn(async () => ({ message: 'Deleted.' })),
  setHolidayCountry: vi.fn(async () => ({ message: 'Country saved.' }))
}))
vi.mock('./actions', () => actions)

import { AddEntryCard, PlatformCard, YoursCard } from './holidays-view'
import type { OwnEntry } from './entries'

installDialogPolyfill()
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const entry: OwnEntry = {
  id: '00000000-0000-4000-8000-000000000777',
  name: 'Brand anniversary',
  date: '2020-03-14',
  nextDate: '2027-03-14',
  kind: 'holiday',
  repeatsAnnually: true,
  notes: 'Our biggest drop of the year.',
  revision: 2
}

describe('AddEntryCard', () => {
  it('has the old app’s fields and clears after a successful add', async () => {
    render(<AddEntryCard />)
    expect(screen.getByLabelText('Name')).toHaveAttribute(
      'placeholder',
      'e.g. Brand anniversary, Summer drop'
    )
    expect(screen.getByLabelText('Type')).toHaveValue('holiday')
    expect(
      screen.getByRole('checkbox', { name: 'Repeats annually (same date)' })
    ).not.toBeChecked()
    expect(
      screen.getByLabelText('Notes for the AI strategist (optional)')
    ).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Name'), 'Summer drop')
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    expect(await screen.findByText('Added “Summer drop”.')).toBeVisible()
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('keeps what was typed when the add is refused', async () => {
    actions.saveHoliday.mockResolvedValueOnce({
      error: 'Choose a date.'
    } as never)
    render(<AddEntryCard />)
    await userEvent.type(screen.getByLabelText('Name'), 'Summer drop')
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }))
    expect(await screen.findByText('Choose a date.')).toBeVisible()
    expect(screen.getByLabelText('Name')).toHaveValue('Summer drop')
  })
})

describe('YoursCard', () => {
  it('shows the empty state from the old app', () => {
    render(<YoursCard entries={[]} today="2026-11-07" owner />)
    expect(screen.getByText('0 total')).toBeVisible()
    expect(
      screen.getByText('Nothing yet — add your first on the left.')
    ).toBeVisible()
  })

  it('lists entries with their next date, type and yearly mark', () => {
    render(<YoursCard entries={[entry]} today="2026-11-07" owner />)
    const row = screen.getByText('Brand anniversary').closest('li')!
    expect(within(row).getByText('Mar 14, 2027')).toBeVisible()
    expect(within(row).getByText('Holiday')).toBeVisible()
    expect(within(row).getByText('Every year')).toBeVisible()
    expect(within(row).getByText('Our biggest drop of the year.')).toBeVisible()
  })

  it('edits inline with the entry’s revision', async () => {
    render(<YoursCard entries={[entry]} today="2026-11-07" owner />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit Brand anniversary' })
    )
    const editForm = screen.getByRole('form', {
      name: 'Edit Brand anniversary'
    })
    const data = new FormData(editForm as HTMLFormElement)
    expect(data.get('id')).toBe(entry.id)
    expect(data.get('revision')).toBe('2')
    expect(within(editForm).getByLabelText('Name')).toHaveValue(
      'Brand anniversary'
    )
    expect(within(editForm).getByLabelText('Date')).toHaveValue('2020-03-14')
  })

  it('asks before deleting, and deletes on Yes', async () => {
    render(<YoursCard entries={[entry]} today="2026-11-07" owner />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete Brand anniversary' })
    )
    const dialog = screen.getByRole('alertdialog')
    expect(
      within(dialog).getByText('Delete “Brand anniversary”?')
    ).toBeVisible()
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete' })
    )
    await vi.waitFor(() => expect(actions.deleteHoliday).toHaveBeenCalled())
    const sent = (
      actions.deleteHoliday.mock.calls[0] as unknown[]
    )[1] as FormData
    expect(sent.get('id')).toBe(entry.id)
    expect(sent.get('revision')).toBe('2')
  })

  it('is read-only for staff', () => {
    render(<YoursCard entries={[entry]} today="2026-11-07" owner={false} />)
    expect(screen.queryByRole('button', { name: /Edit|Delete/ })).toBeNull()
  })
})

describe('PlatformCard', () => {
  const holidays = [
    { date: '2026-11-11', name: 'Veterans Day', category: 'civic' as const },
    {
      date: '2026-11-27',
      name: 'Black Friday',
      category: 'commercial' as const
    }
  ]
  it('shows dated chips and who manages the list (white-label)', () => {
    render(
      <PlatformCard
        holidays={holidays}
        today="2026-11-06"
        managedBy="Northwind Retention"
        country="US"
        countrySource="saved"
        owner
      />
    )
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Platform holidays & events · next 90 days · managed by Northwind Retention'
    )
    const chip = screen.getByText('Veterans Day').closest('li')!
    expect(within(chip).getByText('Nov 11')).toBeVisible()
    expect(within(chip).getByText('(Public holiday)')).toBeInTheDocument()
    expect(screen.getByLabelText('Country')).toHaveValue('US')
  })

  it('says when the country is a guess, and only the owner can change it', () => {
    render(
      <PlatformCard
        holidays={[]}
        today="2026-11-06"
        managedBy="Grey Retention"
        country="INTL"
        countrySource="guess"
        owner={false}
      />
    )
    expect(screen.queryByLabelText('Country')).toBeNull()
    expect(screen.getByText(/Guessed from your timezone/)).toBeVisible()
    expect(
      screen.getByText('No platform holidays in the next 90 days.')
    ).toBeVisible()
  })
})
