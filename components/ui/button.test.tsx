import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, buttonVariants } from './button'

afterEach(cleanup)

describe('Button', () => {
  it('is keyboard operable', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Create campaign</Button>)

    const button = screen.getByRole('button', { name: 'Create campaign' })
    button.focus()
    await userEvent.keyboard('{Enter}')

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('maps each design role to its theme colours', () => {
    expect(buttonVariants({ variant: 'primary' })).toContain(
      'bg-[var(--brand-primary)]'
    )
    expect(buttonVariants({ variant: 'accent' })).toContain(
      'bg-[var(--brand-secondary)]'
    )
    expect(buttonVariants({ variant: 'accent' })).toContain(
      'text-[var(--on-brand-secondary)]'
    )
    expect(buttonVariants({ variant: 'secondary' })).toContain(
      'bg-[var(--surface-hover)]'
    )
    expect(buttonVariants({ variant: 'danger' })).toContain(
      'bg-[var(--danger)]'
    )
    expect(buttonVariants()).toBe(buttonVariants({ variant: 'primary' }))
  })

  it('keeps a visible focus ring and never uses shadows or pills', () => {
    for (const variant of [
      'primary',
      'accent',
      'secondary',
      'quiet',
      'danger'
    ] as const) {
      const classes = buttonVariants({ variant })
      expect(classes).toContain('focus-visible:ring-2')
      expect(classes).toContain('rounded-[var(--radius-control)]')
      expect(classes).not.toMatch(/\bshadow-|rounded-full/)
    }
  })

  it('does not fire when disabled', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Send
      </Button>
    )
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
