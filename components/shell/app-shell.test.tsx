import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './app-shell'
import { createClientNavigation } from './nav-data'

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }))
vi.mock('@/features/auth/presentation/actions', () => ({
  signOut: async () => undefined
}))

afterEach(cleanup)

function renderShell(
  props: Partial<React.ComponentProps<typeof AppShell>> = {}
) {
  return render(
    <AppShell
      navigation={createClientNavigation('GROS')}
      workspace="Northwind Coffee"
      workspaceLabel="Store"
      identity={{ name: 'Rae Owner', initials: 'RO', role: 'owner' }}
      {...props}
    >
      <h1>Overview</h1>
    </AppShell>
  )
}

describe('app shell', () => {
  it('names the selected store before any page content', () => {
    renderShell()
    const identity = screen.getByTestId('shell-workspace')
    expect(within(identity).getByText('Store')).toBeVisible()
    expect(within(identity).getByText('Northwind Coffee')).toBeVisible()
    expect(
      identity.compareDocumentPosition(
        screen.getByRole('heading', { name: 'Overview' })
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('falls back to the context label for admin and designer shells', () => {
    renderShell({ workspaceLabel: undefined, contextLabel: 'Admin console' })
    expect(
      within(screen.getByTestId('shell-workspace')).getByText('Admin console')
    ).toBeVisible()
  })

  it('keeps landmark names stable and the content inside one column', () => {
    renderShell()
    expect(
      screen.getByRole('navigation', { name: 'Client workspace navigation' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Skip to content' })
    ).toHaveAttribute('href', '#main-content')
    const main = screen.getByRole('main')
    expect(main.firstElementChild).toHaveClass('max-w-[var(--gr-content-max)]')
    expect(
      within(main).getByRole('heading', { name: 'Overview' })
    ).toBeInTheDocument()
  })

  it('marks the current page without relying on colour alone', () => {
    renderShell()
    const current = screen.getByRole('link', { name: 'Overview' })
    expect(current).toHaveAttribute('aria-current', 'page')
    expect(current.className).toContain('aria-[current=page]:before:w-0.5')
    expect(current.className).toContain('aria-[current=page]:font-medium')
  })
})
