import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./hygiene-actions', () => ({ saveListHygiene: vi.fn() }))
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
      number: '1,240',
      words:
        '1,240 people left out: 310 bounced, 930 with no clicks, site visits or orders in 180 days',
      source: 'Sample data: 15,280 of 16,520 people can get an email.'
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
        '930 people with no clicks, site visits or orders in 180 days. Klaviyo also skips everyone who bounced or is suppressed.'
    })
  })

  it('never makes a number up', () => {
    const view = (stored: Parameters<typeof hygieneView>[0]['stored']) =>
      hygieneView({ settings: on, revision: 0, data: null, stored, now })
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
    expect(screen.getByText('1,240')).toBeTruthy()
    expect(
      screen.getByText(
        '1,240 people left out: 310 bounced, 930 with no clicks, site visits or orders in 180 days'
      )
    ).toBeTruthy()
    expect(
      screen.getByText('Apple Mail privacy opens do not count as opens.')
    ).toBeTruthy()
    expect(
      (screen.getByLabelText(/^Days with no clicks/) as HTMLInputElement).value
    ).toBe('180')
    expect(screen.getByRole('button', { name: 'Save days' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeTruthy()
  })

  it('shows staff the words without the setting', () => {
    render(<HygieneCard view={view} owner={false} />)
    expect(screen.getByText('1,240')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('The store’s owner changes this.')).toBeTruthy()
  })

  it('says when it could not be read', () => {
    render(<HygieneCard view={{ state: 'unavailable' }} owner />)
    expect(screen.getByText(/could not be read just now/)).toBeTruthy()
  })
})
