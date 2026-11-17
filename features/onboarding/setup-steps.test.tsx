import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./setup-actions', () => ({
  connectSetupKlaviyo: vi.fn(async () => ({})),
  saveSetupDiscount: vi.fn(async () => ({})),
  addSetupCode: vi.fn(async () => ({})),
  followRival: vi.fn(async () => ({})),
  followSuggestion: vi.fn(async () => ({})),
  hideRival: vi.fn(async () => ({})),
  skipRivals: vi.fn(async () => ({})),
  finishSetup: vi.fn(async () => ({}))
}))

import type { KlaviyoState } from '@/features/settings/read-model'
import type { SetupView } from './flow'
import { setupFlow } from './flow-model'
import type { SetupRivals } from './rivals'
import {
  DiscountStep,
  FinishStep,
  KlaviyoStep,
  RivalsStep
} from './setup-steps'

afterEach(cleanup)

const klaviyo = (over: Partial<KlaviyoState> = {}): KlaviyoState => ({
  status: 'connected',
  mode: 'sample',
  keyStatus: null,
  accountLabel: 'Cedar Lane sample',
  keyHint: 'pk_abc••••wxyz',
  checkedAt: null,
  missingLater: [],
  ...over
})
function view(over: Partial<SetupView> = {}): SetupView {
  return {
    state: 'ready',
    owner: true,
    workspaceName: 'Cedar Lane',
    timezone: 'America/New_York',
    flow: setupFlow({
      domain: 'cedarlane.example',
      confirmedSite: 'cedarlane.example',
      klaviyoWorking: false,
      maxDiscountSet: false,
      following: 0,
      rivalsSkipped: false,
      finished: false
    }),
    brand: {
      name: 'Cedar Lane',
      domain: 'cedarlane.example',
      revision: 2,
      voice: '',
      prohibitions: ''
    },
    klaviyo: klaviyo({ status: 'none', accountLabel: null, keyHint: null }),
    liveKeys: false,
    keyCheck: 'sample',
    offers: {
      maxDiscountPercent: null,
      grossMarginPercent: null,
      marginFloorPercent: null,
      revision: 0,
      codes: []
    },
    found: null,
    reading: null,
    ...over
  }
}

describe('KlaviyoStep (UI-ONBd)', () => {
  it('asks the owner for the key, as a password, in sample mode words', () => {
    render(<KlaviyoStep view={view()} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Connect Klaviyo' })
    ).toBeVisible()
    const key = screen.getByLabelText('Private API key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveAttribute('autocomplete', 'off')
    expect(
      screen.getByRole('button', { name: 'Connect Klaviyo' })
    ).toBeVisible()
    expect(screen.getByText(/we check the key’s format only/)).toBeVisible()
  })

  it('shows a working connection by its masked hint, with Continue', () => {
    render(<KlaviyoStep view={view({ klaviyo: klaviyo() })} />)
    expect(screen.getByText('Cedar Lane sample')).toBeVisible()
    expect(screen.getByText('pk_abc••••wxyz')).toBeVisible()
    expect(
      screen.getByText('Sample data. Nothing is sent to Klaviyo.')
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/setup'
    )
    expect(screen.queryByLabelText('Private API key')).toBeNull()
  })

  it('says what is wrong and asks to reconnect: a refused key, or a sample once keys are live', () => {
    render(
      <KlaviyoStep
        view={view({
          klaviyo: klaviyo({ mode: 'live', keyStatus: 'refused' }),
          liveKeys: true,
          keyCheck: 'live'
        })}
      />
    )
    expect(
      screen.getByText('Klaviyo key stopped working. Reconnect with a new key.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeVisible()
    expect(
      screen.getByText('We check the key with Klaviyo, then keep it encrypted.')
    ).toBeVisible()
    cleanup()
    render(
      <KlaviyoStep
        view={view({ klaviyo: klaviyo(), liveKeys: true, keyCheck: 'live' })}
      />
    )
    expect(
      screen.getByText(
        'Sample connection. Paste your real key to connect your Klaviyo.'
      )
    ).toBeVisible()
  })

  it('says when connecting is not switched on (live adapters, no live Klaviyo)', () => {
    render(<KlaviyoStep view={view({ keyCheck: 'off' })} />)
    expect(
      screen.getByText(
        'Connecting Klaviyo is not switched on yet. Nothing was changed.'
      )
    ).toBeVisible()
    expect(screen.queryByLabelText('Private API key')).toBeNull()
    expect(screen.queryByText(/Sample mode/)).toBeNull()
  })

  it('gives staff the state only', () => {
    render(<KlaviyoStep view={view({ owner: false })} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByLabelText('Private API key')).toBeNull()
  })
})

describe('DiscountStep (UI-ONBd)', () => {
  it('asks for the biggest discount, filled in, with the revision the page read', () => {
    const { container } = render(
      <DiscountStep
        view={view({
          offers: {
            maxDiscountPercent: 20,
            grossMarginPercent: null,
            marginFloorPercent: null,
            revision: 3,
            codes: []
          }
        })}
      />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your discount' })
    ).toBeVisible()
    expect(screen.getByLabelText('Biggest discount, in percent')).toHaveValue(
      '20'
    )
    expect(container.querySelector('input[name="revision"]')).toHaveValue('3')
    expect(screen.getByRole('button', { name: 'Save discount' })).toBeVisible()
    expect(
      screen.getByText('No codes yet. Emails will not mention a code.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add code' })).toBeVisible()
  })

  it('lists the codes still running, and says when one is above the biggest discount', () => {
    render(
      <DiscountStep
        view={view({
          offers: {
            maxDiscountPercent: 15,
            grossMarginPercent: null,
            marginFloorPercent: null,
            revision: 1,
            codes: [
              {
                id: 'c1',
                code: 'WELCOME10',
                percent: 10,
                expiresAt: null,
                ended: false
              },
              {
                id: 'c2',
                code: 'BIG25',
                percent: 25,
                expiresAt: '2026-12-31T23:00:00Z',
                ended: false
              },
              {
                id: 'c3',
                code: 'OLD5',
                percent: 5,
                expiresAt: '2026-01-01T00:00:00Z',
                ended: true
              }
            ]
          }
        })}
      />
    )
    expect(screen.getByText('WELCOME10')).toBeVisible()
    expect(screen.getByText('10% off · No end date')).toBeVisible()
    expect(
      screen.getByText(/25% off · Until .* · Above your biggest discount/)
    ).toBeVisible()
    expect(screen.queryByText('OLD5')).toBeNull()
  })

  it('gives staff the saved discount only', () => {
    render(<DiscountStep view={view({ owner: false })} />)
    expect(screen.getByText('Not set')).toBeVisible()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

const rivals = (over: Partial<SetupRivals> = {}): SetupRivals => ({
  sample: true,
  following: [],
  suggestions: [
    {
      captureId: 'cap-1',
      domain: 'northwind.example',
      name: 'Northwind',
      industry: 'apparel',
      reason: 'Sells apparel like you',
      followable: true
    },
    {
      captureId: 'cap-2',
      domain: 'realbrand.com',
      name: 'Real Brand',
      industry: 'apparel',
      reason: 'Sells apparel like you',
      followable: false
    }
  ],
  ...over
})

describe('RivalsStep (UI-ONBe)', () => {
  it('suggests brands like the store with Follow (sample brands only) and Hide, and a website field', () => {
    render(<RivalsStep view={view()} rivals={rivals()} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Your rivals' })
    ).toBeVisible()
    expect(screen.getByText('Northwind')).toBeVisible()
    // Each row's buttons say the brand's name to a screen reader.
    expect(
      screen.getByRole('button', { name: 'Follow: Northwind' })
    ).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Follow: Real Brand' })
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Hide: Real Brand' })
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Follow' })).toBeVisible()
    expect(screen.getByLabelText('A brand’s website')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Continue' })).toBeNull()
  })

  it('offers Follow only while there is room for another brand', () => {
    render(
      <RivalsStep
        view={view()}
        rivals={rivals({
          following: Array.from({ length: 10 }, (_, i) => `b${i}.example`)
        })}
      />
    )
    expect(screen.queryByRole('button', { name: /^Follow/ })).toBeNull()
    expect(screen.queryByLabelText('A brand’s website')).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Hide: Northwind' })
    ).toBeVisible()
  })

  it('gives a real store no website field (real brands are not followed yet)', () => {
    render(
      <RivalsStep
        view={view()}
        rivals={rivals({ sample: false, suggestions: [] })}
      />
    )
    expect(screen.queryByLabelText('A brand’s website')).toBeNull()
    expect(screen.getByText('No brands to suggest yet.')).toBeVisible()
  })

  it('lists the brands followed, with Continue', () => {
    render(
      <RivalsStep
        view={view()}
        rivals={rivals({ following: ['northwind.example'] })}
      />
    )
    expect(screen.getByText('northwind.example')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute(
      'href',
      '/setup'
    )
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
  })

  it('says when rivals or suggestions cannot be read, and gives staff no buttons', () => {
    render(<RivalsStep view={view()} rivals={null} />)
    expect(
      screen.getByText(/Your rivals could not be read just now/)
    ).toBeVisible()
    cleanup()
    render(<RivalsStep view={view()} rivals={rivals({ suggestions: null })} />)
    expect(
      screen.getByText('Suggestions could not be read just now.')
    ).toBeVisible()
    cleanup()
    render(<RivalsStep view={view({ owner: false })} rivals={rivals()} />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

describe('FinishStep (UI-ONBe)', () => {
  it('sums up what was set, with Finish setup for the owner only', () => {
    render(
      <FinishStep
        view={view({
          klaviyo: klaviyo(),
          offers: {
            maxDiscountPercent: 0,
            grossMarginPercent: null,
            marginFloorPercent: null,
            revision: 1,
            codes: []
          }
        })}
      />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Ready to plan' })
    ).toBeVisible()
    expect(screen.getByText('cedarlane.example')).toBeVisible()
    expect(screen.getByText('Cedar Lane sample')).toBeVisible()
    expect(screen.getByText('0%')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeVisible()
    cleanup()
    render(<FinishStep view={view({ owner: false })} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
