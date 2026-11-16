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

  it('sends the fields typed above it, says what was done, and clears them (UI-SETa)', async () => {
    const user = userEvent.setup()
    const action = vi.fn(async () => ({ message: 'Added WELCOME15.' }))
    render(
      <ActionButton action={action} label="Add code" fields={{ t: '1' }}>
        <label>
          Code
          <input name="code" />
        </label>
      </ActionButton>
    )
    await user.type(screen.getByLabelText('Code'), 'WELCOME15')
    const button = screen.getByRole('button', { name: 'Add code' })
    await user.click(button)
    await waitFor(() =>
      expect(button).toHaveAccessibleDescription('Added WELCOME15.')
    )
    expect(button).toHaveTextContent('Add code')
    expect(
      Object.fromEntries(
        (
          action.mock.calls[0] as unknown as [unknown, FormData]
        )[1] as unknown as [string, string][]
      )
    ).toEqual({ t: '1', code: 'WELCOME15' })
    expect(screen.getByLabelText('Code')).toHaveValue('')
  })

  it('keeps what was typed with keep, and asks first with confirm', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({
      error: 'Choose a timezone from the list.'
    }))
    render(
      <ActionButton action={save} label="Save timezone" keep>
        <label>
          Zone
          <input name="timezone" />
        </label>
      </ActionButton>
    )
    await user.type(screen.getByLabelText('Zone'), 'Mars/Base')
    await user.click(screen.getByRole('button', { name: 'Save timezone' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save timezone' })
      ).toHaveAccessibleDescription('Choose a timezone from the list.')
    )
    expect(screen.getByLabelText('Zone')).toHaveValue('Mars/Base')
    cleanup()

    const disconnect = vi.fn(async () => ({}))
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <ActionButton
        action={disconnect}
        label="Disconnect"
        confirm="Disconnect?"
      />
    )
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(ask).toHaveBeenCalledWith('Disconnect?')
    expect(disconnect).not.toHaveBeenCalled()
    ask.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(disconnect).toHaveBeenCalledOnce())
    ask.mockRestore()
  })
})
