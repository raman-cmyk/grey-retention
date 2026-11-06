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

  it('keeps a visible focus ring and only rounds fully when asked', () => {
    for (const variant of [
      'primary',
      'accent',
      'secondary',
      'outline',
      'quiet',
      'danger'
    ] as const) {
      const classes = buttonVariants({ variant })
      expect(classes).toContain('focus-visible:ring-2')
      expect(classes).toContain('rounded-[var(--radius-control)]')
      expect(classes).not.toMatch(/\bshadow-|rounded-full/)
      expect(buttonVariants({ variant, shape: 'pill' })).toMatch(
        /rounded-full$/
      )
    }
  })

  it('draws the page-header outline button with a visible border', () => {
    const classes = buttonVariants({ variant: 'outline', shape: 'pill' })
    expect(classes).toContain('border-[var(--line-strong)]')
    expect(classes).toContain('bg-[var(--surface-raised)]')
    expect(classes).not.toContain('rounded-[var(--radius-control)]')
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
