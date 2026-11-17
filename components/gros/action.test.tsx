import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionAnswers, ActionButton, useCardAnswer } from './action'

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

  it('can say which item it is for, always starting with its visible words (UI-LRNb)', () => {
    const action = async () => ({})
    render(
      <>
        <ActionButton
          action={action}
          label="Pin"
          spokenLabel="Lead with one product"
        />
        <ActionButton
          action={action}
          label="Remove"
          spokenLabel="Remove: All caps subjects"
        />
        <ActionButton action={action} label="Unpin" />
        {/* Rule text that happens to start with the button's word. */}
        <ActionButton
          action={action}
          label="Remove"
          spokenLabel="Remove the code from the subject"
        />
        <ActionButton
          action={action}
          label="Pin"
          spokenLabel="Pinpoint one product"
        />
      </>
    )
    expect(
      screen.getByRole('button', { name: 'Pin: Lead with one product' })
    ).toHaveTextContent(/^Pin$/)
    expect(
      screen.getByRole('button', { name: 'Remove: All caps subjects' })
    ).toHaveTextContent(/^Remove$/)
    expect(screen.getByRole('button', { name: 'Unpin' })).not.toHaveAttribute(
      'aria-label'
    )
    expect(
      screen.getByRole('button', {
        name: 'Remove: Remove the code from the subject'
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Pin: Pinpoint one product' })
    ).toBeInTheDocument()
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
        <ActionButton
          action={disconnect}
          label="Remove"
          spokenLabel="Remove the code"
        />
      </>
    )
    expect(
      screen.getByRole('button', { name: 'Remove: WELCOME15' })
    ).toHaveTextContent('Remove')
    expect(screen.getByRole('button', { name: 'Remove: BIG30' })).toBeVisible()
    // A code that starts with the label is still named after the button.
    expect(
      screen.getByRole('button', { name: 'Remove: Remove the code' })
    ).toBeVisible()
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
    const { container } = render(<Codes />)
    // The line is there, empty, before any answer (a live region to read).
    expect(container.querySelector('p[aria-live]')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Remove: WELCOME15' }))
    const answer = await screen.findByText(
      'Removed. New emails will not use it.'
    )
    expect(screen.queryByRole('button')).toBeNull()
    // The cursor goes to the answer, not to the page.
    await waitFor(() => expect(answer).toHaveFocus())
  })

  it('hides a card’s old answer while a new press runs, and keeps cards apart', async () => {
    const user = userEvent.setup()
    let finish: (v: { message: string }) => void = () => {}
    const slow = () =>
      new Promise<{ message: string }>((done) => {
        finish = done
      })
    render(
      <>
        <section aria-label="Codes">
          <ActionAnswers>
            <ActionButton
              action={async () => ({ message: 'Added.' })}
              label="Add"
            />
            <ActionButton action={slow} label="Remove" />
          </ActionAnswers>
        </section>
        <section aria-label="Timezone">
          <ActionAnswers>
            <ActionButton
              action={async () => ({ error: 'Choose a timezone.' })}
              label="Save"
            />
          </ActionAnswers>
        </section>
      </>
    )
    const codes = screen.getByRole('region', { name: 'Codes' })
    const zone = screen.getByRole('region', { name: 'Timezone' })
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(codes).toHaveTextContent('Added.'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(zone).toHaveTextContent('Choose a timezone.'))
    expect(codes).toHaveTextContent('Added.')
    expect(codes).not.toHaveTextContent('Choose a timezone.')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(codes).not.toHaveTextContent('Added.'))
    finish({ message: 'Removed.' })
    await waitFor(() => expect(codes).toHaveTextContent('Removed.'))
    expect(
      screen.getByRole('button', { name: 'Remove' })
    ).toHaveAccessibleDescription('Removed.')
    expect(
      screen.getByRole('button', { name: 'Add' })
    ).not.toHaveAccessibleDescription()
    expect(zone).toHaveTextContent('Choose a timezone.')
  })

  it('lets a card’s own form answer in the card’s one line (UI-SETb)', async () => {
    const user = userEvent.setup()
    function Own() {
      const card = useCardAnswer()
      return (
        <>
          <button onClick={() => card?.tell({ message: 'Invite saved.' })}>
            Invite
          </button>
          <p>
            {card === null ? 'alone' : card.othersAnswered ? 'others' : 'mine'}
          </p>
        </>
      )
    }
    const { container } = render(
      <ActionAnswers>
        <Own />
        <ActionButton
          action={async () => ({ message: 'Renewed.' })}
          label="Resend"
        />
      </ActionAnswers>
    )
    const line = container.querySelector('p[aria-live]')!
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(line).toHaveTextContent('Invite saved.'))
    expect(screen.getByText('mine')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Resend' }))
    await waitFor(() => expect(line).toHaveTextContent('Renewed.'))
    expect(screen.getByText('others')).toBeVisible()
    cleanup()
    render(<Own />)
    expect(screen.getByText('alone')).toBeVisible()
  })
})
