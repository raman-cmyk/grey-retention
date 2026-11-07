import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installDialogPolyfill } from '@/tests/helpers/dialog-polyfill'
import type { LibraryItem } from './model'
import { ReferenceLibrary } from './reference-library'

beforeAll(installDialogPolyfill)
afterEach(cleanup)

const item = (n: number, over: Partial<LibraryItem> = {}): LibraryItem => ({
  id: `e${n}`,
  tab: 'competitors',
  source: 'competitor',
  format: n % 2 ? 'design' : 'text',
  title: `Fictional email ${n}`,
  domain: n % 3 ? 'northwind.example' : 'cedar.example',
  from: n % 3 ? 'Northwind Outdoor' : 'Cedar Lane',
  at: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString(),
  preview: null,
  text: `Body ${n}`,
  sample: true,
  ...over
})
const many = (count: number) =>
  Array.from({ length: count }, (_, i) => item(i + 1))

describe('ReferenceLibrary', () => {
  it('shows the same three tabs with their counts, and empty tabs say so', async () => {
    render(
      <ReferenceLibrary
        items={[
          ...many(3),
          item(9, { tab: 'yours', source: 'import', domain: null })
        ]}
        timezone="UTC"
      />
    )
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent)
    expect(tabs).toEqual(['Competitors 3', 'Your uploads 1', 'Best picks 0'])
    await userEvent.click(screen.getByRole('tab', { name: 'Best picks 0' }))
    expect(screen.getByText('No best picks uploaded yet.')).toBeVisible()
    expect(
      screen.getByText('Reach out to your admin — they curate this library.')
    ).toBeVisible()
    // Arrow keys move between tabs.
    await userEvent.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Your uploads 1' })).toHaveFocus()
    expect(screen.getByRole('tab', { name: 'Your uploads 1' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('filters by Email Design, domain and search, with a count', async () => {
    render(<ReferenceLibrary items={many(6)} timezone="UTC" />)
    const cards = () => screen.getAllByRole('listitem')
    expect(cards()).toHaveLength(6)
    await userEvent.click(screen.getByRole('radio', { name: 'Email Design' }))
    expect(cards()).toHaveLength(3)
    expect(screen.getByText('3 emails')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'cedar.example' }))
    expect(
      screen.getByRole('button', { name: 'cedar.example' })
    ).toHaveAttribute('aria-pressed', 'true')
    expect(cards().map((c) => c.textContent)).toEqual([
      expect.stringContaining('Fictional email 3')
    ])
    await userEvent.type(
      screen.getByLabelText('Search the library'),
      'nothing like it'
    )
    expect(screen.getByText('No emails match.')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(cards()).toHaveLength(6)
  })

  it('shows 20 cards, then loads more', async () => {
    render(<ReferenceLibrary items={many(26)} timezone="UTC" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(20)
    await userEvent.click(
      screen.getByRole('button', { name: 'Load more (6 more)' })
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(26)
  })

  it('opens an in-page preview and links "Use this design" to a new draft', async () => {
    render(<ReferenceLibrary items={many(1)} timezone="UTC" />)
    const card = screen.getByRole('listitem')
    expect(
      within(card).getByRole('link', { name: /Use this design/ })
    ).toHaveAttribute('href', '/first-draft?reference=e1')
    await userEvent.click(
      within(card).getByRole('button', { name: /Open the preview/ })
    )
    const dialog = screen.getByRole('dialog', { name: 'Fictional email 1' })
    expect(within(dialog).getAllByText(/Plain-text email/)[0]).toBeVisible()
    expect(
      within(dialog).getByRole('link', { name: /Use this design/ })
    ).toBeVisible()
  })

  it('in a picker, "Use this reference" hands the item to the caller', async () => {
    const onPick = vi.fn()
    render(
      <ReferenceLibrary
        items={many(2)}
        timezone="UTC"
        mode="pick"
        onPick={onPick}
      />
    )
    expect(screen.queryByRole('link', { name: /Use this design/ })).toBeNull()
    await userEvent.click(
      screen.getAllByRole('button', { name: /Use this reference/ })[0]!
    )
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'e2' }))
  })
})
