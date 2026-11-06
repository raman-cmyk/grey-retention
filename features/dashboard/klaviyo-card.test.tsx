import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { sampleKlaviyoSnapshot } from '@/features/klaviyo-data/fixture'
import { formatMoney, revenueSummary } from '@/features/klaviyo-data/summary'
import { KlaviyoDataCard, parseTab, type KlaviyoTab } from './klaviyo-card'

afterEach(cleanup)
const now = new Date('2026-11-06T12:00:00Z')
const snapshot = sampleKlaviyoSnapshot({ now, timezone: 'Australia/Sydney' })
const credits = {
  plan: 'Sample plan',
  renewsInDays: 30,
  used: 2500,
  included: 10000,
  sample: true
}
const card = (tab: KlaviyoTab, links = {}) =>
  render(
    <KlaviyoDataCard
      snapshot={snapshot}
      tab={tab}
      credits={credits}
      links={links}
    />
  )

describe('Detailed Klaviyo data card', () => {
  it('accepts only known tabs', () => {
    expect(parseTab('flows')).toBe('flows')
    expect(parseTab(['segments'])).toBe('segments')
    expect(parseTab('admin')).toBe('overview')
    expect(parseTab(undefined)).toBe('overview')
  })

  it('shows tabs as links with counts, the current one marked', () => {
    card('overview')
    const nav = screen.getByRole('navigation', { name: 'Klaviyo data' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual([
      'Overview',
      `Lists${snapshot.lists.length}`,
      `Segments${snapshot.segments.length}`,
      `Campaigns${snapshot.campaigns.length}`,
      `Flows${snapshot.flows.length}`,
      `Metrics${snapshot.metrics.length}`
    ])
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links[4]).toHaveAttribute(
      'href',
      '/dashboard?tab=flows#klaviyo-data'
    )
  })

  it('shows the revenue chart, account and AI credits on Overview only', () => {
    card('overview')
    const summary = revenueSummary(snapshot)
    const chart = screen.getByRole('region', {
      name: 'Revenue in the last 30 days'
    })
    expect(chart).toHaveTextContent(formatMoney(summary.total))
    expect(chart.querySelectorAll('[data-best]')).toHaveLength(1)
    expect(within(chart).getAllByRole('row')).toHaveLength(31)
    expect(screen.getByRole('region', { name: 'Account' })).toHaveTextContent(
      'pk_SAMP••••••••0000'
    )
    expect(
      screen.getByRole('region', { name: 'AI credits' })
    ).toHaveTextContent('(sample numbers)')
    expect(
      screen.getByText(/Full detail pages for each row are coming next/)
    ).toBeInTheDocument()
    cleanup()
    card('flows')
    expect(
      screen.queryByRole('region', { name: 'Revenue in the last 30 days' })
    ).not.toBeInTheDocument()
  })

  it('sorts campaigns newest first and totals the same revenue as the KPIs', () => {
    card('campaigns')
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Holiday gift guide')
    expect(rows.at(-1)).toHaveTextContent('Not scheduled')
    expect(
      screen.getByText(formatMoney(revenueSummary(snapshot).campaigns))
    ).toBeInTheDocument()
  })

  it('names the flow trigger and adds profile counts to segments (§3 fixes)', () => {
    card('flows')
    expect(screen.getByText('Metric: Started Checkout')).toBeInTheDocument()
    expect(screen.getByText('Added to list: Newsletter')).toBeInTheDocument()
    cleanup()
    card('segments')
    expect(
      screen.getByRole('columnheader', { name: 'Profiles' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Starred' })).toHaveLength(2)
    expect(screen.getAllByText('Active').length).toBe(snapshot.segments.length)
  })

  it('links rows only to detail pages that exist', () => {
    card('lists')
    expect(
      screen.queryByRole('link', { name: 'Newsletter' })
    ).not.toBeInTheDocument()
    cleanup()
    card('lists', { lists: true })
    expect(screen.getByRole('link', { name: 'Newsletter' })).toHaveAttribute(
      'href',
      '/lists/LSTnews01?from=lists'
    )
  })
})
