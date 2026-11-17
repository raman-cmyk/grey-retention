import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, ButtonLink, buttonClasses } from './button'
import { Card, ChangeBadge, Tile } from './card'
import { Field } from './input'
import { Mark } from './mark'
import { Status } from './status'
import { EmptyState, ErrorState } from './states'

afterEach(cleanup)

describe('Button (UI-DS)', () => {
  it('is a labelled, keyboard-operable pill in the five kinds', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button label="Plan next 15 days" onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Plan next 15 days' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledOnce()
    expect(button).toHaveAttribute('type', 'button')
    expect(buttonClasses('main')).toContain('bg-[var(--forest)]')
    expect(buttonClasses('lime')).toContain('text-[var(--forest)]')
    expect(buttonClasses('outline')).toContain('gros-button-outline')
    expect(buttonClasses('quiet')).toContain('text-[var(--stone)]')
    expect(buttonClasses('main', 'focus')).toContain('h-[var(--control-lg)]')
    expect(buttonClasses('main', 'row')).toContain('h-[var(--control-sm)]')
    // Quiet actions are the small kind, weight 500 (the utility wins).
    expect(buttonClasses('quiet')).toContain('h-[var(--control-sm)]')
    expect(buttonClasses('quiet')).not.toContain('h-[var(--control-md)]')
    expect(buttonClasses('quiet')).toContain('font-medium')
  })

  it('keeps its own label when a caller passes another', () => {
    render(<Button kind="round" label="Open the plan" aria-label="Go" />)
    expect(
      screen.getByRole('button', { name: 'Open the plan' })
    ).toBeInTheDocument()
  })

  it('gives the round open button a spoken label and only an arrow to see', () => {
    render(<Button kind="round" label="Open the plan" />)
    const button = screen.getByRole('button', { name: 'Open the plan' })
    expect(button).not.toHaveTextContent('Open the plan')
    expect(button.className).toContain('size-[var(--control-round)]')
  })

  it('links look like buttons', () => {
    render(<ButtonLink href="/plan" label="Open plan" kind="outline" />)
    const link = screen.getByRole('link', { name: 'Open plan' })
    expect(link).toHaveAttribute('href', '/plan')
    expect(link.className).toContain('gros-button-outline')
  })

  it('is plainly disabled, and does nothing', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button label="Create email" disabled onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Create email' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Field (UI-DS)', () => {
  it('has a real label, and says what is wrong under the field', () => {
    const { rerender } = render(<Field label="Your store" defaultValue="" />)
    const input = screen.getByLabelText('Your store')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input.className).toContain('bg-[var(--mist)]')
    rerender(
      <Field
        label="Your store"
        defaultValue="cedar"
        error="Add the whole address, like cedarlane.com"
      />
    )
    const wrong = screen.getByLabelText('Your store')
    expect(wrong).toHaveAttribute('aria-invalid', 'true')
    expect(wrong).toHaveAccessibleDescription(
      'Add the whole address, like cedarlane.com'
    )
    // Read out as it appears, so the owner hears what to fix.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Add the whole address, like cedarlane.com'
    )
  })

  it('shows a lime check when the value was found, and a white fill on the page', () => {
    render(
      <Field label="Your store" defaultValue="cedarlane.com" found onPage />
    )
    expect(screen.getByText('Found')).toBeInTheDocument()
    const input = screen.getByLabelText('Your store')
    expect(input.className).toContain('bg-[var(--white)]')
    expect(input).toHaveAccessibleDescription('Found')
    // Room for the check, so a long value never runs under it.
    expect(input.className).toContain('pr-[var(--space-12)]')
  })

  it('shows no check while the value is wrong, and keeps a caller’s description', () => {
    render(
      <>
        <p id="hint">Your web address</p>
        <Field
          label="Your store"
          defaultValue="cedar"
          found
          error="Add the whole address, like cedarlane.com"
          aria-describedby="hint"
        />
      </>
    )
    expect(screen.queryByText('Found')).toBeNull()
    expect(screen.getByLabelText('Your store')).toHaveAccessibleDescription(
      'Your web address Add the whole address, like cedarlane.com'
    )
  })
})

describe('Card, Tile and ChangeBadge (UI-DS)', () => {
  it('draws a white card, or the lime card with its rings', () => {
    const { container, rerender } = render(
      <Card label="Revenue">
        <p>$12,480</p>
      </Card>
    )
    const card = screen.getByRole('region', { name: 'Revenue' })
    expect(card.className).toContain('bg-[var(--white)]')
    expect(card.className).toContain('rounded-[var(--radius-lg)]')
    expect(container.querySelector('svg')).toBeNull()
    rerender(
      <Card tone="lime" label="Revenue">
        <p>$12,480</p>
      </Card>
    )
    expect(screen.getByRole('region', { name: 'Revenue' }).className).toContain(
      'bg-[var(--lime)]'
    )
    expect(container.querySelector('svg[aria-hidden]')).not.toBeNull()
  })

  it('holds a label and a number in a tile, mist or lime-tile', () => {
    const { rerender } = render(<Tile label="Opens" value="48%" />)
    expect(screen.getByText('Opens')).toHaveClass('text-[var(--stone)]')
    expect(screen.getByText('48%')).toHaveClass('type-number-md')
    rerender(<Tile label="Opens" value="48%" onLime />)
    expect(screen.getByText('Opens')).toHaveClass('text-[var(--forest)]')
    render(<ChangeBadge value="+18%" />)
    expect(screen.getByText('+18%')).toHaveClass('gros-badge')
  })
})

describe('Status (UI-DS)', () => {
  it('is always a word with its dot, in one of four looks', () => {
    render(
      <>
        <Status kind="in_klaviyo" />
        <Status kind="planned" />
        <Status kind="working" word="Designing" />
        <Status kind="needs_you" />
      </>
    )
    for (const word of ['In Klaviyo', 'Planned', 'Designing', 'Needs you'])
      expect(screen.getByText(word)).toBeInTheDocument()
    expect(screen.getByText('Needs you').className).toContain(
      'bg-[var(--signal-soft)]'
    )
  })
})

describe('EmptyState and ErrorState (UI-DS)', () => {
  it('has a title and one button, or what happened, what to do and one button', () => {
    render(
      <>
        <EmptyState
          title="No plan yet"
          action={<Button label="Plan next 15 days" />}
        />
        <ErrorState
          title="Klaviyo key stopped working"
          reason="Your emails are safe. Reconnect Klaviyo to keep planning."
          action={<Button label="Reconnect" />}
        />
      </>
    )
    expect(
      screen.getByRole('heading', { name: 'No plan yet' })
    ).toBeInTheDocument()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Klaviyo key stopped working')
    expect(alert).toHaveTextContent('Your emails are safe.')
    // The button is not read out as part of the alert.
    const button = screen.getByRole('button', { name: 'Reconnect' })
    expect(alert).not.toContainElement(button)
  })
})

describe('Mark (UI-DS)', () => {
  it('is named for screen readers', () => {
    render(<Mark size={36} />)
    expect(screen.getByRole('img', { name: 'GROS' })).toHaveAttribute(
      'width',
      '36'
    )
    cleanup()
    const { container } = render(<Mark decorative />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true'
    )
  })
})
