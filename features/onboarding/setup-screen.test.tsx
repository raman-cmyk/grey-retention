import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./setup-actions', () => ({
  saveStore: vi.fn(async () => ({})),
  readStoreAgain: vi.fn(async () => ({}))
}))

import type { SetupView } from './flow'
import { setupFlow, type SetupRecords } from './flow-model'
import { SetupScreen } from './setup-screen'

afterEach(cleanup)

const records: SetupRecords = {
  domain: 'cedarlane.example',
  confirmedSite: null,
  klaviyoWorking: false,
  maxDiscountSet: false,
  following: 0,
  rivalsSkipped: false,
  finished: false
}
const none: SetupRecords = { ...records, domain: null }
function view(over: Partial<SetupView> = {}, r = records): SetupView {
  return {
    state: 'ready',
    owner: true,
    workspaceName: 'Cedar Lane studio',
    flow: setupFlow(r),
    brand: { name: 'Cedar Lane', domain: 'cedarlane.example', revision: 2 },
    klaviyo: null,
    liveKeys: false,
    offers: null,
    ...over
  }
}

describe('SetupScreen (UI-ONBb)', () => {
  it('shows the five steps, done ones linking back and none ahead', () => {
    render(<SetupScreen view={view()} place="brand" />)
    const steps = screen.getByRole('list', { name: 'Steps' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(5)
    expect(within(steps).getByRole('link', { name: /Store/ })).toHaveAttribute(
      'href',
      '/setup?step=store'
    )
    expect(within(steps).getAllByRole('link')).toHaveLength(1)
    expect(within(steps).getByText('Brand').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('asks the owner for the store’s name and website, filled in', () => {
    render(
      <SetupScreen view={view({}, { ...records, domain: '' })} place="store" />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your store' })
    ).toBeVisible()
    expect(screen.getByLabelText('Store name')).toHaveValue('Cedar Lane')
    expect(screen.getByLabelText('Website')).toHaveValue('cedarlane.example')
    expect(screen.getByRole('button', { name: 'Save store' })).toBeVisible()
    cleanup()
    // A new workspace: its own name until a store name is saved.
    render(<SetupScreen view={view({ brand: null }, none)} place="store" />)
    expect(screen.getByLabelText('Store name')).toHaveValue('Cedar Lane studio')
    expect(screen.getByLabelText('Website')).toHaveValue('')
  })

  it('shows staff the saved store and no buttons', () => {
    render(<SetupScreen view={view({ owner: false })} place="store" />)
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('cedarlane.example')).toBeVisible()
    expect(
      screen.getByText('Only the workspace owner can change this.')
    ).toBeVisible()
  })

  it('says when setup cannot be read, with one way to try again', () => {
    render(
      <SetupScreen
        view={view({ state: 'unreadable', flow: null })}
        place="store"
      />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Setup did not open' })
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/setup'
    )
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull()
  })
})
