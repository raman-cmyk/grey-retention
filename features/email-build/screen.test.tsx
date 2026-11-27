import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    const open = screen.getByRole('link', { name: /^Open in Klaviyo/ })
    expect(open).toHaveAttribute('href', 'https://www.klaviyo.com/campaigns')
    expect(open).toHaveAttribute('target', '_blank')
    expect(
      screen.getByText(
        /^In Klaviyo’s campaigns, it is called “Bestseller: Cedar candle”\./
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
    expect(screen.queryByRole('link', { name: /Open in Klaviyo/ })).toBeNull()
    // Not even in the run log.
    expect(screen.queryByText(/in Klaviyo as a draft/i)).toBeNull()
    expect(
      screen.getByText('Kept it as a sample draft (Klaviyo is not connected)')
    ).toBeInTheDocument()
  })

  it('says a real draft waits in Klaviyo for the owner to schedule it', () => {
    render(<EmailScreen view={emailScreen(row())} />)
    expect(screen.getByText(/you schedule it in Klaviyo/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /opens in a new tab/ })
    ).toBeInTheDocument()
  })

  it('says in plain words what the owner did with the draft in Klaviyo (PICK-99)', () => {
    const state = (over: Record<string, unknown>) => ({
      status: 'scheduled' as const,
      edited: false,
      scheduledFor: '2027-01-14T09:00:00Z',
      sendStrategy: 'static',
      sentAt: null,
      checkedAt: null,
      ...over
    })
    const { unmount } = render(
      <EmailScreen
        view={emailScreen(
          row({ klaviyoState: state({ edited: true }), timezone: 'UTC' })
        )}
      />
    )
    expect(
      screen.getByText(
        'Scheduled in Klaviyo for 14 Jan 2027, 9:00 (store time) · Edited in Klaviyo'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('In Klaviyo')).toBeInTheDocument()
    expect(
      screen.getByText(/GROS will not replace your changes/)
    ).toBeInTheDocument()
    // No longer a draft waiting for him.
    expect(screen.queryByText(/you schedule it in Klaviyo/)).toBeNull()
    unmount()
    render(
      <EmailScreen
        view={emailScreen(
          row({
            klaviyoState: state({ status: 'deleted', scheduledFor: null }),
            timezone: 'UTC'
          })
        )}
      />
    )
    expect(screen.getByText('Deleted in Klaviyo')).toBeInTheDocument()
    // None of BRAND.md's four statuses is true for a deleted draft.
    expect(screen.queryByText('In Klaviyo')).toBeNull()
    expect(screen.getByText(/GROS will not put it back/)).toBeInTheDocument()
  })

  it('shows an email being put into Klaviyo as working, with the way back', () => {
    render(
      <EmailScreen
        view={emailScreen(
          row({ state: 'push_queued', klaviyoCampaignId: null })
        )}
      />
    )
    expect(screen.getByText('Adding to Klaviyo')).toBeInTheDocument()
    expect(screen.queryByText('In Klaviyo')).toBeNull()
    expect(screen.queryByRole('link', { name: /Open in Klaviyo/ })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Back to the plan' })
    ).toBeInTheDocument()
  })

  it('shows designs A and B each with its own views, and subject B', () => {
    render(
      <EmailScreen
        view={emailScreen(
          row({
            email: email({ designA: '<p>A</p>', subjectB: 'Other words' })
          })
        )}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Design A' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Design B' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Dark' })).toHaveLength(2)
    // One test an email: the design test, not the subject test.
    expect(screen.queryByText('Other words')).toBeNull()
  })

  it('shows subject B when the subject is the test', () => {
    render(
      <EmailScreen
        view={emailScreen(row({ email: email({ subjectB: 'Other words' }) }))}
      />
    )
    expect(
      screen.getByText('Subject B (half the audience)')
    ).toBeInTheDocument()
    expect(screen.getByText('Other words')).toBeInTheDocument()
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

  it('says a made email that stopped on the way was not put in Klaviyo', () => {
    render(
      <EmailScreen
        view={emailScreen(
          row({
            state: 'failed',
            klaviyoCampaignId: null,
            reason: 'Klaviyo did not answer.'
          })
        )}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'This email was not put in Klaviyo' })
    ).toBeInTheDocument()
    expect(screen.getByTitle('The email, desktop view')).toBeInTheDocument()
  })

  it('says a draft it cannot read is in Klaviyo, and opens Klaviyo', () => {
    render(<EmailScreen view={emailScreen(row({ email: { name: 'old' } }))} />)
    expect(
      screen.getByRole('heading', { name: 'This email can’t be shown' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /^Open in Klaviyo/ })
    ).toBeInTheDocument()
  })

  it('turns a design’s colours around for the dark view, after everything', () => {
    const dark = darkDocument('<html><head></head><body>x</body></html>')
    expect(dark.startsWith('<html><head></head><body>x</body></html>')).toBe(
      true
    )
    expect(dark).toMatch(/<style>[^<]*invert\(1\)[^<]*<\/style>$/)
  })

  it('switches the frame to the dark view when Dark is pressed', () => {
    render(<EmailScreen view={emailScreen(row())} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    const frame = screen.getByTitle('The email, dark view')
    expect(frame.getAttribute('srcdoc')).toMatch(/invert\(1\)/)
    expect(frame).toHaveAttribute('sandbox', '')
    expect(
      screen.getByText(/Roughly how an inbox in dark mode/)
    ).toBeInTheDocument()
  })
})
