import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  installDialogPolyfill,
  pressEscapeOn
} from '@/tests/unit/dialog-polyfill'
import { AlertDialog } from './alert-dialog'

beforeAll(installDialogPolyfill)
afterEach(cleanup)

function Harness({ onConfirm = vi.fn(), pending = false }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Discard event
      </button>
      <AlertDialog
        open={open}
        title="Discard this event?"
        confirmLabel="Discard"
        pending={pending}
        onConfirm={() => {
          onConfirm()
          setOpen(false)
        }}
        onCancel={() => setOpen(false)}
      >
        Your answers will be lost.
      </AlertDialog>
    </>
  )
}

describe('AlertDialog', () => {
  it('is a labelled alert with the safe choice focused first', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: 'Discard event' }))
    const dialog = screen.getByRole('alertdialog', {
      name: 'Discard this event?'
    })
    expect(dialog).toHaveAttribute('open')
    expect(dialog).toHaveAccessibleDescription('Your answers will be lost.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Discard' }).className).toContain(
      'bg-[var(--danger)]'
    )
  })

  it('confirms only on the action button', async () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Discard event' }))
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('alertdialog', { hidden: true })
    ).not.toHaveAttribute('open')
  })

  it('cancels on Escape and the backdrop without confirming', async () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    const trigger = screen.getByRole('button', { name: 'Discard event' })
    await userEvent.click(trigger)
    const dialog = screen.getByRole('alertdialog') as HTMLDialogElement
    pressEscapeOn(dialog)
    expect(
      await screen.findByRole('alertdialog', { hidden: true })
    ).not.toHaveAttribute('open')
    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('alertdialog'))
    expect(
      screen.getByRole('alertdialog', { hidden: true })
    ).not.toHaveAttribute('open')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('locks both buttons while the action runs', async () => {
    render(<Harness pending />)
    await userEvent.click(screen.getByRole('button', { name: 'Discard event' }))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled()
    pressEscapeOn(screen.getByRole('alertdialog') as HTMLDialogElement)
    expect(screen.getByRole('alertdialog')).toHaveAttribute('open')
  })
})
