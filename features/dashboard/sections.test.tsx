import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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

describe('dashboard sections', () => {
  it('says the numbers are sample data and when they last synced', () => {
    render(<DashboardHeader syncedAt="2026-11-06T11:48:00Z" sample now={now} />)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Dashboard' })
    ).toBeInTheDocument()
    expect(screen.getByText('Sample Klaviyo data')).toBeInTheDocument()
    expect(screen.getByText(/Last synced 12 minutes ago/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Refresh' })).toHaveAttribute(
      'href',
      '/dashboard?refresh=1'
    )
  })

  it('pairs each KPI label with its value and caption', () => {
    render(
      <KpiStrip
        kpis={[
          {
            label: 'Active subscribers',
            value: '16.5K',
            caption: '↑ 15%',
            trend: 'up'
          },
          {
            label: 'Abandoned checkouts',
            value: '419',
            caption: 'checkouts · 30d'
          }
        ]}
      />
    )
    const strip = screen.getByRole('region', { name: 'Key numbers' })
    expect(within(strip).getByText('16.5K')).toBeInTheDocument()
    expect(within(strip).getByText('↑ 15%').className).toContain('text-success')
  })

  it('explains that UTM needs Shopify, with a next step (§3 fix)', () => {
    render(
      <RevenueCard
        attribution="utm"
        value="$15,845.99"
        goal={null}
        fraction={0}
        shopifyConnected={false}
      />
    )
    expect(
      screen.getByText('UTM attribution needs Shopify.')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'Connect Shopify →' })
    ).toHaveAttribute('href', '/connections')
    expect(screen.getByRole('link', { name: 'UTM' })).toHaveAttribute(
      'aria-current',
      'true'
    )
    expect(screen.queryByText('$15,845.99')).not.toBeInTheDocument()
  })

  it('shows Klaviyo revenue against a goal, or says none is set', () => {
    render(
      <RevenueCard
        attribution="klaviyo"
        value="$15,845.99"
        goal={null}
        fraction={0}
        shopifyConnected={false}
      />
    )
    expect(screen.getByText('$15,845.99')).toBeInTheDocument()
    expect(screen.getByText('No monthly goal set yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Klaviyo' })).toHaveAttribute(
      'title',
      expect.stringContaining('attribution')
    )
  })

  it('counts down to the next send, or offers to create one', () => {
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
      />
    )
    expect(screen.getByText('in 2 days 4 hours')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Soon local' })).toHaveAttribute(
      'href',
      '/campaigns/b'
    )
    expect(
      screen.getByText(/\(Sydney time\) · In this workspace/)
    ).toBeInTheDocument()
    cleanup()
    render(<NextCampaignCard next={null} timezone="UTC" now={now} />)
    expect(
      screen.getByRole('link', { name: 'Create a campaign →' })
    ).toHaveAttribute('href', '/first-draft')
  })

  it('lists upcoming sends with links and tags Klaviyo ones', () => {
    render(
      <CalendarMiniCard
        timezone="UTC"
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
    expect(screen.getByRole('link', { name: 'Soon local' })).toBeInTheDocument()
    expect(
      screen.getByText('Holiday gift guide').closest('li')
    ).toHaveTextContent('Klaviyo')
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/campaign-agent'
    )
    cleanup()
    render(<CalendarMiniCard timezone="UTC" sends={[]} />)
    expect(screen.getByText(/No upcoming campaigns/)).toBeInTheDocument()
  })

  it('shows what waits for the owner, never a placeholder', () => {
    render(
      <ApprovalsCard
        owner
        waiting={[1, 2, 3, 4].map((n) => ({
          id: `c${n}`,
          title: `Email ${n}`,
          step: 'Copy review'
        }))}
      />
    )
    expect(screen.getByText('Waiting for you')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /^Email/ })).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'See all 4' })).toBeInTheDocument()
    expect(screen.queryByText(/not yet built/)).not.toBeInTheDocument()
  })

  it('reveals the numbers-only insight after Generate', () => {
    render(<InsightCard insight="Flows earned 60%." shown={false} />)
    expect(screen.queryByText('Flows earned 60%.')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Generate' })).toHaveAttribute(
      'href',
      '/dashboard?insight=1'
    )
    cleanup()
    render(<InsightCard insight="Flows earned 60%." shown />)
    expect(screen.getByText('Flows earned 60%.')).toBeInTheDocument()
    expect(
      screen.getByText('Written from your numbers. No AI was used.')
    ).toBeInTheDocument()
  })
})
