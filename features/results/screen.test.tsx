import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/font/google', () => ({
  Urbanist: () => ({ variable: 'urbanist-variable' })
}))
import type { ResultLine } from './read-model'
import { resultsScreen } from './results-screen'
import { ResultsScreen, rowDetails } from './screen'

afterEach(cleanup)

const place = { currency: 'USD', timezone: 'UTC' }
const totals = {
  recipients: 1240,
  opens: 471,
  clicks: 26,
  orders: 9,
  revenue: 412,
  openRate: 0.38,
  clickRate: 0.021
}
const line = (over: Partial<ResultLine> = {}): ResultLine => ({
  buildId: 'b1',
  subject: '20% off knitwear',
  plannedDay: '2026-11-17',
  emailType: 'offer',
  status: 'sent',
  statusText: 'Sent',
  sentAt: '2026-11-17T18:00:00Z',
  final: true,
  complete: true,
  sample: false,
  totals,
  ab: null,
  topSection: { block: 'product_feature', clicks: 14 },
  ...over
})

describe('the Results screen (UI-RES-b)', () => {
  it('says the results did not open, with one button to try again', () => {
    render(<ResultsScreen view={resultsScreen(null, place)} />)
    expect(
      screen.getByRole('heading', { name: 'Results did not open' })
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute(
      'href',
      '/results'
    )
  })

  it('sends a store with no email yet to plan its next 15 days', () => {
    render(<ResultsScreen view={resultsScreen([], place)} />)
    expect(
      screen.getByRole('heading', { name: 'No results yet' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Plan next 15 days' })
    ).toHaveAttribute('href', '/plan')
  })

  it('shows each email with its numbers, its pill and every A versus B result', () => {
    const view = resultsScreen(
      [
        line({
          ab: {
            a: { ...totals, clickRate: 0.018 },
            b: { ...totals, clickRate: 0.024 },
            verdict: 'b'
          }
        }),
        line({
          buildId: 'b2',
          subject: 'Cedar, for cold nights',
          sample: true,
          statusText: 'Sent'
        })
      ],
      place
    )
    render(<ResultsScreen view={view} />)
    const rows = within(screen.getByRole('list', { name: 'Every email' }))
    expect(rows.getByText('20% off knitwear')).toBeInTheDocument()
    expect(
      rows.getByText(
        'Tue 17 · Sent · 1,240 sent · 38% opened · 2.1% clicked · $412 from 9 orders · The products got the most clicks (14).'
      )
    ).toBeInTheDocument()
    // A sample is never In Klaviyo, and never counted as sent.
    expect(rows.getAllByText('In Klaviyo')).toHaveLength(1)
    expect(rows.getByText('Planned')).toBeInTheDocument()
    expect(rows.getByText(/Sample: not sent/)).toBeInTheDocument()
    const counts = screen.getByRole('region', {
      name: 'Your emails in Klaviyo'
    })
    expect(within(counts).getByText('email sent')).toBeInTheDocument()
    expect(
      screen.getByText('Version B got more clicks: 2.4% against 1.8%.')
    ).toBeInTheDocument()
  })

  it('says when no email has two versions, and writes numbers Klaviyo did not give as nothing', () => {
    render(<ResultsScreen view={resultsScreen([line()], place)} />)
    expect(
      screen.getByText('No email has two versions yet.')
    ).toBeInTheDocument()
    const [email] = (
      resultsScreen(
        [
          line({
            totals: { ...totals, orders: null, revenue: null, openRate: null }
          })
        ],
        place
      ) as Extract<ReturnType<typeof resultsScreen>, { kind: 'results' }>
    ).emails
    expect(rowDetails(email!)).toEqual([
      'Tue 17',
      'Sent',
      '1,240 sent',
      '2.1% clicked',
      'The products got the most clicks (14).'
    ])
  })
})
