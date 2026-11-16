import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/font/google', () => ({
  Urbanist: () => ({ variable: 'urbanist-variable' })
}))
vi.mock('@/features/strategy/actions', () => ({
  startPlan: vi.fn(async () => ({}))
}))
vi.mock('@/features/email-build/actions', () => ({
  createEmail: vi.fn(async () => ({}))
}))

import { addDays, type HomeSlot, type HomeView } from './read-model'
import { dayWords, HomeScreen, money, timeWords } from './screen'

afterEach(cleanup)

const slot = (over: Partial<HomeSlot>): HomeSlot => ({
  slot: 0,
  date: '2026-11-20',
  time: '18:00',
  title: 'The fall edit',
  audience: 'Past buyers',
  format: 'designed',
  status: 'planned',
  stepWords: null,
  reason: null,
  buildId: null,
  passed: false,
  canCreate: true,
  ...over
})

const days = (states: ('none' | 'planned' | 'in_klaviyo')[] = []) =>
  Array.from({ length: 15 }, (_, i) => ({
    date: addDays('2026-11-16', i),
    state: states[i] ?? 'none',
    buildId: states[i] === 'in_klaviyo' ? `build-${i}` : null
  }))

function view(over: Partial<HomeView> = {}): HomeView {
  return {
    greeting: 'Good morning, Cedar Lane',
    owner: true,
    plan: {
      state: 'planned',
      runId: 'run-1',
      reason: null,
      outOfDate: false,
      ended: false,
      start: '2026-11-16',
      days: days(['in_klaviyo', 'none', 'none', 'none', 'planned']),
      next: [
        slot({ slot: 1, title: 'The fall edit' }),
        slot({
          slot: 2,
          date: '2026-11-22',
          time: '09:30',
          title: 'A note from us',
          format: 'text'
        }),
        slot({
          slot: 3,
          title: 'Back in stock',
          status: 'working',
          stepWords: 'Designing',
          buildId: 'build-3',
          canCreate: false
        })
      ]
    },
    numbers: {
      emails: 2,
      revenue: 1200,
      revenueEmails: 1,
      opens: 700,
      clicks: 60,
      currency: 'USD',
      complete: false,
      sample: false
    },
    offers: { maxDiscountPercent: 20, activeCodes: 1 },
    learned: [
      {
        id: 'r1',
        kind: 'do',
        rule: 'Lead with one product',
        source: 'results',
        at: '2026-11-10T00:00:00Z'
      },
      {
        id: 'r2',
        kind: 'dont',
        rule: 'All caps subjects',
        source: 'inspector',
        at: '2026-11-10T00:00:00Z'
      }
    ],
    unread: [],
    ...over
  }
}

const card = (name: string) => screen.getByRole('region', { name })

describe('Home screen (UI-HOMEb)', () => {
  it('greets the store on the GROS page, with Home current', () => {
    render(<HomeScreen view={view()} />)
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Good morning, Cedar Lane'
      })
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Main' })).getByRole(
        'link',
        { name: 'Home' }
      )
    ).toHaveAttribute('aria-current', 'page')
  })

  it('shows 30 days of numbers, and says when revenue is partial', () => {
    render(<HomeScreen view={view()} />)
    const numbers = card('Email revenue, last 30 days')
    expect(numbers).toHaveTextContent('$1,200')
    expect(numbers).toHaveTextContent('From 1 of 2 emails so far')
    for (const [label, value] of [
      ['Emails', '2'],
      ['Opens', '700'],
      ['Clicks', '60']
    ])
      expect(within(numbers).getByText(label).parentElement).toHaveTextContent(
        `${label}${value}`
      )
    cleanup()
    render(<HomeScreen view={view({ numbers: null })} />)
    expect(card('Email revenue, last 30 days')).toHaveTextContent(
      'No emails sent yet'
    )
    cleanup()
    render(<HomeScreen view={view({ numbers: null, unread: ['numbers'] })} />)
    expect(card('Email revenue, last 30 days')).toHaveTextContent(
      'The numbers could not be read.'
    )
  })

  it('opens the 15 days and lists the next emails, with Create email on the one that is next', () => {
    render(<HomeScreen view={view()} />)
    const plan = card('Your next 15 days')
    const strip = within(plan).getByRole('list', {
      name: 'November 16 to November 30'
    })
    expect(
      within(strip).getByRole('link', {
        name: 'Monday, November 16: In Klaviyo'
      })
    ).toHaveAttribute('href', '/plan/email/build-0')
    expect(
      within(strip).getByRole('link', { name: 'Friday, November 20: Planned' })
    ).toHaveAttribute('href', '/plan')
    expect(within(plan).getByRole('link', { name: 'Open plan' })).toBeVisible()
    expect(
      within(plan).queryByRole('button', { name: 'Plan next 15 days' })
    ).toBeNull()

    const rows = within(card('Next emails')).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.className).toContain('bg-[var(--lime-soft)]')
    expect(rows[0]).toHaveTextContent('Fri 20, 6:00 pm · Past buyers')
    const create = within(rows[0]!).getByRole('button', {
      name: 'Create email'
    })
    const form = create.closest('form')!
    expect(
      Object.fromEntries(new FormData(form) as unknown as [string, string][])
    ).toEqual({ run: 'run-1', slot: '1' })
    expect(create.className).toContain('bg-[var(--forest)]')
    // Other rows that can be made get an outline button; one being made, its step.
    expect(
      within(rows[1]!).getByRole('button', { name: 'Create email' }).className
    ).toContain('gros-button-outline')
    expect(rows[1]).toHaveTextContent('Sun 22, 9:30 am')
    expect(within(rows[2]!).getByText('Designing')).toBeInTheDocument()
  })

  it('offers Plan next 15 days with no plan, a failed one or one that is over', () => {
    render(
      <HomeScreen
        view={view({
          plan: { ...view().plan!, state: 'none', runId: null, next: [] }
        })}
      />
    )
    expect(
      within(card('Your next 15 days')).getByRole('button', {
        name: 'Plan next 15 days'
      })
    ).toBeInTheDocument()
    expect(card('Next emails')).toHaveTextContent('No emails planned yet.')
    cleanup()
    render(
      <HomeScreen
        view={view({
          plan: {
            ...view().plan!,
            state: 'failed',
            reason: 'Add a product first.',
            next: []
          }
        })}
      />
    )
    const failed = card('Your next 15 days')
    expect(failed).toHaveTextContent('Add a product first.')
    expect(
      within(failed).getByRole('button', { name: 'Plan next 15 days' })
    ).toBeInTheDocument()
    cleanup()
    render(
      <HomeScreen view={view({ plan: { ...view().plan!, ended: true } })} />
    )
    expect(card('Your next 15 days')).toHaveTextContent(
      'These 15 days are over.'
    )
    cleanup()
    render(<HomeScreen view={view({ plan: null, unread: ['plan'] })} />)
    expect(card('Your next 15 days')).toHaveTextContent(
      'The plan could not be read.'
    )
  })

  it('shows staff the same plan, without the owner’s buttons', () => {
    render(
      <HomeScreen
        view={view({
          owner: false,
          plan: {
            ...view().plan!,
            next: view().plan!.next.map((s) => ({ ...s, canCreate: false }))
          }
        })}
      />
    )
    expect(
      screen.queryByRole('button', { name: /Create email|Plan next/ })
    ).toBeNull()
    expect(within(card('Next emails')).getAllByText('Planned')).toHaveLength(2)
    expect(
      within(card('Max discount')).queryByRole('link', { name: 'Change' })
    ).toBeNull()
  })

  it('names what GROS learned, and the offers', () => {
    render(<HomeScreen view={view()} />)
    const learned = card('What GROS learned')
    expect(learned).toHaveTextContent('DoLead with one product')
    expect(learned).toHaveTextContent('AvoidAll caps subjects')
    const offers = card('Max discount')
    expect(offers).toHaveTextContent('20%')
    expect(offers).toHaveTextContent('1 code running')
    expect(
      within(offers).getByRole('link', { name: 'Change' })
    ).toHaveAttribute('href', '/settings')
    cleanup()
    render(
      <HomeScreen
        view={view({
          learned: [],
          offers: { maxDiscountPercent: null, activeCodes: 0 }
        })}
      />
    )
    expect(card('What GROS learned')).toHaveTextContent('Nothing yet.')
    expect(
      within(card('Max discount')).getByRole('link', {
        name: 'Set max discount'
      })
    ).toBeInTheDocument()
    cleanup()
    render(
      <HomeScreen
        view={view({ offers: null, unread: ['offers', 'learned'] })}
      />
    )
    expect(card('Max discount')).toHaveTextContent(
      'The offers could not be read just now.'
    )
    expect(card('What GROS learned')).toHaveTextContent(
      'could not be read just now'
    )
  })

  it('writes days, times and money for the owner', () => {
    expect(dayWords('2026-11-20')).toBe('Fri 20')
    expect(timeWords('18:00')).toBe('6:00 pm')
    expect(timeWords('00:05')).toBe('12:05 am')
    expect(timeWords('12:00')).toBe('12:00 pm')
    expect(money(1200.4, 'USD')).toBe('$1,200')
    expect(money(950, 'EUR')).toBe('€950')
    expect(money(950, null)).toBe('950')
  })
})
