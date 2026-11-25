import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./book-actions', () => ({
  correctBrandBookLine: vi.fn(async () => ({ message: 'Saved.' })),
  correctBrandBookFacts: vi.fn(async () => ({ message: 'Facts saved.' })),
  withdrawBrandBookCorrection: vi.fn(async () => ({ message: 'Taken back.' })),
  retryBrandBookRewrite: vi.fn(async () => ({ message: 'Rewriting.' }))
}))
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

import {
  correctBrandBookFacts,
  correctBrandBookLine,
  retryBrandBookRewrite,
  withdrawBrandBookCorrection
} from './book-actions'
import { BrandBookScreen } from './book-screen'
import { brandBookView } from './book-view'
import type { BrandBookPageView } from './page-model'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

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
    rewrite: null,
    ...over
  }
}
const formOf = (el: HTMLElement) =>
  Object.fromEntries(
    new FormData(el.closest('form')!) as unknown as [string, string][]
  )
const card = (name: string) => screen.getByRole('region', { name })

describe('BrandBookScreen', () => {
  it('is a page under Brand, and sends the approval to Brand', () => {
    render(<BrandBookScreen view={ready()} />)
    expect(
      screen.getByRole('heading', { name: 'Brand book', level: 1 })
    ).toBeVisible()
    // UI-BRAND-2: under Brand, a main page.
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
        'link',
        { name: 'Brand' }
      )
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Back to Brand' })).toHaveAttribute(
      'href',
      '/brand'
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
    ).toHaveAttribute('href', '/brand#version')
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
    ).toHaveAttribute('href', '/brand#version')
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
      'Not in this version. Approve your brand, and GROS rewrites the book with your words right away.'
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
    // (UI-BRAND-2 tests follow this one.)
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
      '/brand/book'
    )
  })
})

/** UI-BRAND-2: the owner types corrections straight into the Brand book. */
describe('BrandBookScreen corrections', () => {
  const owned = brandBookView(
    {
      version: 6,
      written_by: 'brand-book@2',
      created_at: '2026-11-25T10:00:00Z',
      content: {
        facts: { returnDays: 14, freeShipping: { over: 75 } },
        brand: { currency: 'USD' },
        observed: {
          offering: ['Outdoor layers made to last'],
          voice: ['Calm and plain']
        }
      }
    },
    [
      {
        id: '00000000-0000-4000-8000-0000000000c1',
        section: 'voice',
        original: 'Loud and bold',
        action: 'replace',
        value: 'Calm and plain',
        createdAt: '2026-11-25T09:00:00Z'
      },
      {
        id: '00000000-0000-4000-8000-0000000000c2',
        section: 'facts.returnDays',
        original: null,
        action: 'replace',
        value: '14',
        createdAt: '2026-11-25T09:00:00Z'
      }
    ],
    { allParts: true }
  )

  it('marks the owner’s own lines and lists his corrections', () => {
    render(<BrandBookScreen view={ready({ book: owned })} />)
    const seen = card('What GROS saw')
    const voice = within(seen).getByRole('list', { name: 'How you sound' })
    expect(voice).toHaveTextContent('Calm and plainYour correction')
    expect(
      within(seen).getByRole('list', { name: 'What you sell' })
    ).not.toHaveTextContent('Your correction')
    expect(
      within(card('Confirmed facts')).getByRole('list', {
        name: 'Confirmed facts'
      })
    ).toHaveTextContent('Returns within 14 daysYour correction')
    const mine = card('Your corrections')
    expect(mine).toHaveTextContent(
      'Your own word. It comes before what GROS saw and before the strategist’s reading.'
    )
    expect(mine).toHaveTextContent(
      'How you soundChanged “Loud and bold” to “Calm and plain”'
    )
    // The order the agents obey: his corrections before what was seen,
    // the strategist's reading last.
    const order = screen
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent)
    expect(order.indexOf('Your corrections')).toBeLessThan(
      order.indexOf('What GROS saw')
    )
    expect(order.at(-1)).toBe('Strategist’s reading')
  })

  it('lets the owner change a line, sending the version shown', async () => {
    render(<BrandBookScreen view={ready({ book: owned })} />)
    const seen = card('What GROS saw')
    await userEvent.click(
      within(seen).getByRole('button', {
        name: 'Correct: Outdoor layers made to last'
      })
    )
    const field = within(seen).getByLabelText('Correct this line')
    expect(field).toHaveValue('Outdoor layers made to last')
    await userEvent.clear(field)
    await userEvent.type(field, 'Linen layers made in Porto')
    const save = within(seen).getByRole('button', { name: /^Save line/ })
    expect(formOf(save)).toEqual({
      version: '6',
      section: 'offering',
      original: 'Outdoor layers made to last',
      action: 'replace',
      value: 'Linen layers made in Porto'
    })
    // One editor at a time: opening another closes this one, so the card
    // never has two main buttons.
    await userEvent.click(
      within(seen).getByRole('button', { name: 'Correct: Calm and plain' })
    )
    expect(within(seen).getAllByLabelText('Correct this line')).toHaveLength(1)
    expect(within(seen).getByLabelText('Correct this line')).toHaveValue(
      'Calm and plain'
    )
    await userEvent.click(
      within(seen).getByRole('button', {
        name: 'Correct: Outdoor layers made to last'
      })
    )
    await userEvent.clear(within(seen).getByLabelText('Correct this line'))
    await userEvent.type(
      within(seen).getByLabelText('Correct this line'),
      'Linen layers made in Porto'
    )
    await userEvent.click(
      within(seen).getByRole('button', { name: /^Save line/ })
    )
    expect(vi.mocked(correctBrandBookLine)).toHaveBeenCalledOnce()
    expect(await within(seen).findByText('Saved.')).toBeVisible()
    // Saved: the editor closes.
    expect(within(seen).queryByLabelText('Correct this line')).toBeNull()
  })

  it('keeps the editor open when the correction is refused', async () => {
    vi.mocked(correctBrandBookLine).mockResolvedValueOnce({
      error:
        'Your Brand book changed since you opened it. Open it again, then correct it.'
    })
    render(<BrandBookScreen view={ready({ book: owned })} />)
    const seen = card('What GROS saw')
    await userEvent.click(
      within(seen).getByRole('button', { name: 'Correct: Calm and plain' })
    )
    await userEvent.click(
      within(seen).getByRole('button', { name: /^Save line/ })
    )
    expect(
      await within(seen).findByText(
        'Your Brand book changed since you opened it. Open it again, then correct it.'
      )
    ).toBeVisible()
    expect(within(seen).getByLabelText('Correct this line')).toBeVisible()
  })

  it('lets the owner remove a line, add one to an empty part and correct the facts', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<BrandBookScreen view={ready({ book: owned })} />)
    const seen = card('What GROS saw')
    await userEvent.click(
      within(seen).getByRole('button', { name: 'Correct: Calm and plain' })
    )
    const remove = within(seen).getByRole('button', { name: /^Remove line/ })
    expect(formOf(remove)).toEqual({
      version: '6',
      section: 'voice',
      original: 'Calm and plain',
      action: 'remove'
    })
    await userEvent.click(within(seen).getByRole('button', { name: 'Cancel' }))
    // An empty part, so he can add the first line.
    expect(
      within(seen).getAllByText('Nothing seen yet').length
    ).toBeGreaterThan(0)
    await userEvent.click(
      within(seen).getByRole('button', {
        name: 'Add a line: What customers love'
      })
    )
    const add = within(seen).getByRole('button', { name: /^Add line/ })
    await userEvent.type(
      within(seen).getByLabelText('New line: What customers love'),
      'The soft linen'
    )
    expect(formOf(add)).toEqual({
      version: '6',
      section: 'customers.love',
      action: 'add',
      value: 'The soft linen'
    })
    const facts = card('Confirmed facts')
    await userEvent.click(
      within(facts).getByRole('button', { name: 'Correct facts' })
    )
    expect(within(facts).getByLabelText('Returns')).toHaveValue('14')
    expect(within(facts).getByLabelText('Free shipping')).toHaveValue('over 75')
    expect(within(facts).getByLabelText('Money-back guarantee')).toHaveValue('')
    await userEvent.type(
      within(facts).getByLabelText('Delivery time'),
      '3 to 7'
    )
    const save = within(facts).getByRole('button', { name: 'Save facts' })
    expect(formOf(save)).toMatchObject({
      version: '6',
      deliveryDays: '3 to 7',
      was_deliveryDays: '',
      returnDays: '14',
      was_returnDays: '14'
    })
    await userEvent.click(save)
    expect(vi.mocked(correctBrandBookFacts)).toHaveBeenCalledOnce()
  })

  it('lets the owner take a correction back', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<BrandBookScreen view={ready({ book: owned })} />)
    const back = within(card('Your corrections')).getByRole('button', {
      name: 'Take back: How you sound: Changed “Loud and bold” to “Calm and plain”'
    })
    expect(formOf(back)).toEqual({
      version: '6',
      correction: '00000000-0000-4000-8000-0000000000c1'
    })
    await userEvent.click(back)
    expect(vi.mocked(withdrawBrandBookCorrection)).toHaveBeenCalledOnce()
  })

  it('gives staff the corrections to read, with no button', () => {
    render(<BrandBookScreen view={ready({ book: owned, owner: false })} />)
    expect(card('Your corrections')).toHaveTextContent('Returns within 14 days')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says the book is being rewritten and holds the corrections meanwhile', () => {
    render(
      <BrandBookScreen view={ready({ book: owned, rewrite: 'writing' })} />
    )
    const rewrite = card('Rewriting the Brand book')
    expect(
      within(rewrite).getByRole('heading', { name: 'Rewriting the Brand book' })
    ).toBeVisible()
    expect(rewrite).toHaveTextContent('Writing the new Brand book')
    expect(within(rewrite).getByRole('progressbar')).toHaveAttribute(
      'aria-valuenow',
      '1'
    )
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    render(<BrandBookScreen view={ready({ book: null, rewrite: 'waiting' })} />)
    // The first book: the rewrite instead of the empty state.
    expect(card('Rewriting the Brand book')).toHaveTextContent(
      'Starting the rewrite'
    )
    expect(
      screen.queryByRole('heading', { name: 'No Brand book yet' })
    ).toBeNull()
  })

  it('says when the rewrite failed, with Try again for the owner only', async () => {
    render(<BrandBookScreen view={ready({ book: owned, rewrite: 'failed' })} />)
    const rewrite = card('Rewriting the Brand book')
    expect(within(rewrite).getByRole('alert')).toHaveTextContent(
      'The Brand book was not rewrittenYour brand and its corrections are saved. Try again.'
    )
    await userEvent.click(
      within(rewrite).getByRole('button', { name: 'Try again' })
    )
    expect(vi.mocked(retryBrandBookRewrite)).toHaveBeenCalledOnce()
    // Not working: the owner can still correct.
    expect(
      within(card('What GROS saw')).getAllByRole('button', {
        name: /^Correct:/
      }).length
    ).toBeGreaterThan(0)
    cleanup()
    render(
      <BrandBookScreen
        view={ready({ book: owned, rewrite: 'stuck', owner: false })}
      />
    )
    expect(card('Rewriting the Brand book')).toHaveTextContent(
      'The rewrite did not finishYour brand and its corrections are saved. Ask the owner to try again.'
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})
