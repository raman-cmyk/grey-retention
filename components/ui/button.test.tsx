import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './button'

describe('Button', () => {
  it('is keyboard operable', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Create campaign</Button>)

    const button = screen.getByRole('button', { name: 'Create campaign' })
    button.focus()
    await userEvent.keyboard('{Enter}')

    expect(onClick).toHaveBeenCalledOnce()
  })
})
