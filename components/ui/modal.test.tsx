import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  installDialogPolyfill,
  pressEscapeOn
} from '@/tests/unit/dialog-polyfill'
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
})
