import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./actions', () => ({
  pinRule: vi.fn(async () => ({})),
  retireRule: vi.fn(async () => ({
    message: 'Removed. GROS no longer uses this rule.'
  }))
}))

import LearnedError from '@/app/(gros)/learned/error'
import LearnedLoading from '@/app/(gros)/learned/loading'
import type { LearnedItem, LearnedView } from './read-model'
import { LearnedScreen } from './screen'

afterEach(cleanup)

const item = (over: Partial<LearnedItem> = {}): LearnedItem => ({
  id: 'r1',
  kind: 'do',
  rule: 'Lead with one product',
  why: 'More clicks over 6 sends',
  source: 'results',
  sourceWords: 'From your results',
  at: '2026-11-10T03:00:00.000Z',
  date: '9 Nov',
  pinned: false,
  revision: 2,
  ...over
})

const view = (over: Partial<LearnedView> = {}): LearnedView => ({
  owner: true,
  do: [
    item({
      id: 'r2',
      rule: 'Show the price in the subject',
      why: '',
      pinned: true,
      sourceWords: 'From your edits',
      revision: 5
    }),
    item()
  ],
  avoid: [
    item({
      id: 'r3',
      kind: 'dont',
      rule: 'All caps subjects',
      sourceWords: 'From the email checks'
    })
  ],
  unread: false,
  week: null,
  ...over
})

const card = (name: string) => screen.getByRole('region', { name })
const hidden = (button: HTMLElement) =>
  Object.fromEntries(
    [...button.closest('form')!.querySelectorAll('input[type=hidden]')].map(
      (i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]
    )
  )

describe('Learned screen (UI-LRNb)', () => {
  it('shows a long rule in full, never cut to one line', () => {
    const rule =
      'Avoid subject lines longer than 45 characters on lists where most people read on their phones'
    render(<LearnedScreen view={view({ do: [item({ rule })], avoid: [] })} />)
    const words = within(card('Do')).getByText(rule)
    expect(words).not.toHaveClass('truncate')
    expect(words).toHaveClass('break-words')
    // Its source and date too (UI-LRNc): a phone cut them to "From yo…".
    const details = within(card('Do')).getByText('From your results · 9 Nov')
    expect(details).not.toHaveClass('truncate')
    expect(details).toHaveClass('break-words')
  })

  it('says what was learned this week in one plain sentence (#74)', () => {
    render(
      <LearnedScreen
        view={view({
          week: {
            summary: "3 new do's, 1 retired",
            dos: 3,
            donts: 0,
            retired: 1
          }
        })}
      />
    )
    const week = card('This week')
    expect(
      within(week).getByRole('heading', { name: 'This week' })
    ).toBeInTheDocument()
    expect(week).toHaveTextContent("3 new do's, 1 retired.")
    expect(week).toHaveTextContent(
      'What GROS started and stopped using in the last 7 days.'
    )
    // Above the rules, with them still shown.
    expect(card('Do')).toHaveTextContent('Lead with one product')
    expect(
      week.compareDocumentPosition(card('Do')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('shows the week with no rules in use, and no week card when it was not read (#74)', () => {
    render(
      <LearnedScreen
        view={view({
          do: [],
          avoid: [],
          week: {
            summary: 'Nothing new learned this week',
            dos: 0,
            donts: 0,
            retired: 0
          }
        })}
        assistant="Ava"
      />
    )
    expect(card('This week')).toHaveTextContent(
      'Nothing new learned this week.What Ava started'
    )
    expect(screen.getByText('No rules in use')).toBeInTheDocument()
    cleanup()
    render(<LearnedScreen view={view()} />)
    expect(screen.queryByRole('region', { name: 'This week' })).toBeNull()
  })

  it('is titled Learned, with no menu item current', () => {
    render(<LearnedScreen view={view()} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Learned' })
    ).toBeInTheDocument()
    const menu = screen.getByRole('navigation', { name: 'Main' })
    for (const link of within(menu).getAllByRole('link'))
      expect(link).not.toHaveAttribute('aria-current')
  })

  it('shows each rule with its source and date in Do and Avoid, pinned ones marked', () => {
    render(<LearnedScreen view={view()} />)
    const rules = within(card('Do')).getAllByRole('listitem')
    expect(rules).toHaveLength(2)
    expect(rules[0]).toHaveTextContent('Show the price in the subject')
    expect(rules[0]).toHaveTextContent('Pinned · From your edits · 9 Nov')
    expect(rules[1]).toHaveTextContent(
      /^Lead with one productFrom your results · 9 Nov/
    )
    expect(rules[1]).not.toHaveTextContent('Pinned')
    expect(card('Avoid')).toHaveTextContent(
      'All caps subjectsFrom the email checks · 9 Nov'
    )
  })

  it('gives the owner Pin or Unpin and Remove on each rule, saying which rule', () => {
    render(<LearnedScreen view={view()} />)
    const unpin = screen.getByRole('button', {
      name: 'Unpin: Show the price in the subject'
    })
    expect(unpin).toHaveTextContent('Unpin')
    expect(hidden(unpin)).toEqual({
      rule: 'r2',
      revision: '5',
      pinned: 'false'
    })
    const pin = screen.getByRole('button', {
      name: 'Pin: Lead with one product'
    })
    expect(hidden(pin)).toEqual({ rule: 'r1', revision: '2', pinned: 'true' })
    const remove = screen.getByRole('button', {
      name: 'Remove: All caps subjects'
    })
    expect(hidden(remove)).toEqual({ rule: 'r3', revision: '2' })
    expect(screen.getAllByRole('button', { name: /^Remove/ })).toHaveLength(3)
  })

  it('shows staff the list only', () => {
    render(<LearnedScreen view={view({ owner: false })} />)
    expect(card('Do')).toHaveTextContent('Lead with one product')
    expect(
      screen.queryByRole('button', { name: /^(Pin|Unpin|Remove)/ })
    ).toBeNull()
  })

  it('says plainly when no rule is in use, in a card or on the whole page', () => {
    render(<LearnedScreen view={view({ avoid: [] })} />)
    expect(card('Avoid')).toHaveTextContent('No Avoid rules yet.')
    cleanup()
    render(<LearnedScreen view={view({ do: [], avoid: [] })} />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'No rules in use' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Do' })).toBeNull()
    // One button: Home, where the owner plans and creates the emails.
    const main = within(screen.getByRole('main'))
    expect(main.queryByRole('button')).toBeNull()
    expect(main.getByRole('link', { name: 'Open Home' })).toHaveAttribute(
      'href',
      '/home'
    )
  })

  it('says what Remove did, and keeps saying it when the last rule goes', async () => {
    const user = userEvent.setup()
    const only = view({ do: [], avoid: [item({ id: 'r3', kind: 'dont' })] })
    const { rerender } = render(<LearnedScreen view={only} />)
    const remove = screen.getByRole('button', {
      name: 'Remove: Lead with one product'
    })
    await waitFor(() => expect(remove).toBeEnabled())
    await user.click(remove)
    const answer = await screen.findByText(
      'Removed. GROS no longer uses this rule.'
    )
    // The refreshed page has no rules: the empty state, and the answer stays.
    rerender(<LearnedScreen view={view({ do: [], avoid: [] })} />)
    expect(
      screen.getByRole('heading', { name: 'No rules in use' })
    ).toBeInTheDocument()
    expect(answer).toBeInTheDocument()
    expect(answer).toHaveTextContent('Removed. GROS no longer uses this rule.')
  })

  it('says when the rules could not be read, with Try again', () => {
    render(<LearnedScreen view={view({ do: [], avoid: [], unread: true })} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Learned did not open')
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/learned'
    )
  })
})

describe('Learned while it opens or fails to (UI-LRNc)', () => {
  it('opens on the loading page: the bar with no item current, its words, busy, and no main', () => {
    const { container } = render(<LearnedLoading />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Learned' })
    ).toBeInTheDocument()
    for (const link of within(
      screen.getByRole('navigation', { name: 'Main' })
    ).getAllByRole('link'))
      expect(link).not.toHaveAttribute('aria-current')
    expect(screen.getByText('Opening Learned')).toHaveAttribute(
      'aria-live',
      'polite'
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    // The page brings the one main while it streams in.
    expect(container.querySelector('main')).toBeNull()
  })

  it('says plainly when the page did not open, with Try again and the bar as a way out', async () => {
    const retry = vi.fn()
    render(<LearnedError retry={retry} />)
    expect(screen.getAllByRole('main')).toHaveLength(1)
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Learned did not open')
    expect(alert).toHaveTextContent('Its rules are safe.')
    expect(alert).not.toHaveTextContent(/Something went wrong|error/i)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
    // Learned is not a menu item; Home is the way out.
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
        'link',
        { name: 'Home' }
      )
    ).toHaveAttribute('href', '/home')
  })
})
