import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  forceEscape,
  installDialogPolyfill,
  pressEscapeOn
} from '@/tests/helpers/dialog-polyfill'
import { AlertDialog } from './alert-dialog'
import { Button } from './button'
import { Modal, type ModalStep } from './modal'

beforeAll(installDialogPolyfill)
afterEach(cleanup)

function Harness({
  step,
  onClose = vi.fn()
}: {
  step?: ModalStep
  onClose?: () => void
}) {
  const [open, setOpen] = useState(true)
  const [notes, setNotes] = useState('')
  return (
    <Modal
      open={open}
      title="Build the brief"
      subtitle="Tell GROS what this month needs."
      step={step}
      dirty={notes.length > 0}
      onClose={() => {
        onClose()
        setOpen(false)
      }}
      footer={<Button type="button">Continue</Button>}
    >
      <label>
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
    </Modal>
  )
}

const modal = () =>
  screen.getByRole('dialog', { name: 'Build the brief', hidden: true })

describe('Modal', () => {
  it('has a title, subtitle, close button and a sticky footer', () => {
    render(<Harness />)
    expect(modal()).toHaveAttribute('open')
    expect(modal()).toHaveAccessibleDescription(
      'Tell GROS what this month needs.'
    )
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    const footer = modal().querySelector('footer')!
    const buttons = within(footer).getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Continue'])
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('shows STEP 1 OF 2 with a two-segment progress bar', () => {
    render(<Harness step={{ current: 1, total: 2 }} />)
    expect(screen.getByText('Step 1 of 2')).toBeInTheDocument()
    const progress = screen.getByRole('progressbar', { name: 'Step 1 of 2' })
    expect(progress).toHaveAttribute('aria-valuenow', '1')
    expect(progress.children).toHaveLength(2)
    expect(progress.querySelectorAll('[data-done]')).toHaveLength(1)
  })

  it('keeps step numbers in range', () => {
    render(<Harness step={{ current: 9, total: 2 }} />)
    expect(screen.getByText('Step 2 of 2')).toBeInTheDocument()
  })

  it('closes straight away when nothing was typed', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    pressEscapeOn(modal() as HTMLDialogElement)
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('asks before throwing away typed answers (Escape, ✕, Cancel, backdrop)', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.type(screen.getByLabelText('Notes'), 'Spring sale')
    const ask = () =>
      screen.getByRole('alertdialog', { name: 'Discard your answers?' })

    pressEscapeOn(modal() as HTMLDialogElement)
    expect(ask()).toHaveAttribute('open')
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByLabelText('Notes')).toHaveValue('Spring sale')

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(ask()).toHaveAttribute('open')
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))

    await userEvent.click(modal())
    expect(ask()).toHaveAttribute('open')
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledOnce()
    // A closed <dialog> has no role in the accessibility tree.
    expect(
      screen.getByText('Build the brief').closest('dialog')
    ).not.toHaveAttribute('open')
  })

  it('keeps the confirm open on Escape inside it, and only Keep editing returns', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.type(screen.getByLabelText('Notes'), 'x')
    pressEscapeOn(modal() as HTMLDialogElement)
    const ask = screen.getByRole('alertdialog', {
      name: 'Discard your answers?'
    }) as HTMLDialogElement
    pressEscapeOn(ask)
    expect(onClose).not.toHaveBeenCalled()
    expect(modal()).toHaveAttribute('open')
    expect(screen.getByLabelText('Notes')).toHaveValue('x')
  })

  it('reopens and asks when the browser forces it shut with typed answers', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.type(screen.getByLabelText('Notes'), 'x')
    pressEscapeOn(modal() as HTMLDialogElement)
    const ask = screen.getByRole('alertdialog', {
      name: 'Discard your answers?'
    }) as HTMLDialogElement
    forceEscape(ask, modal() as HTMLDialogElement)
    expect(modal()).toHaveAttribute('open')
    expect(
      screen.getByRole('alertdialog', { name: 'Discard your answers?' })
    ).toHaveAttribute('open')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a forced close as a close when nothing was typed', () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    forceEscape(modal() as HTMLDialogElement)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ignores Escape in a dialog nested in its body', async () => {
    const onClose = vi.fn()
    function Nested() {
      const [ask, setAsk] = useState(false)
      return (
        <Modal open title="Plan the event" onClose={onClose}>
          <button type="button" onClick={() => setAsk(true)}>
            Remove day
          </button>
          <AlertDialog
            open={ask}
            title="Remove this day?"
            confirmLabel="Remove"
            onConfirm={() => setAsk(false)}
            onCancel={() => setAsk(false)}
          >
            It goes back to the calendar.
          </AlertDialog>
        </Modal>
      )
    }
    render(<Nested />)
    await userEvent.click(screen.getByRole('button', { name: 'Remove day' }))
    const inner = screen.getByRole('alertdialog', {
      name: 'Remove this day?'
    }) as HTMLDialogElement
    pressEscapeOn(inner)
    expect(inner).not.toHaveAttribute('open')
    await userEvent.click(screen.getByRole('button', { name: 'Remove day' }))
    await userEvent.click(
      screen.getByRole('alertdialog', { name: 'Remove this day?' })
    )
    expect(onClose).not.toHaveBeenCalled()
  })

  it('uses screen-specific discard wording and never shows a stale confirm', async () => {
    function Custom() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Reopen
          </button>
          <Modal
            open={open}
            title="Launch a multi-day event"
            dirty
            discard={{
              title: 'Discard this event plan?',
              body: 'Heads up: the plan is lost.',
              confirmLabel: 'Discard & close'
            }}
            onClose={() => setOpen(false)}
            footer={
              <Button type="button" onClick={() => setOpen(false)}>
                Close from parent
              </Button>
            }
          >
            body
          </Modal>
        </>
      )
    }
    render(<Custom />)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(
      screen.getByRole('alertdialog', { name: 'Discard this event plan?' })
    ).toHaveAccessibleDescription('Heads up: the plan is lost.')
    expect(
      screen.getByRole('button', { name: 'Discard & close' })
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    // The parent closes the modal while the confirm is up, then reopens it.
    act(() =>
      (screen.getByText('Close from parent') as HTMLButtonElement).click()
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('shows step 1 for a broken step number', () => {
    render(<Harness step={{ current: Number.NaN, total: 3 }} />)
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument()
  })
})
