import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./actions', () => ({
  saveBrandSection: vi.fn(async () => ({})),
  redoBrandSection: vi.fn(async () => ({})),
  redoAllBrandSections: vi.fn(async () => ({}))
}))
vi.mock('@/features/brand/actions', () => ({
  brandAction: vi.fn(async () => ({}))
}))
vi.mock('@/features/onboarding/actions', () => ({
  onboardingAction: vi.fn(async () => ({}))
}))

import { BrandBookScreen } from './book-screen'
import { brandBookView } from './book-view'
import type { BrandBookPageView } from './page-model'

afterEach(cleanup)

const book = brandBookView({
  version: 5,
  written_by: 'brand-strategist@1',
  created_at: '2026-11-24T15:00:00Z',
  content: {
    sample: false,
    brand: { name: 'Cedar Lane', site: 'https://cedarlane.example' },
    facts: { returnDays: 30 },
    owner: null,
    unclear: [{ topic: 'free_shipping' }],
    observed: { offering: ['Outdoor layers made to last'] },
    products: { count: 12, bestsellers: ['Field overshirt'] },
    avoid: [],
    sources: ['site'],
    strategy: {
      positioning: 'Layers for people who are outside every weekend.',
      customers: ['Weekend walkers']
    }
  }
})

function ready(
  over: Partial<Extract<BrandBookPageView, { state: 'ready' }>> = {}
): BrandBookPageView {
  return {
    state: 'ready',
    owner: true,
    timezone: 'America/New_York',
    brand: { revision: 3, approvedRevision: null },
    book,
    ...over
  }
}
const card = (name: string) => screen.getByRole('region', { name })

describe('BrandBookScreen', () => {
  it('is a page under Brand, and sends the approval to Brand', () => {
    render(<BrandBookScreen view={ready()} />)
    expect(
      screen.getByRole('heading', { name: 'Brand book', level: 1 })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to Brand' })).toHaveAttribute(
      'href',
      '/settings/brand'
    )
    // He approves on Brand, where he sees the words he approves: this page
    // shows the book, not those fields, so it has no Approve button.
    expect(screen.queryByRole('button', { name: /^Approve/ })).toBeNull()
    const brand = card('Your brand')
    expect(brand).toHaveTextContent(
      'Version 3 waits for your approval. Approve it on Brand, where you see what you approve.'
    )
    expect(within(brand).getByText('Needs you')).toBeVisible()
    expect(
      within(brand).getByRole('link', { name: 'Review and approve' })
    ).toHaveAttribute('href', '/settings/brand#version')
    cleanup()
    render(
      <BrandBookScreen
        view={ready({ brand: { revision: 3, approvedRevision: 3 } })}
      />
    )
    expect(card('Your brand')).toHaveTextContent(
      'Approved for AI use · version 3'
    )
    expect(
      within(card('Your brand')).getByRole('link', { name: 'Open brand' })
    ).toHaveAttribute('href', '/settings/brand#version')
    expect(card('This version')).toHaveTextContent(
      'Version5Written Nov 24, 2026 · Cedar Lane · https://cedarlane.example'
    )
    expect(card('This version')).toHaveTextContent('Read from: Your website')
  })

  it('keeps the facts, what was seen and the reading apart', () => {
    render(<BrandBookScreen view={ready()} />)
    const facts = card('Confirmed facts')
    expect(within(facts).getByText('Returns within 30 days')).toBeVisible()
    // What is not clear is never among the confirmed facts.
    expect(facts).not.toHaveTextContent(/disagree|Free shipping/)
    const seen = card('What GROS saw')
    expect(seen).toHaveTextContent('never stated as a fact')
    expect(seen).toHaveTextContent(
      'Your sources disagree on these, so GROS makes no claim about them.'
    )
    expect(within(seen).getByText('Free shipping')).toBeVisible()
    // The confirmed parts come first and the reading last, as the agents
    // obey them.
    const order = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
    expect(order.indexOf('What to avoid')).toBeLessThan(
      order.indexOf('Strategist’s reading')
    )
    expect(order.indexOf('Your words')).toBeLessThan(
      order.indexOf('What GROS saw')
    )
    expect(order.at(-1)).toBe('Strategist’s reading')
    expect(
      within(card('What GROS saw')).getByText('Outdoor layers made to last')
    ).toBeVisible()
    const reading = card('Strategist’s reading')
    expect(reading).toHaveTextContent('A reading of this book, not a fact.')
    expect(
      within(reading).getByText(
        'Layers for people who are outside every weekend.'
      )
    ).toBeVisible()
    // The reading is never shown as a fact or as the owner's words.
    expect(facts).not.toHaveTextContent(/weekend/)
    expect(card('Your words')).toHaveTextContent(
      'Not in this version. Approve your brand'
    )
    expect(card('Products')).toHaveTextContent('12')
  })

  it('says the strategist has not read a book yet', () => {
    render(
      <BrandBookScreen
        view={ready({ book: { ...book!, reading: null, byStrategist: false } })}
      />
    )
    expect(card('Strategist’s reading')).toHaveTextContent('Not read yet.')
  })

  it('shows an empty state with one button when there is no book', () => {
    render(<BrandBookScreen view={ready({ book: null })} />)
    expect(
      screen.getByRole('heading', { name: 'No Brand book yet' })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open setup' })).toHaveAttribute(
      'href',
      '/setup'
    )
    expect(card('Your brand')).toBeInTheDocument()
  })

  it('gives staff the book without the approval button', () => {
    render(<BrandBookScreen view={ready({ owner: false })} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(card('Your brand')).toHaveTextContent(
      'Version 3 waits for the owner’s approval.'
    )
    expect(within(card('Your brand')).queryByText('Needs you')).toBeNull()
    expect(
      within(card('Your brand')).getByRole('link', { name: 'Open brand' })
    ).toBeVisible()
  })

  it('says plainly when the book cannot be read', () => {
    render(
      <BrandBookScreen
        view={{ state: 'error', owner: true, reason: 'Nothing was changed.' }}
      />
    )
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Brand book did not openNothing was changed.'
    )
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/settings/brand/book'
    )
  })
})
