import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceForm } from './workspace-form'

const { createWorkspace } = vi.hoisted(() => ({ createWorkspace: vi.fn() }))
vi.mock('@/features/auth/presentation/actions', () => ({ createWorkspace }))

describe('Workspace setup', () => {
  beforeEach(() => createWorkspace.mockReset())
  it('suggests an address, keeps manual edits and submits the detected timezone', async () => {
    createWorkspace.mockResolvedValue({
      message: 'That workspace URL is already taken.'
    })
    const user = userEvent.setup()
    render(<WorkspaceForm />)
    await user.type(
      screen.getByRole('textbox', { name: 'What is your brand called?' }),
      'Café Wellness'
    )
    const slug = screen.getByRole('textbox', {
      name: 'Workspace URL',
      hidden: true
    })
    expect(slug).toHaveValue('cafe-wellness')
    await user.click(screen.getByText('Workspace details'))
    await user.clear(slug)
    await user.type(slug, 'wellness-team')
    await user.type(
      screen.getByRole('textbox', { name: 'What is your brand called?' }),
      ' Store'
    )
    expect(slug).toHaveValue('wellness-team')
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(createWorkspace).toHaveBeenCalledOnce())
    const form = createWorkspace.mock.calls[0][1] as FormData
    expect(form.get('timezone')).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    )
    expect(form.get('slug')).toBe('wellness-team')
    expect(await screen.findByRole('alert')).toHaveTextContent('already taken')
    expect(
      screen.getByRole('textbox', { name: 'What is your brand called?' })
    ).toHaveValue('Café Wellness Store')
    expect(
      screen.getByText('Workspace details').closest('details')
    ).toHaveAttribute('open')
  })
})

afterEach(cleanup)
