import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BlockGallery } from './gallery'
import { blockCatalog } from './catalog'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver
})
afterEach(cleanup)

const items = blockCatalog.map((b) => ({
  ...b,
  html: `<!doctype html><p>${b.name}</p>`
}))

describe('BlockGallery', () => {
  it('shows all 20 blocks with what each is for and needs', () => {
    render(<BlockGallery items={items} brandName="Cedar Lane" />)
    const cards = screen.getAllByRole('listitem')
    expect(cards).toHaveLength(20)
    expect(
      within(cards[0]).getByRole('heading', { name: 'Logo header' })
    ).toBeVisible()
    expect(within(cards[0]).getByText('1 of 20 · header')).toBeVisible()
    expect(
      within(cards[19]).getByText(/^Needs: Nothing to write/)
    ).toBeVisible()
  })

  it('draws every block in an isolated frame, labelled as sample', () => {
    render(<BlockGallery items={items} brandName="Cedar Lane" />)
    const frame = screen.getByTitle(
      'Hero in Cedar Lane, desktop width (sample content)'
    )
    expect(frame).toHaveAttribute('sandbox', '')
    expect(frame).toHaveAttribute('width', '600')
  })

  it('switches every frame to phone width', async () => {
    render(<BlockGallery items={items} brandName="Cedar Lane" />)
    await userEvent.click(screen.getByRole('radio', { name: 'Phone · 375px' }))
    const frames = screen.getAllByTitle(/phone width \(sample content\)$/)
    expect(frames).toHaveLength(20)
    for (const f of frames) expect(f).toHaveAttribute('width', '375')
  })
})
