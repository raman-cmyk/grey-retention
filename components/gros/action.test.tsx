import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionAnswers, ActionButton } from './action'

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

  it('keeps what was typed after a refusal, except a key, which always clears', async () => {
    const user = userEvent.setup()
    const save = vi.fn(async () => ({
      error: 'Choose a timezone from the list.'
    }))
    render(
      <>
        <ActionButton action={save} label="Save timezone">
          <label>
            Zone
            <input name="timezone" />
          </label>
        </ActionButton>
        <ActionButton action={save} label="Connect" clear="always">
          <label>
            Key
            <input name="apiKey" />
          </label>
        </ActionButton>
      </>
    )
    await user.type(screen.getByLabelText('Zone'), 'Mars/Base')
    await user.click(screen.getByRole('button', { name: 'Save timezone' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save timezone' })
      ).toHaveAccessibleDescription('Choose a timezone from the list.')
    )
    expect(screen.getByLabelText('Zone')).toHaveValue('Mars/Base')
    await user.type(screen.getByLabelText('Key'), 'pk_secret')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Connect' })
      ).toHaveAccessibleDescription('Choose a timezone from the list.')
    )
    await waitFor(() => expect(screen.getByLabelText('Key')).toHaveValue(''))
  })

  it('asks first with confirm, and names each of many buttons', async () => {
    const user = userEvent.setup()
    const disconnect = vi.fn(async () => ({}))
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <>
        <ActionButton
          action={disconnect}
          label="Disconnect"
          confirm="Disconnect?"
        />
        <ActionButton
          action={disconnect}
          label="Remove"
          spokenLabel="WELCOME15"
        />
        <ActionButton
          action={disconnect}
          label="Remove"
          spokenLabel="Remove: BIG30"
        />
      </>
    )
    expect(
      screen.getByRole('button', { name: 'Remove: WELCOME15' })
    ).toHaveTextContent('Remove')
    expect(screen.getByRole('button', { name: 'Remove: BIG30' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    expect(ask).toHaveBeenCalledWith('Disconnect?')
    expect(disconnect).not.toHaveBeenCalled()
    ask.mockReturnValue(true)
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))
    await waitFor(() => expect(disconnect).toHaveBeenCalledOnce())
    ask.mockRestore()
  })

  it('keeps a card’s answer when the button that gave it goes away', async () => {
    const user = userEvent.setup()
    function Codes() {
      const [codes, setCodes] = useState(['WELCOME15'])
      const remove = async () => {
        setCodes([])
        return { message: 'Removed. New emails will not use it.' }
      }
      return (
        <ActionAnswers>
          {codes.map((code) => (
            <ActionButton
              key={code}
              action={remove}
              label="Remove"
              spokenLabel={code}
            />
          ))}
        </ActionAnswers>
      )
    }
    render(<Codes />)
    await user.click(screen.getByRole('button', { name: 'Remove: WELCOME15' }))
    await waitFor(() =>
      expect(
        screen.getByText('Removed. New emails will not use it.')
      ).toBeVisible()
    )
    expect(screen.queryByRole('button')).toBeNull()
  })
})
