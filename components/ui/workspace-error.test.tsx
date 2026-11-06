import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import WorkspaceError from './workspace-error'

afterEach(cleanup)

it('offers recovery without showing potentially private server error details', async () => {
  const retry = vi.fn()
  render(
    <WorkspaceError
      error={new Error('private upstream detail')}
      retry={retry}
    />
  )
  expect(screen.getByRole('alert')).toBeVisible()
  expect(screen.queryByText('private upstream detail')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(retry).toHaveBeenCalledOnce()
})

it('says what happened, what was kept and what to do', () => {
  render(<WorkspaceError error={new Error('x')} retry={() => undefined} />)
  expect(
    screen.getByRole('heading', { name: 'This page couldn’t load' })
  ).toBeInTheDocument()
  expect(
    screen.getByText(/Anything you saved before is still stored/)
  ).toBeInTheDocument()
  expect(screen.getByText(/never repeats a save/)).toBeInTheDocument()
})

it('shows only the opaque digest as a support reference', () => {
  const error = Object.assign(new Error('secret stack'), { digest: '2468ace' })
  render(<WorkspaceError error={error} retry={() => undefined} />)
  expect(screen.getByText('Reference: 2468ace')).toBeInTheDocument()
  expect(screen.queryByText(/secret stack/)).not.toBeInTheDocument()
})

it('shows no reference when the error has no digest', () => {
  render(<WorkspaceError error={new Error('client')} retry={() => undefined} />)
  expect(screen.queryByText(/Reference:/)).not.toBeInTheDocument()
})
