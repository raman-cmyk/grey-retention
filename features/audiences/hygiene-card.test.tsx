import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./hygiene-actions', () => ({
  saveListHygiene: vi.fn(),
  retryListHygiene: vi.fn()
}))
vi.mock('@/features/klaviyo-data/reader', () => ({ klaviyoData: vi.fn() }))

import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import { HygieneCard } from './hygiene-card'
import { hygieneView } from './hygiene-view'

afterEach(cleanup)
const now = new Date('2026-11-27T12:00:00Z')
const sample = {
  state: 'sample' as const,
  snapshot: sampleKlaviyoSnapshot({ now, timezone: 'UTC' }),
  shopify: 'missing' as const
}
const on = { enabled: true, days: 180 }

describe('hygieneView', () => {
  it('counts the sample store, saying it is sample data', () => {
    expect(
      hygieneView({
        settings: on,
        revision: 2,
        data: sample,
        stored: null,
        now
      })
    ).toMatchObject({
      state: 'ready',
      enabled: true,
      days: 180,
      revision: 2,
      number: '850',
      words:
        '850 people left out: 310 bounced, 540 with no clicks, opens, site visits or orders in 180 days',
      source: 'Sample data: 15,670 of 16,520 people can get an email.'
    })
  })

  it('uses the size Klaviyo gives GROS’s segment, and says what it cannot count', () => {
    expect(
      hygieneView({
        settings: on,
        revision: 0,
        data: { state: 'unavailable' },
        stored: { state: 'ready', profileCount: 930, reason: null },
        now
      })
    ).toMatchObject({
      number: '930',
      words:
        '930 people with no clicks, opens, site visits or orders in 180 days. Klaviyo also skips everyone who bounced or is suppressed.'
    })
  })

  it('never makes a number up', () => {
    const view = (stored: Parameters<typeof hygieneView>[0]['stored']) => {
      const v = hygieneView({
        settings: on,
        revision: 0,
        data: null,
        stored,
        now
      })
      if (v.state !== 'ready') throw new Error('not ready')
      return v
    }
    expect(view(null)).toMatchObject({
      number: null,
      words: 'Counted when GROS puts its next email in Klaviyo.'
    })
    expect(
      view({ state: 'ready', profileCount: null, reason: null }).number
    ).toBeNull()
    expect(
      view({ state: 'failed', profileCount: null, reason: 'missing_scope' })
        .words
    ).toMatch(/cannot make segments/)
    expect(
      hygieneView({
        settings: { enabled: false, days: 180 },
        revision: 1,
        data: null,
        stored: null,
        now
      })
    ).toMatchObject({
      enabled: false,
      number: null,
      words: 'Klaviyo skips people who bounced or are suppressed.'
    })
  })
})

describe('HygieneCard', () => {
  const view = hygieneView({
    settings: on,
    revision: 2,
    data: sample,
    stored: null,
    now
  })

  it('shows the owner the number, the words and the setting', () => {
    render(<HygieneCard view={view} owner />)
    expect(screen.getByRole('heading', { name: 'Left out' })).toBeTruthy()
    expect(screen.getByText('850')).toBeTruthy()
    expect(
      screen.getByText(
        '850 people left out: 310 bounced, 540 with no clicks, opens, site visits or orders in 180 days'
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        'Every open counts for now, Apple Mail’s automatic opens too.'
      )
    ).toBeTruthy()
    expect(
      (screen.getByLabelText(/^Days with no clicks/) as HTMLInputElement).value
    ).toBe('180')
    expect(screen.getByRole('button', { name: 'Save days' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeTruthy()
  })

  it('shows staff the words without the setting', () => {
    render(<HygieneCard view={view} owner={false} />)
    expect(screen.getByText('850')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('The store’s owner changes this.')).toBeTruthy()
  })

  it('says when it could not be read', () => {
    render(<HygieneCard view={{ state: 'unavailable' }} owner />)
    expect(screen.getByText(/could not be read just now/)).toBeTruthy()
  })

  it('a segment deleted in Klaviyo is said, and made again only when asked', () => {
    const deleted = hygieneView({
      settings: on,
      revision: 1,
      data: null,
      stored: {
        state: 'deleted',
        profileCount: null,
        reason: 'segment_deleted'
      },
      now
    })
    render(<HygieneCard view={deleted} owner />)
    expect(screen.getByText(/deleted in Klaviyo/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make it again' })).toBeTruthy()
  })

  it('Save days keeps hygiene off when it is off', () => {
    const off = hygieneView({
      settings: { enabled: false, days: 90 },
      revision: 3,
      data: sample,
      stored: null,
      now
    })
    const { container } = render(<HygieneCard view={off} owner />)
    const save = screen.getByRole('button', { name: 'Save days' })
    const enabled = save
      .closest('form')!
      .querySelector('input[name="enabled"]') as HTMLInputElement
    expect(enabled.value).toBe('off')
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy()
    expect(container).toBeTruthy()
  })
})

describe('the card on Audiences', () => {
  const view = hygieneView({
    settings: on,
    revision: 0,
    data: sample,
    stored: null,
    now
  })
  it('shows above the segments, and not before Klaviyo is connected', async () => {
    const { AudiencesScreen } = await import('./screen')
    render(
      <AudiencesScreen
        view={{
          state: 'ready',
          source: 'Sample data',
          segments: [],
          lists: []
        }}
        owner
        hygiene={view}
      />
    )
    expect(screen.getByRole('heading', { name: 'Left out' })).toBeTruthy()
    cleanup()
    render(
      <AudiencesScreen view={{ state: 'not_connected' }} owner hygiene={view} />
    )
    expect(screen.queryByRole('heading', { name: 'Left out' })).toBeNull()
  })
})
