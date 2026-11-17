import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangesCard } from './changes-card'
import type { SettingsView } from './page-model'

afterEach(cleanup)

const change = (id: string, text: string, by: string, at: string) => ({
  id,
  text,
  by,
  at
})
const items = [
  change('e1', 'Code WELCOME15 added (15% off)', 'you', '2026-11-16T12:00:00Z'),
  change('t1', 'Sam Staff is now a Manager', 'Ana Lee', '2026-11-15T03:30:00Z'),
  change('e2', 'Klaviyo disconnected', 'GROS', '2026-11-14T09:00:00Z')
]

/** The card as Settings draws it; it reads only the changes and timezone. */
const changesCard = (
  changes: SettingsView['changes'],
  timezone = 'Asia/Kathmandu'
) => (
  <ChangesCard
    view={{ changes, timezone: { saved: timezone } } as unknown as SettingsView}
    unread={<p>Recent changes could not be read just now.</p>}
  />
)
const card = () => screen.getByRole('region', { name: 'Recent changes' })

describe('Recent changes on Settings (UI-SETc)', () => {
  it('says who changed what and when, newest first, in the brand’s timezone', () => {
    render(changesCard({ items, partial: false }))
    const rows = within(
      within(card()).getByRole('list', { name: 'Recent changes' })
    ).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      'Code WELCOME15 added (15% off)by you · Nov 16, 2026 · 5:45 PM',
      'Sam Staff is now a Managerby Ana Lee · Nov 15, 2026 · 9:15 AM',
      'Klaviyo disconnectedby GROS · Nov 14, 2026 · 2:45 PM'
    ])
    // Another timezone, other times.
    cleanup()
    render(changesCard({ items: items.slice(0, 1), partial: false }, 'UTC'))
    expect(card()).toHaveTextContent('by you · Nov 16, 2026 · 12:00 PM')
  })

  it('says when there is nothing yet, or only part could be read', () => {
    render(changesCard({ items: [], partial: false }))
    expect(card()).toHaveTextContent('No changes yet.')
    expect(within(card()).queryByRole('list')).toBeNull()
    cleanup()
    render(changesCard({ items: items.slice(2), partial: true }))
    expect(card()).toHaveTextContent('Klaviyo disconnected')
    expect(card()).toHaveTextContent(
      'Some changes could not be read just now. Open Settings again in a minute.'
    )
    expect(card()).not.toHaveTextContent('No changes yet.')
    cleanup()
    render(changesCard({ items: [], partial: true }))
    expect(card()).not.toHaveTextContent('No changes yet.')
    expect(card()).toHaveTextContent('Some changes could not be read')
  })

  it('shows only why when nothing could be read (also the demo)', () => {
    render(changesCard(null))
    expect(card()).toHaveTextContent(
      'Recent changes could not be read just now.'
    )
    expect(within(card()).queryByRole('list')).toBeNull()
  })
})
