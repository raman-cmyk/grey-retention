import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { sampleKlaviyoSnapshot } from '@/lib/providers/fake-klaviyo-read'
import {
  ApprovalsCard,
  CalendarMiniCard,
  DashboardHeader,
  InsightCard,
  KpiStrip,
  NextCampaignCard,
  RevenueCard
} from './sections'

afterEach(cleanup)
const now = new Date('2026-11-06T12:00:00Z')
const snapshot = sampleKlaviyoSnapshot({ now, timezone: 'UTC' })
const hrefs = {
  klaviyo: '/dashboard?tab=flows',
  utm: '/dashboard?tab=flows&attr=utm'
} as const

describe('dashboard header', () => {
  it('says sample data is sample, with no invented sync and no Refresh', () => {
    render(
      <DashboardHeader
        data={{ state: 'sample', snapshot, shopify: 'missing' }}
        now={now}
      />
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Dashboard' })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Sample Klaviyo data: made up for this preview/)
    ).toBeInTheDocument()
    expect(screen.queryByText(/Last synced/)).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Refresh' })
    ).not.toBeInTheDocument()
  })

  it('explains a missing connection and points to Connections', () => {
    render(
      <DashboardHeader
        data={{ state: 'not_connected', reason: 'expired' }}
        now={now}
      />
    )
    expect(
      screen.getByText(/The Klaviyo connection has expired/)
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Go to Connections' })
    ).toHaveAttribute('href', '/connections')
    cleanup()
    render(<DashboardHeader data={{ state: 'unavailable' }} now={now} />)
    expect(
      screen.getByText(/aren't available in this version yet/)
    ).toBeInTheDocument()
  })
})

describe('dashboard cards', () => {
  it('pairs each KPI label with its value', () => {
    render(
      <KpiStrip
        kpis={[
          {
            label: 'Active subscribers',
            value: '16.5K',
            caption: '↑ 15%',
            trend: 'up'
          }
        ]}
      />
    )
    const term = screen.getByText('Active subscribers')
    expect(term.tagName).toBe('DT')
    expect(term.nextElementSibling).toHaveTextContent('16.5K')
    expect(screen.getByText('↑ 15%').className).toContain('text-success')
  })

  it('keeps the tab when switching attribution, and explains it visibly', () => {
    render(
      <RevenueCard
        attribution="klaviyo"
        hrefs={hrefs}
        value="$1.00"
        utmValue={null}
        goal={null}
        fraction={0}
        shopify="missing"
      />
    )
    expect(screen.getByRole('link', { name: 'UTM' })).toHaveAttribute(
      'href',
      '/dashboard?tab=flows&attr=utm'
    )
    expect(
      screen.getByText(/Klaviyo \$flow and \$campaign attribution/)
    ).toBeInTheDocument()
    expect(screen.getByText('No monthly goal set yet.')).toBeInTheDocument()
  })

  it('never shows the Klaviyo number under the UTM label', () => {
    render(
      <RevenueCard
        attribution="utm"
        hrefs={hrefs}
        value="$1.00"
        utmValue={null}
        goal={null}
        fraction={0}
        shopify="missing"
      />
    )
    expect(screen.queryByText('$1.00')).not.toBeInTheDocument()
    expect(
      screen.getByText('UTM attribution needs Shopify.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Connect Shopify →' })
    ).toBeInTheDocument()
    cleanup()
    render(
      <RevenueCard
        attribution="utm"
        hrefs={hrefs}
        value="$1.00"
        utmValue={null}
        goal={null}
        fraction={0}
        shopify="connected"
      />
    )
    expect(
      screen.getByText("UTM attribution isn't available yet.")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Connect Shopify/ })
    ).not.toBeInTheDocument()
  })

  it('counts down with the timezone, or offers owners to create one', () => {
    render(
      <NextCampaignCard
        next={{
          id: 'b',
          name: 'Soon local',
          at: '2026-11-08T16:00:00Z',
          source: 'workspace',
          href: '/campaigns/b'
        }}
        timezone="Australia/Sydney"
        now={now}
        owner
        campaignsFailed={false}
      />
    )
    expect(screen.getByText('in 2 days 4 hours')).toBeInTheDocument()
    expect(
      screen.getByText(/\(Sydney time\) · In this workspace/)
    ).toBeInTheDocument()
    cleanup()
    render(
      <NextCampaignCard
        next={null}
        timezone="UTC"
        now={now}
        owner
        campaignsFailed={false}
      />
    )
    expect(
      screen.getByRole('link', { name: 'Create a campaign →' })
    ).toHaveAttribute('href', '/first-draft')
    cleanup()
    render(
      <NextCampaignCard
        next={null}
        timezone="UTC"
        now={now}
        owner={false}
        campaignsFailed={false}
      />
    )
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('says so when campaigns could not be loaded, instead of "nothing"', () => {
    render(
      <NextCampaignCard
        next={null}
        timezone="UTC"
        now={now}
        owner
        campaignsFailed
      />
    )
    expect(screen.getByText(/couldn't load your campaigns/)).toBeInTheDocument()
    cleanup()
    render(
      <ApprovalsCard waiting={[]} owner seeAll="/dashboard" campaignsFailed />
    )
    expect(
      screen.queryByText('Nothing needs approval right now.')
    ).not.toBeInTheDocument()
    expect(
      screen.getByText("We couldn't load your campaigns.")
    ).toBeInTheDocument()
    cleanup()
    render(<CalendarMiniCard sends={[]} timezone="UTC" owner campaignsFailed />)
    expect(screen.queryByText(/No upcoming campaigns/)).not.toBeInTheDocument()
  })

  it('lists upcoming sends with the timezone and tags Klaviyo ones', () => {
    render(
      <CalendarMiniCard
        timezone="Australia/Sydney"
        owner
        campaignsFailed={false}
        sends={[
          {
            id: 'b',
            name: 'Soon local',
            at: '2026-11-08T16:00:00Z',
            source: 'workspace',
            href: '/campaigns/b'
          },
          {
            id: 'k',
            name: 'Holiday gift guide',
            at: '2026-11-11T22:15:00Z',
            source: 'klaviyo',
            href: null
          }
        ]}
      />
    )
    expect(screen.getByText('Times in Sydney time')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Soon local' })).toBeInTheDocument()
    expect(
      screen.getByText('Holiday gift guide').closest('li')
    ).toHaveTextContent('Klaviyo')
  })

  it('shows what waits for the owner or for staff, never a placeholder', () => {
    const waiting = [1, 2, 3, 4].map((n) => ({
      id: `c${n}`,
      title: `Email ${n}`,
      step: 'Copy review'
    }))
    render(
      <ApprovalsCard
        owner
        waiting={waiting}
        seeAll="/dashboard?focus=review#your-campaigns"
        campaignsFailed={false}
      />
    )
    expect(screen.getByText('Waiting for you')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /^Email/ })).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'See all 4' })).toHaveAttribute(
      'href',
      '/dashboard?focus=review#your-campaigns'
    )
    cleanup()
    render(
      <ApprovalsCard
        owner={false}
        waiting={[]}
        seeAll="/dashboard"
        campaignsFailed={false}
      />
    )
    expect(screen.getByText('Waiting for the owner')).toBeInTheDocument()
  })

  it('reveals the numbers-only insight after Generate', () => {
    render(
      <InsightCard
        insight="Flows earned 60%."
        shown={false}
        generate="/dashboard?tab=flows&insight=1"
      />
    )
    expect(screen.getByRole('link', { name: 'Generate' })).toHaveAttribute(
      'href',
      '/dashboard?tab=flows&insight=1'
    )
    expect(screen.getByText(/No AI is used/)).toBeInTheDocument()
    cleanup()
    render(
      <InsightCard insight="Flows earned 60%." shown generate="/dashboard" />
    )
    expect(
      within(document.body).getByText('Flows earned 60%.')
    ).toBeInTheDocument()
  })
})
