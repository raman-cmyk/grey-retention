import { cleanup, render, screen, within } from '@testing-library/react'
import type { Route } from 'next'
import { afterEach, describe, expect, it } from 'vitest'
import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import { formatMoney, revenueSummary } from '@/features/klaviyo-data/summary'
import {
  KlaviyoDataCard,
  klaviyoTabs,
  parseTab,
  type KlaviyoTab
} from './klaviyo-card'

afterEach(cleanup)
const now = new Date('2026-11-06T12:00:00Z')
const snapshot = sampleKlaviyoSnapshot({ now, timezone: 'Australia/Sydney' })
const tabHrefs = Object.fromEntries(
  klaviyoTabs.map((t) => [t, `/dashboard?tab=${t}&attr=utm#klaviyo-data`])
) as unknown as Record<KlaviyoTab, Route>
const credits = {
  plan: 'Sample plan',
  renewsInDays: 30,
  used: 2500,
  included: 10000,
  sample: true
}
const card = (tab: KlaviyoTab, links = {}, withCredits = true) =>
  render(
    <KlaviyoDataCard
      snapshot={snapshot}
      tab={tab}
      tabHrefs={tabHrefs}
      timezone="Australia/Sydney"
      credits={withCredits ? credits : null}
      links={links}
    />
  )

describe('Detailed Klaviyo data card', () => {
  it('accepts only known tabs', () => {
    expect(parseTab('flows')).toBe('flows')
    expect(parseTab(['segments'])).toBe('segments')
    expect(parseTab('admin')).toBe('overview')
  })

  it('shows tabs as links that keep page state, the current one marked', () => {
    card('overview')
    const nav = screen.getByRole('navigation', { name: 'Klaviyo data' })
    const links = within(nav).getAllByRole('link')
    expect(links).toHaveLength(6)
    expect(links[0]).toHaveAttribute('aria-current', 'page')
    expect(links[4]).toHaveAttribute(
      'href',
      '/dashboard?tab=flows&attr=utm#klaviyo-data'
    )
  })

  it('shows the chart and account on Overview; credits on every tab, if allowed', () => {
    card('overview')
    const summary = revenueSummary(snapshot)
    const chart = screen.getByRole('region', {
      name: 'Revenue in the last 30 days'
    })
    expect(chart).toHaveTextContent(formatMoney(summary.total))
    expect(chart.querySelectorAll('[data-best]')).toHaveLength(1)
    expect(within(chart).getByRole('img')).toHaveAccessibleName(/Sydney time/)
    expect(screen.getByRole('region', { name: 'Account' })).toHaveTextContent(
      'Sydney time'
    )
    expect(
      screen.getByRole('region', { name: 'AI credits' })
    ).toBeInTheDocument()
    cleanup()
    card('flows')
    expect(
      screen.queryByRole('region', { name: 'Revenue in the last 30 days' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'AI credits' })
    ).toBeInTheDocument()
    cleanup()
    card('flows', {}, false)
    expect(
      screen.queryByRole('region', { name: 'AI credits' })
    ).not.toBeInTheDocument()
  })

  it('sorts campaigns newest first, with time and timezone', () => {
    card('campaigns')
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).toHaveTextContent('Holiday gift guide')
    expect(rows.at(-1)).toHaveTextContent('Not scheduled')
    expect(screen.getByText(/times in Sydney time/)).toBeInTheDocument()
    expect(rows[0]).toHaveTextContent(/· \d+:\d\d [AP]M/)
    expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent(
      'Holiday gift guide'
    )
  })

  it('names the flow trigger and adds profile counts to segments (§3 fixes)', () => {
    card('flows')
    expect(screen.getByText('Metric: Started Checkout')).toBeInTheDocument()
    cleanup()
    card('segments')
    expect(
      screen.getByRole('columnheader', { name: 'Profiles' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Starred' })).toHaveLength(2)
  })

  it('links rows only to detail pages that exist; Klaviyo campaigns get their own path', () => {
    card('lists')
    expect(
      screen.queryByRole('link', { name: 'Newsletter' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('columnheader', { name: 'Open' })
    ).not.toBeInTheDocument()
    cleanup()
    card('campaigns', { campaigns: true })
    expect(
      screen.getByRole('link', { name: 'Spring restock' })
    ).toHaveAttribute('href', '/campaigns/klaviyo/CMPspr001?from=campaigns')
    expect(
      screen.getByRole('columnheader', { name: 'Open' })
    ).toBeInTheDocument()
  })
})
