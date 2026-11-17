import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionButton } from './action'

afterEach(cleanup)

describe('ActionButton (UI-HOMEb)', () => {
  it('sends its fields, keeps its words, and shows the action’s own error under itself', async () => {
    const user = userEvent.setup()
    let finish: (v: { error?: string }) => void = () => {}
    const action = vi.fn(
      (_state: unknown, form: FormData) =>
        new Promise<{ error?: string }>((done) => {
          finish = done
          void form
        })
    )
    render(
      <ActionButton
        action={action}
        label="Create email"
        fields={{ run: 'run-1', slot: '2' }}
      />
    )
    const button = screen.getByRole('button', { name: 'Create email' })
    await user.click(button)
    await waitFor(() => expect(action).toHaveBeenCalledOnce())
    const sent = action.mock.calls[0]![1]
    expect(Object.fromEntries(sent as unknown as [string, string][])).toEqual({
      run: 'run-1',
      slot: '2'
    })
    // While it runs: the same words, and it cannot be pressed again.
    await waitFor(() => expect(button).toBeDisabled())
    expect(button).toHaveTextContent('Create email')
    finish({ error: 'Only this workspace’s owner creates emails.' })
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).toHaveAccessibleDescription(
      'Only this workspace’s owner creates emails.'
    )
  })

  it('shows no error after a success', async () => {
    const user = userEvent.setup()
    render(<ActionButton action={async () => ({})} label="Plan next 15 days" />)
    const button = screen.getByRole('button', { name: 'Plan next 15 days' })
    await user.click(button)
    await waitFor(() => expect(button).toBeEnabled())
    expect(button).not.toHaveAccessibleDescription()
  })
})
