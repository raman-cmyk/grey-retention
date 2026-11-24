import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/auth/presentation/actions', () => ({
  signOut: vi.fn(async () => undefined)
}))
import AdminError from './error'
import InboxError from './inbox/error'
import InboxLoading from './inbox/loading'
import AdminLoading from './loading'
import OperationsError from './operations/error'
import OperationsLoading from './operations/loading'

afterEach(cleanup)

// UI-ADM: the admin pages open and fail in the GROS design.
describe('admin loading states', () => {
  it.each([
    ['Admin', AdminLoading, 'Opening the admin pages', null],
    ['Inbox', InboxLoading, 'Opening the inbox', 'Inbox'],
    ['Operations', OperationsLoading, 'Opening Operations', 'Operations']
  ])(
    '%s opens with its words and the admin menu, busy, and no main',
    (_, Loading, words, current) => {
      const { container } = render(<Loading />)
      expect(screen.getByText(words)).toBeInTheDocument()
      const menu = within(screen.getByRole('navigation', { name: 'Main' }))
      expect(menu.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
      const here = menu
        .getAllByRole('link')
        .filter((l) => l.getAttribute('aria-current') === 'page')
        .map((l) => l.textContent)
      expect(here).toEqual(current ? [current] : [])
      expect(container.querySelector('main')).toBeNull()
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    }
  )
})

describe('admin error states', () => {
  it.each([
    ['Admin', AdminError, 'This page did not open'],
    ['Inbox', InboxError, 'The inbox did not open'],
    ['Operations', OperationsError, 'Operations did not open']
  ])('%s says what happened and tries again', async (_, ErrorPage, title) => {
    const retry = vi.fn()
    render(<ErrorPage retry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent(title)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()
  })
})
