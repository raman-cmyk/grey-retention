import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceLoading } from './workspace-loading'

afterEach(cleanup)

describe('WorkspaceLoading', () => {
  it('announces loading once and hides the decorative skeleton', () => {
    const { container } = render(<WorkspaceLoading />)
    expect(
      screen.getByRole('status', { name: 'Loading workspace' })
    ).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden]')).not.toBeNull()
    expect(container.textContent).toBe('Loading workspace…')
  })
})
