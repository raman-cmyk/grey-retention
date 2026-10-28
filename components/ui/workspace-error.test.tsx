import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import WorkspaceError from './workspace-error'

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
