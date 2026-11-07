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
    // Ready for the next one.
    await vi.waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
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
    await vi.waitFor(() =>
      expect(within(editForm).getByLabelText('Name')).toHaveFocus()
    )
  })

  it('saves an edit, says so, and returns to the Edit button', async () => {
    actions.saveHoliday.mockResolvedValueOnce({ message: 'Saved.' } as never)
    render(<YoursCard entries={[entry]} today="2026-11-07" owner />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit Brand anniversary' })
    )
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Brand birthday')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const sent = (actions.saveHoliday.mock.calls[0] as unknown[])[1] as FormData
    expect(sent.get('id')).toBe(entry.id)
    expect(sent.get('name')).toBe('Brand birthday')
    expect(await screen.findByText('Saved.')).toBeVisible()
    expect(screen.queryByRole('form')).toBeNull()
    await vi.waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit Brand anniversary' })
      ).toHaveFocus()
    )
  })

  it('keeps the form open on a refused edit, and opens clean next time', async () => {
    actions.saveHoliday.mockResolvedValueOnce({
      error:
        'This entry changed in another window. Reload the page to see it, then try again.'
    } as never)
    render(<YoursCard entries={[entry]} today="2026-11-07" owner />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit Brand anniversary' })
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/changed in another window/)).toBeVisible()
    expect(screen.getByRole('form')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await vi.waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Edit Brand anniversary' })
      ).toHaveFocus()
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Edit Brand anniversary' })
    )
    expect(screen.queryByText(/changed in another window/)).toBeNull()
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
    // The message is on the card, so it stays when the row goes.
    expect(await screen.findByText('Deleted.')).toBeVisible()
    await vi.waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Yours' })).toHaveFocus()
    )
  })

  it('says why a delete failed', async () => {
    actions.deleteHoliday.mockResolvedValueOnce({
      error: 'This entry was removed in another window. Reload the page.'
    } as never)
    render(<YoursCard entries={[entry]} today="2026-11-07" owner />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete Brand anniversary' })
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Delete'
      })
    )
    expect(
      await screen.findByText(
        'This entry was removed in another window. Reload the page.'
      )
    ).toBeVisible()
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
    // The categories are named, not only coloured.
    const key = screen.getByRole('list', { name: 'Key' })
    expect(key).toHaveTextContent('Public holiday')
    expect(key).toHaveTextContent('Celebration')
    expect(key).toHaveTextContent('Shopping day')
    expect(
      within(
        screen.getByRole('list', { name: 'Platform holidays' })
      ).getAllByRole('listitem')
    ).toHaveLength(2)
    expect(screen.queryByText(/Guessed/)).toBeNull()
  })

  it('keeps the chosen country after saving', async () => {
    const { rerender } = render(
      <PlatformCard
        holidays={[]}
        today="2026-11-06"
        managedBy="Grey Retention"
        country="US"
        countrySource="guess"
        owner
      />
    )
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'AU')
    await userEvent.click(screen.getByRole('button', { name: 'Save country' }))
    expect(await screen.findByText('Country saved.')).toBeVisible()
    expect(actions.setHolidayCountry).toHaveBeenCalled()
    expect(screen.getByLabelText('Country')).toHaveValue('AU')
    // The page then reloads with the saved country.
    rerender(
      <PlatformCard
        holidays={[]}
        today="2026-11-06"
        managedBy="Grey Retention"
        country="AU"
        countrySource="saved"
        owner
      />
    )
    expect(screen.getByLabelText('Country')).toHaveValue('AU')
    expect(screen.getByText('Country saved.')).toBeVisible()
  })

  it('keeps the choice and explains when saving the country fails', async () => {
    actions.setHolidayCountry.mockResolvedValueOnce({
      error: 'Choose a country from the list.'
    } as never)
    render(
      <PlatformCard
        holidays={[]}
        today="2026-11-06"
        managedBy="Grey Retention"
        country="US"
        countrySource="saved"
        owner
      />
    )
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'NZ')
    await userEvent.click(screen.getByRole('button', { name: 'Save country' }))
    expect(
      await screen.findByText('Choose a country from the list.')
    ).toBeVisible()
    expect(screen.getByLabelText('Country')).toHaveValue('NZ')
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
    expect(
      screen.getByText(
        'Guessed from your timezone: Other countries: shopping and gift days.'
      )
    ).toBeVisible()
    expect(
      screen.getByText('No platform holidays in the next 90 days.')
    ).toBeVisible()
  })

  it('does not call the country a guess when it could not be read', () => {
    render(
      <PlatformCard
        holidays={[]}
        today="2026-11-06"
        managedBy="Grey Retention"
        country="US"
        countrySource="unknown"
        owner
      />
    )
    expect(screen.queryByText(/Guessed/)).toBeNull()
  })
})
