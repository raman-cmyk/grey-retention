import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('./setup-actions', () => ({
  saveStore: vi.fn(async () => ({})),
  confirmBrand: vi.fn(async () => ({})),
  readStoreAgain: vi.fn(async () => ({}))
}))

import type { SetupView } from './flow'
import { setupFlow, type SetupRecords } from './flow-model'
import { SetupForm } from './setup-form'
import type { ProgressStep as Reader } from './progress'
import { readerReason, readerSteps, SetupScreen } from './setup-screen'

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
const reader = (
  key: Reader['key'],
  state: Reader['state'],
  failure?: string
): Reader => ({
  key,
  label: '',
  state,
  startedAt: null,
  finishedAt: null,
  seconds: null,
  ...(failure ? { failure } : {})
})
function view(over: Partial<SetupView> = {}, r = records): SetupView {
  return {
    state: 'ready',
    owner: true,
    workspaceName: 'Cedar Lane studio',
    timezone: 'America/New_York',
    flow: setupFlow(r),
    brand: {
      name: 'Cedar Lane',
      domain: 'cedarlane.example',
      revision: 2,
      voice: 'Calm',
      prohibitions: ''
    },
    klaviyo: null,
    liveKeys: false,
    keyCheck: 'sample',
    offers: null,
    found: {
      logo: 'https://cedarlane.example/logo.png',
      colors: ['#1f3a2b', '#f4efe6'],
      fonts: ['Lora'],
      products: [],
      catalogRead: false
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

  it('marks each step by its own record, and the step shown as current', () => {
    // Klaviyo and a discount saved, no website yet: those two are done,
    // Store is Now, and neither done step ahead is a link.
    render(
      <SetupScreen
        view={view(
          { brand: null },
          {
            ...none,
            klaviyoWorking: true,
            maxDiscountSet: true
          }
        )}
        place="store"
      />
    )
    const steps = screen.getByRole('list', { name: 'Steps' })
    const card = (name: string) => within(steps).getByText(name).closest('li')!
    expect(card('Klaviyo')).toHaveTextContent(', done')
    expect(card('Discount')).toHaveTextContent(', done')
    expect(card('Brand')).toHaveTextContent(', to do')
    expect(card('Store')).toHaveAttribute('aria-current', 'step')
    expect(within(steps).queryAllByRole('link')).toHaveLength(0)
    cleanup()
    // A done step opened again is the current one; Now still says so.
    render(<SetupScreen view={view()} place="store" />)
    const again = screen.getByRole('list', { name: 'Steps' })
    expect(within(again).getByText('Store').closest('li')).toHaveAttribute(
      'aria-current',
      'step'
    )
    const now = within(again).getByText('Brand').closest('li')!
    expect(now).not.toHaveAttribute('aria-current')
    expect(now).toHaveTextContent(', now')
  })

  it('moves the focus to the new step’s title only when the step changes', () => {
    const { rerender } = render(
      <SetupScreen view={view({}, { ...records, domain: '' })} place="store" />
    )
    const store = screen.getByRole('heading', { level: 1, name: 'Your store' })
    // The first time setup opens, nothing moves the focus.
    expect(store).not.toHaveFocus()
    expect(store).toHaveAttribute('tabindex', '-1')
    rerender(<SetupScreen view={view()} place="brand" />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your brand' })
    ).toHaveFocus()
  })
})

describe('the Brand step (UI-ONBc)', () => {
  it('shows what was found, the store’s colors only in swatches, and nothing made up', () => {
    render(<SetupScreen view={view()} place="brand" />)
    expect(
      screen.getByRole('img', { name: 'Cedar Lane logo' })
    ).toHaveAttribute('src', 'https://cedarlane.example/logo.png')
    expect(screen.getByText('#1F3A2B')).toBeVisible()
    expect(screen.getByText('Lora')).toBeVisible()
    expect(screen.getByText('Read from Klaviyo next')).toBeVisible()
    const colored = document.querySelectorAll('[style*="background"]')
    expect(colored).toHaveLength(2)
    for (const swatch of colored) expect(swatch).toHaveAttribute('aria-hidden')
  })

  it('confirms the website shown, with the voice and rules to fill in (optional)', () => {
    const { container } = render(<SetupScreen view={view()} place="brand" />)
    expect(container.querySelector('input[name="site"]')).toHaveValue(
      'cedarlane.example'
    )
    expect(
      screen.getByLabelText('How should your emails sound? (optional)')
    ).toHaveValue('Calm')
    expect(
      screen.getByLabelText('Anything we should avoid? (optional)')
    ).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Confirm brand' })).toBeVisible()
  })

  it('hides Confirm brand while the website is read, or when nothing found can be read', () => {
    const reading = view()
    reading.reading!.steps[0] = reader('site', 'working')
    render(<SetupScreen view={reading} place="brand" />)
    expect(screen.queryByRole('button', { name: 'Confirm brand' })).toBeNull()
    cleanup()
    render(<SetupScreen view={view({ found: null })} place="brand" />)
    expect(screen.getByText(/What we found could not be read/)).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Confirm brand' })).toBeNull()
  })

  it('waits for the website to be read before Confirm brand, and lets him go on', () => {
    const waiting = view({}, { ...records, siteReading: true })
    waiting.reading!.steps[0] = reader('site', 'waiting')
    render(<SetupScreen view={waiting} place="brand" />)
    expect(
      screen.getByText(
        'Reading your website. This can take a few hours. Go on with the next steps; we’ll ask you to confirm your brand when it’s read.'
      )
    ).toBeVisible()
    // Brand waits, so Klaviyo is Now: one main button there.
    expect(
      screen.getByRole('link', { name: 'Go on to Klaviyo' })
    ).toHaveAttribute('href', '/setup?step=klaviyo')
    expect(screen.queryByRole('button', { name: 'Confirm brand' })).toBeNull()
    expect(
      screen.queryByLabelText('How should your emails sound? (optional)')
    ).toBeNull()
    const steps = within(screen.getByRole('list', { name: 'Steps' }))
    const brand = steps.getByRole('link', { name: /Brand/ })
    expect(brand).toHaveAttribute('href', '/setup?step=brand')
    expect(brand).toHaveTextContent('Reading your website')
    expect(brand.closest('li')).toHaveAttribute('aria-current', 'step')
    cleanup()
    // With every other step done, Home is the way out.
    const last = view(
      {},
      {
        ...records,
        siteReading: true,
        klaviyoWorking: true,
        maxDiscountSet: true,
        rivalsSkipped: true
      }
    )
    last.reading!.steps[0] = reader('site', 'working')
    render(<SetupScreen view={last} place="brand" />)
    expect(screen.getByRole('link', { name: 'Open Home' })).toHaveAttribute(
      'href',
      '/home'
    )
    expect(screen.queryByRole('link', { name: /Go on to/ })).toBeNull()
    cleanup()
    // A read that failed lets him confirm what there is.
    const failed = view()
    failed.reading!.steps[0] = reader('site', 'failed')
    render(<SetupScreen view={failed} place="brand" />)
    expect(screen.getByRole('button', { name: 'Confirm brand' })).toBeVisible()
  })

  it('keeps the form and what was found through a refresh', () => {
    const { rerender } = render(<SetupScreen view={view()} place="brand" />)
    const voice = screen.getByLabelText(
      'How should your emails sound? (optional)'
    )
    fireEvent.change(voice, { target: { value: 'Warm and half typed' } })
    // A refresh: the website is read again, and the found read fails.
    const again = view({ found: null })
    again.reading!.steps[0] = reader('site', 'working')
    rerender(<SetupScreen view={again} place="brand" />)
    expect(
      screen.getByLabelText('How should your emails sound? (optional)')
    ).toHaveValue('Warm and half typed')
    expect(screen.getByText('Lora')).toBeVisible()
    expect(screen.queryByText(/What we found could not be read/)).toBeNull()
  })

  it('says when the Klaviyo catalog was read and has no products', () => {
    render(
      <SetupScreen
        view={view({
          found: {
            logo: null,
            colors: [],
            fonts: [],
            products: [],
            catalogRead: true
          }
        })}
        place="brand"
      />
    )
    expect(screen.getByText('No products found in Klaviyo yet.')).toBeVisible()
  })

  it('says Not found for what was not found', () => {
    render(
      <SetupScreen
        view={view({
          found: {
            logo: null,
            colors: [],
            fonts: [],
            products: [],
            catalogRead: false
          }
        })}
        place="brand"
      />
    )
    expect(screen.getAllByText('Not found')).toHaveLength(3)
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('shows the readers while they read, each failure in its own words, with Try again', () => {
    render(<SetupScreen view={view()} place="brand" />)
    expect(
      screen.getByRole('heading', { name: 'Reading your store' })
    ).toBeVisible()
    expect(screen.getByText('Read your website')).toBeVisible()
    expect(screen.getByText('No ads to read')).toBeVisible()
    expect(screen.getByText('Reading your reviews')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    cleanup()
    const failed = view()
    failed.reading!.steps[0] = reader('site', 'failed', 'transient')
    failed.reading!.steps[1] = reader('catalog', 'failed', 'auth')
    render(<SetupScreen view={failed} place="brand" />)
    expect(
      screen.getByText('Your website did not answer. Try again in a minute.')
    ).toBeVisible()
    expect(
      screen.getByText(
        'Klaviyo refused the key. Reconnect Klaviyo, then try again.'
      )
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  it('says each reader’s reason by its failure', () => {
    expect(readerReason('ads', 'rate_limit')).toBe(
      'The ad library asked us to slow down. Try again in a few minutes.'
    )
    expect(readerReason('reviews', 'auth')).toBe(
      'Your reviews refused us. Try again later.'
    )
    expect(readerReason('history')).toBe(
      'Klaviyo could not be read. Try again.'
    )
    const never = view()
    never.reading!.steps[0] = reader('site', 'not_started')
    expect(readerSteps(never)[0]).toMatchObject({
      state: 'failed',
      text: 'Your website is not read yet'
    })
  })

  it('gives staff no Confirm brand and no Try again', () => {
    const failed = view({ owner: false })
    failed.reading!.steps[0] = reader('site', 'failed')
    render(<SetupScreen view={failed} place="brand" />)
    expect(screen.getByRole('main').querySelectorAll('button')).toHaveLength(0)
  })
})

describe('SetupForm (UI-ONBb)', () => {
  it('moves the focus to the first refused field, its error linked to it', async () => {
    const action = vi.fn(async () => ({
      fields: { website: 'Enter your store’s website, like cedarlane.com.' }
    }))
    render(
      <SetupForm
        action={action}
        label="Save store"
        fields={[
          { name: 'name', label: 'Store name', defaultValue: 'Cedar Lane' },
          { name: 'website', label: 'Website', defaultValue: 'not a site' }
        ]}
      />
    )
    const button = screen.getByRole('button', { name: 'Save store' })
    await waitFor(() => expect(button).toBeEnabled())
    await act(async () => fireEvent.click(button))
    const website = screen.getByLabelText('Website')
    await waitFor(() => expect(website).toHaveFocus())
    expect(website).toHaveAttribute('aria-invalid', 'true')
    expect(website).toHaveAccessibleDescription(
      'Enter your store’s website, like cedarlane.com.'
    )
    // What was typed stays to be fixed.
    expect(website).toHaveValue('not a site')
  })
})
