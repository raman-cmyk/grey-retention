import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./setup-actions', () => ({
  saveStore: vi.fn(async () => ({})),
  confirmBrand: vi.fn(async () => ({})),
  readStoreAgain: vi.fn(async () => ({}))
}))

import type { SetupView } from './flow'
import { setupFlow, type SetupRecords } from './flow-model'
import type { ProgressStep as Reader } from './progress'
import { readerSteps, SetupScreen } from './setup-screen'

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
const reader = (key: Reader['key'], state: Reader['state']): Reader => ({
  key,
  label: '',
  state,
  startedAt: null,
  finishedAt: null,
  seconds: null
})
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
    found: {
      logo: 'https://cedarlane.example/logo.png',
      colors: ['#1f3a2b', '#f4efe6'],
      fonts: ['Lora'],
      products: []
    },
    reading: {
      signedUpAt: '2026-11-16T10:00:00Z',
      steps: [
        reader('site', 'done'),
        reader('catalog', 'not_started'),
        reader('history', 'not_started'),
        reader('ads', 'skipped'),
        reader('reviews', 'working'),
        reader('plan', 'not_started')
      ],
      done: 1,
      elapsedSeconds: 60,
      firstPlanSeconds: null,
      onTarget: null
    },
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

  it('shows what was found, the store’s colors only in swatches, and nothing made up', () => {
    render(<SetupScreen view={view()} place="brand" />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your brand' })
    ).toBeVisible()
    expect(
      screen.getByRole('img', { name: 'Cedar Lane logo' })
    ).toHaveAttribute('src', 'https://cedarlane.example/logo.png')
    expect(screen.getByText('#1F3A2B')).toBeVisible()
    expect(screen.getByText('Lora')).toBeVisible()
    expect(screen.getByText('Read from Klaviyo next')).toBeVisible()
    // The store's color fills only its swatch.
    const colored = document.querySelectorAll('[style*="background"]')
    expect(colored).toHaveLength(2)
    for (const swatch of colored) expect(swatch).toHaveAttribute('aria-hidden')
    expect(screen.getByRole('button', { name: 'Confirm brand' })).toBeVisible()
  })

  it('says Not found for what was not found', () => {
    render(
      <SetupScreen
        view={view({
          found: { logo: null, colors: [], fonts: [], products: [] }
        })}
        place="brand"
      />
    )
    expect(screen.getAllByText('Not found')).toHaveLength(3)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows the readers while they read, with Try again on a failed one', () => {
    render(<SetupScreen view={view()} place="brand" />)
    expect(
      screen.getByRole('heading', { name: 'Reading your store' })
    ).toBeVisible()
    expect(screen.getByText('Read your website')).toBeVisible()
    expect(screen.getByText('No ads to read')).toBeVisible()
    expect(screen.getByText('Reading your reviews')).toBeVisible()
    expect(
      screen.queryByText(/products|Klaviyo/i, { selector: 'li p' })
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    cleanup()
    const failed = view()
    failed.reading!.steps[0] = reader('site', 'failed')
    render(<SetupScreen view={failed} place="brand" />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The store site did not answer'
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  it('turns a website never read into Try again, and hides a finished read', () => {
    const never = view()
    never.reading!.steps[0] = reader('site', 'not_started')
    expect(readerSteps(never)[0]).toMatchObject({
      state: 'failed',
      text: 'Your website is not read yet'
    })
    const done = view()
    done.reading!.steps[4] = reader('reviews', 'done')
    render(<SetupScreen view={done} place="brand" />)
    expect(
      screen.queryByRole('heading', { name: 'Reading your store' })
    ).toBeNull()
  })

  it('gives staff no Confirm brand and no Try again', () => {
    const failed = view({ owner: false })
    failed.reading!.steps[0] = reader('site', 'failed')
    render(<SetupScreen view={failed} place="brand" />)
    expect(screen.queryByRole('button')).toBeNull()
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
