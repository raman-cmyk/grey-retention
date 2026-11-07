import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { installDialogPolyfill } from '@/tests/helpers/dialog-polyfill'
import { ActionForm, SubmitButton } from './action-form'
import { ConfirmDialog } from './confirm-dialog'

beforeAll(installDialogPolyfill)
afterEach(cleanup)

const action = async () => ({ message: 'Saved.' })

describe('controls that need JavaScript', () => {
  it('are disabled in the server HTML, before the page is interactive', () => {
    const html = renderToString(
      <>
        <ActionForm action={action}>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
        <ConfirmDialog label="Review" title="Confirm" description="Sure?">
          <p>Body</p>
        </ConfirmDialog>
      </>
    )
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const buttons = [...doc.querySelectorAll('button')].filter((b) =>
      ['Save', 'Review'].includes(b.textContent ?? '')
    )
    expect(buttons).toHaveLength(2)
    for (const b of buttons) expect(b.disabled).toBe(true)
  })

  it('work once the page runs in the browser', async () => {
    render(
      <>
        <ActionForm action={action}>
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
        <ConfirmDialog label="Review" title="Confirm" description="Sure?">
          <p>Body</p>
        </ConfirmDialog>
      </>
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    const review = screen.getByRole('button', { name: 'Review' })
    expect(review).toBeEnabled()
    await userEvent.click(review)
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Saved.')).toBeVisible()
  })

  it('keep their own disabled state', () => {
    render(
      <ActionForm action={action}>
        <SubmitButton disabled>Save</SubmitButton>
      </ActionForm>
    )
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
