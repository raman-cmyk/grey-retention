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
  it('is a page under Brand, with the approval of the version shown', () => {
    render(<BrandBookScreen view={ready()} />)
    expect(
      screen.getByRole('heading', { name: 'Brand book', level: 1 })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to Brand' })).toHaveAttribute(
      'href',
      '/settings/brand'
    )
    expect(
      within(card('Brand version')).getByRole('button', {
        name: 'Approve brand v3'
      })
    ).toBeVisible()
    expect(card('This version')).toHaveTextContent(
      'Version5Written Nov 24, 2026 · Cedar Lane · https://cedarlane.example'
    )
    expect(card('This version')).toHaveTextContent('Read from: Your website')
  })

  it('keeps the facts, what was seen and the reading apart', () => {
    render(<BrandBookScreen view={ready()} />)
    const facts = card('Confirmed facts')
    expect(within(facts).getByText('Returns within 30 days')).toBeVisible()
    expect(facts).toHaveTextContent(
      'Your sources disagree on these, so GROS makes no claim about them.'
    )
    expect(within(facts).getByText('Free shipping')).toBeVisible()
    expect(card('What GROS saw')).toHaveTextContent('never stated as a fact')
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
  })

  it('gives staff the book without the approval button', () => {
    render(<BrandBookScreen view={ready({ owner: false })} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(card('Brand version')).toHaveTextContent(
      'Only the workspace owner can approve the brand.'
    )
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
