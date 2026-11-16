import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./actions', () => ({
  pinRule: vi.fn(async () => ({})),
  retireRule: vi.fn(async () => ({}))
}))

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
    expect(rules[1]).toHaveTextContent('More clicks over 6 sends')
    expect(rules[1]).toHaveTextContent(/^.*From your results · 9 Nov/)
    expect(rules[1]).not.toHaveTextContent('Pinned')
    expect(card('Avoid')).toHaveTextContent(
      'All caps subjectsMore clicks over 6 sendsFrom the email checks · 9 Nov'
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
    expect(card('Avoid')).toHaveTextContent('GROS uses no avoid rule yet.')
    cleanup()
    render(<LearnedScreen view={view({ do: [], avoid: [] })} />)
    expect(
      screen.getByRole('heading', { level: 2, name: 'No rules in use' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Do' })).toBeNull()
    expect(within(screen.getByRole('main')).queryByRole('button')).toBeNull()
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
