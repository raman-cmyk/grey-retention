import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { emailScreen } from './email-screen'
import { darkDocument } from './email-views'
import { EmailScreen } from './screen'

afterEach(cleanup)

const email = (over: Record<string, unknown> = {}) => ({
  sample: false,
  ai: true,
  name: 'Bestseller: Cedar candle',
  subject: 'Our cedar candle is back',
  preheader: 'Warm nights start here.',
  html: '<p>B</p>',
  approach: 'A',
  copy: 'written',
  plannedSendAt: '2026-11-20T18:00:00Z',
  audienceId: 'a1',
  productIds: ['p1'],
  code: null,
  changes: [],
  ...over
})
const row = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  state: 'drafted',
  step: 'push',
  email: email(),
  format: 'designed' as const,
  klaviyoCampaignId: 'kc1',
  sampleDraft: false,
  reason: null,
  ...over
})

describe('an email’s page (UI-EMAIL-b)', () => {
  it('shows a real draft with its subject, views and Open in Klaviyo', () => {
    render(<EmailScreen view={emailScreen(row())} />)
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Bestseller: Cedar candle'
      })
    ).toBeInTheDocument()
    expect(screen.getByText('Our cedar candle is back')).toBeInTheDocument()
    expect(screen.getByText('In Klaviyo')).toBeInTheDocument()
    const open = screen.getByRole('link', { name: 'Open in Klaviyo' })
    expect(open).toHaveAttribute('href', 'https://www.klaviyo.com/campaigns')
    expect(open).toHaveAttribute('target', '_blank')
    expect(
      screen.getByText(
        'In Klaviyo’s campaigns, it is called “Bestseller: Cedar candle”.'
      )
    ).toBeInTheDocument()
    for (const v of ['Desktop', 'Phone', 'Dark'])
      expect(screen.getByRole('button', { name: v })).toBeInTheDocument()
    expect(screen.getByTitle('The email, desktop view')).toBeInTheDocument()
  })

  it('never calls a sample draft In Klaviyo, and offers no Klaviyo link', () => {
    render(<EmailScreen view={emailScreen(row({ sampleDraft: true }))} />)
    expect(screen.queryByText('In Klaviyo')).toBeNull()
    expect(screen.getByText('Planned')).toBeInTheDocument()
    expect(screen.getByText(/this is a sample draft/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Open in Klaviyo' })).toBeNull()
  })

  it('shows a text email’s plain text, and the steps while one is made', () => {
    const { rerender } = render(
      <EmailScreen
        view={emailScreen(
          row({
            email: email({ format: 'text', text: 'Hi,\nA note from me.' })
          })
        )}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Its plain text' })
    ).toBeInTheDocument()
    expect(screen.getByText('Text email')).toBeInTheDocument()
    rerender(
      <EmailScreen
        view={emailScreen(
          row({
            state: 'build_queued',
            step: 'design',
            email: null,
            format: 'text'
          })
        )}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Creating your text email' })
    ).toBeInTheDocument()
    expect(screen.getByText('Laying out the letter')).toBeInTheDocument()
  })

  it('says why an email stopped, with the way back to the plan', () => {
    render(
      <EmailScreen
        view={emailScreen(
          row({
            state: 'failed',
            step: 'design',
            email: null,
            reason: 'Its design could not be drawn.'
          })
        )}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'This email was not made' })
    ).toBeInTheDocument()
    expect(
      screen.getByText('Its design could not be drawn.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Back to the plan' })
    ).toHaveAttribute('href', '/plan')
  })

  it('says a draft it cannot read is in Klaviyo, and opens Klaviyo', () => {
    render(<EmailScreen view={emailScreen(row({ email: { name: 'old' } }))} />)
    expect(
      screen.getByRole('heading', { name: 'This email can’t be shown' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Open in Klaviyo' })
    ).toBeInTheDocument()
  })

  it('turns a design’s colours around for the dark view, inside its head', () => {
    expect(darkDocument('<html><head></head><body>x</body></html>')).toBe(
      '<html><head><style>html{background:#121212}body{filter:invert(1) hue-rotate(180deg)}img{filter:invert(1) hue-rotate(180deg)}</style></head><body>x</body></html>'
    )
    expect(darkDocument('<p>x</p>').endsWith('<p>x</p>')).toBe(true)
  })
})
