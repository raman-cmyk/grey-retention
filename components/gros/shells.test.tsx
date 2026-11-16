import { cleanup, render, screen, within } from '@testing-library/react'
import type { Route } from 'next'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/font/google', () => ({
  Urbanist: () => ({ variable: 'urbanist-variable' })
}))
import { Button } from './button'
import { DayStrip, planDates } from './day-strip'
import { EmailThumb, ListRow, RowList, TextThumb } from './list-row'
import { AppPage, TopBar } from './nav'
import { Progress } from './progress'
import { Status } from './status'
import { FocusShell, StepCards, onboardingSteps } from './steps'

afterEach(cleanup)

describe('TopBar and AppPage (UI-DS)', () => {
  it('has the menu items whose screens exist, the current one marked, and Ask GROS and Settings', () => {
    render(<TopBar current="inspiration" title="Inspiration" />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Inspiration' })
    ).toBeInTheDocument()
    const menu = within(screen.getByRole('navigation', { name: 'Main' }))
    expect(menu.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Home',
      'Plan',
      'Inspiration',
      // Audiences has no screen yet, so it is left out rather than a dead link.
      'Results'
    ])
    const here = menu.getByRole('link', { name: 'Inspiration' })
    expect(here).toHaveAttribute('aria-current', 'page')
    expect(here.className).toContain('bg-[var(--lime)]')
    expect(menu.getByRole('link', { name: 'Home' })).not.toHaveAttribute(
      'aria-current'
    )
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      '/settings'
    )
    expect(screen.getByRole('link', { name: 'Ask GROS' })).toHaveAttribute(
      'href',
      '/gros'
    )
  })

  it('wraps a page in the GROS tokens and font', () => {
    const { container } = render(
      <AppPage current="home" title="Good morning, Cedar Lane">
        <p>Cards</p>
      </AppPage>
    )
    expect(container.firstElementChild).toHaveClass('gros', 'urbanist-variable')
    expect(screen.getByRole('main')).toHaveTextContent('Cards')
    // The first thing to tab to skips the bar.
    const skip = screen.getAllByRole('link')[0]!
    expect(skip).toHaveTextContent('Skip to content')
    expect(skip).toHaveAttribute('href', '#main-content')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
  })

  it('marks Settings or Ask as the current place, and takes the assistant’s name', () => {
    render(<TopBar current="settings" title="Settings" assistant="Ava" />)
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.getByRole('link', { name: 'Ask Ava' })).not.toHaveAttribute(
      'aria-current'
    )
    expect(
      within(screen.getByRole('navigation', { name: 'Main' }))
        .getAllByRole('link')
        .some((l) => l.hasAttribute('aria-current'))
    ).toBe(false)
  })
})

describe('DayStrip (UI-DS)', () => {
  it('names the 15 days from the first one, across a month end', () => {
    const days = planDates('2026-11-25')
    expect(days).toHaveLength(15)
    expect(days[0]).toEqual({
      letter: 'W',
      number: 25,
      words: 'Wednesday, November 25',
      short: 'November 25'
    })
    expect(days.at(-1)!.number).toBe(9)
    expect(planDates('2026-12-25').at(-1)!.words).toBe('Friday, January 8')
    expect(planDates('2028-02-29')[0]!.words).toBe('Tuesday, February 29')
    // A day that does not exist is refused, never rolled on to March.
    for (const bad of [
      '25/11/2026',
      '2026-02-30',
      '2026-02-29',
      '2026-04-31',
      '2026-13-01'
    ])
      expect(() => planDates(bad), bad).toThrow(RangeError)
  })

  it('opens a day with an email, says each day in words, and pads to 15', () => {
    render(
      <DayStrip
        start="2026-11-16"
        days={[
          { state: 'planned', href: '/plan/email/1' as Route },
          { state: 'in_klaviyo' },
          { state: 'none', href: '/plan' }
        ]}
      />
    )
    // The strip is named by its dates, right however far into the plan.
    const strip = within(
      screen.getByRole('list', { name: 'November 16 to November 30' })
    )
    expect(strip.getAllByRole('listitem')).toHaveLength(15)
    // Only the day with an email and a page opens anything.
    const links = strip.getAllByRole('link')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAccessibleName('Monday, November 16: Planned')
    expect(links[0]).toHaveAttribute('href', '/plan/email/1')
    expect(
      strip.getByText('Tuesday, November 17: In Klaviyo')
    ).toBeInTheDocument()
    expect(
      strip.getByText('Wednesday, November 18: No email')
    ).toBeInTheDocument()
    expect(strip.getByText('Monday, November 30: No email')).toBeInTheDocument()
    // Days past the fifteenth are left out.
    cleanup()
    render(
      <DayStrip
        start="2026-11-16"
        days={Array.from({ length: 20 }, () => ({ state: 'planned' as const }))}
      />
    )
    expect(
      within(
        screen.getByRole('list', { name: 'November 16 to November 30' })
      ).getAllByRole('listitem')
    ).toHaveLength(15)
    // The legend says what the colors mean, in words.
    const legend = within(
      screen.getByRole('list', { name: 'What the colors mean' })
    )
    expect(legend.getAllByRole('listitem').map((l) => l.textContent)).toEqual([
      'No email',
      'Planned',
      'In Klaviyo'
    ])
  })
})

describe('ListRow (UI-DS)', () => {
  it('shows a thumbnail, a title, details joined by a dot, and one action or a status', () => {
    render(
      <RowList label="Next emails">
        <ListRow
          next
          thumbnail={<EmailThumb src="/preview.png" alt="Fall edit preview" />}
          title="The fall edit"
          details={['Fri 20', 'Past buyers']}
          end={<Button size="row" label="Create email" />}
        />
        <ListRow
          thumbnail={<TextThumb />}
          title="A note from us"
          details={['Sun 22', '', 'Everyone']}
          end={<Status kind="planned" />}
        />
      </RowList>
    )
    const [first, second] = within(
      screen.getByRole('list', { name: 'Next emails' })
    ).getAllByRole('listitem')
    expect(first!.className).toContain('bg-[var(--lime-soft)]')
    expect(within(first!).getByText('Fri 20 · Past buyers')).toHaveClass(
      'text-[var(--ink-soft)]'
    )
    expect(
      within(first!).getByRole('img', { name: 'Fall edit preview' })
    ).toBeInTheDocument()
    expect(
      within(first!).getByRole('button', { name: 'Create email' })
    ).toBeInTheDocument()
    // Only the next row has a fill.
    expect(second!.className).not.toContain('bg-[')
    expect(within(second!).getByText('Sun 22 · Everyone')).toHaveClass(
      'text-[var(--stone)]'
    )
    expect(within(second!).getByText('Planned')).toBeInTheDocument()
  })
})

describe('StepCards and FocusShell (UI-DS)', () => {
  it('lets the owner go back to a done step, never ahead', () => {
    render(
      <StepCards
        current={2}
        steps={onboardingSteps.map((name) => ({
          name,
          href: `/onboarding?step=${name.toLowerCase()}` as Route
        }))}
      />
    )
    const steps = within(screen.getByRole('list', { name: 'Steps' }))
    expect(steps.getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Store, done',
      'Brand, done'
    ])
    const items = steps.getAllByRole('listitem')
    expect(items[2]).toHaveAttribute('aria-current', 'step')
    expect(items[2]).toHaveTextContent('Klaviyo')
    expect(items[2]).not.toHaveTextContent('now')
    expect(items[3]).toHaveTextContent('Discount, to do')
    expect(items.filter((i) => i.hasAttribute('aria-current'))).toHaveLength(1)
  })

  it('never links a done step without a page, nor a step ahead', () => {
    render(
      <StepCards
        current={1}
        steps={[{ name: 'Store' }, { name: 'Brand' }, { name: 'Klaviyo' }]}
      />
    )
    expect(screen.queryAllByRole('link')).toEqual([])
    expect(screen.getByText('Store').parentElement).toHaveTextContent(
      'Store, done'
    )
  })

  it('puts the steps in the lime panel and the one task on the right', () => {
    const { container } = render(
      <FocusShell panel={<StepCards current={0} steps={[{ name: 'Store' }]} />}>
        <h1>Your store</h1>
      </FocusShell>
    )
    expect(container.firstElementChild).toHaveClass('gros', 'urbanist-variable')
    expect(screen.getByRole('main')).toHaveTextContent('Your store')
    expect(
      screen.getByRole('complementary', { name: 'Where you are' })
    ).toHaveTextContent('Store')
    // The mark sits beside the word GROS, so it is not read twice.
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('GROS')).toBeInTheDocument()
  })
})

describe('Progress (UI-DS)', () => {
  it('moves one bar per finished step and says Done, Now and Next', () => {
    render(
      <Progress
        title="Creating your email"
        steps={[
          { text: 'Read your store', state: 'done' },
          { text: 'Wrote the words', state: 'done' },
          { text: 'Designing the email', state: 'now' },
          { text: 'Check the email', state: 'next' }
        ]}
      />
    )
    const bar = screen.getByRole('progressbar', { name: 'Creating your email' })
    expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(bar).toHaveAttribute('aria-valuemax', '4')
    expect(bar).toHaveAttribute('aria-valuetext', '2 of 4 steps done')
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('50%')
    expect(screen.getAllByText('Done')).toHaveLength(2)
    expect(screen.getByText('Designing the email')).toHaveClass(
      'type-body-strong'
    )
    expect(screen.getByText('Next')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('turns a failed step into what happened and a way to try again', () => {
    render(
      <Progress
        title="Creating your email"
        steps={[
          { text: 'Read your store', state: 'done' },
          {
            text: 'Could not design the email',
            state: 'failed',
            reason: 'The design took too long. Your words are kept.'
          },
          { text: 'Could not save the draft', state: 'failed' }
        ]}
        retry={<Button label="Try again" />}
      />
    )
    const alerts = screen.getAllByRole('alert')
    expect(alerts).toHaveLength(2)
    const alert = alerts[0]!
    expect(alert).toHaveTextContent('Could not design the email')
    expect(alert).toHaveTextContent('Your words are kept.')
    // The list stays a list, and the button is not read out with the alert.
    expect(alert.tagName).not.toBe('LI')
    const retry = screen.getAllByRole('button', { name: 'Try again' })
    expect(retry).toHaveLength(1)
    expect(alert).not.toContainElement(retry[0]!)
    expect(screen.getByText('Done')).toBeInTheDocument()
  })
})
