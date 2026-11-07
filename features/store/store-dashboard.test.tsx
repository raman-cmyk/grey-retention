import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { sampleShopifySnapshot } from '@/lib/providers/fake-shopify-read'
import { stockReport, type CatalogueProduct } from '@/features/store-data/stock'
import { StoreDashboard } from './store-dashboard'

afterEach(cleanup)

const now = Date.parse('2026-11-06T12:00:00Z')
const snapshot = sampleShopifySnapshot({
  tenantId: '00000000-0000-4000-8000-000000000101',
  timezone: 'UTC',
  shopDomain: 'cedar.myshopify.com',
  now: new Date(now)
})
const product = (
  id: string,
  stock: number,
  hoursAgo = 1
): CatalogueProduct => ({
  id,
  title: `Field overshirt ${id}`,
  url: null,
  stock,
  stockObservedAt: new Date(now - hoursAgo * 3600_000).toISOString(),
  sample: true
})

describe('StoreDashboard', () => {
  it('labels sample orders and customers, and shows the 30-day numbers', () => {
    render(
      <StoreDashboard
        data={{
          state: 'sample',
          snapshot,
          stock: stockReport([product('a', 20)], new Date(now))
        }}
        timezone="UTC"
        now={now}
      />
    )
    expect(screen.getByText('Sample orders and customers')).toBeVisible()
    expect(
      screen.getByText(/The orders and customers below are examples/)
    ).toHaveTextContent('cedar.myshopify.com')
    for (const name of [
      'Revenue · 30 days',
      'Orders · 30 days',
      'Average order',
      'Returning customers'
    ])
      expect(screen.getByText(name)).toBeVisible()
    // Every day is in the table for keyboard and screen-reader users.
    const trend = screen.getByRole('region', { name: 'Revenue trend' })
    expect(within(trend).getByRole('img')).toHaveAccessibleName(
      /Store revenue per day for the last 30 days/
    )
    expect(within(trend).getAllByRole('row')).toHaveLength(31)
  })

  it('lists the top customers with orders, spend and last order', () => {
    render(
      <StoreDashboard
        data={{ state: 'sample', snapshot, stock: null }}
        timezone="UTC"
        now={now}
      />
    )
    const table = within(
      screen.getByRole('region', { name: 'Top customers' })
    ).getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(6)
    expect(rows[1]).toHaveTextContent(snapshot.topCustomers[0]!.name)
    expect(rows[1]).toHaveTextContent(/ago$/)
  })

  it('warns about products that are out of stock, low or not checked lately', () => {
    render(
      <StoreDashboard
        data={{
          state: 'sample',
          snapshot,
          stock: stockReport(
            [product('a', 0), product('b', 2), product('c', 30, 40)],
            new Date(now)
          )
        }}
        timezone="UTC"
        now={now}
      />
    )
    const alerts = screen.getByRole('region', { name: 'Stock alerts' })
    expect(alerts).toHaveTextContent('Out of stock: 1')
    expect(alerts).toHaveTextContent('Field overshirt a')
    expect(alerts).toHaveTextContent('Low stock (5 or fewer left): 1')
    expect(alerts).toHaveTextContent('2 left')
    expect(alerts).toHaveTextContent(
      'Stock not checked in the last 24 hours: 1'
    )
    expect(alerts).toHaveTextContent(/can’t be scheduled until its stock/)
    expect(within(alerts).getByText('Sample products')).toBeVisible()
    expect(
      within(alerts).getByRole('link', { name: 'See your products' })
    ).toHaveAttribute('href', '/brand#catalogue')
  })

  it('says when every product is fine, when there are none, or when they did not load', () => {
    const { rerender } = render(
      <StoreDashboard
        data={{
          state: 'sample',
          snapshot,
          stock: stockReport([product('a', 20)], new Date(now))
        }}
        timezone="UTC"
        now={now}
      />
    )
    expect(screen.getByText(/All 1 products are in stock/)).toBeVisible()
    rerender(
      <StoreDashboard
        data={{
          state: 'sample',
          snapshot,
          stock: stockReport([], new Date(now))
        }}
        timezone="UTC"
        now={now}
      />
    )
    expect(screen.getByText(/No products in your catalogue yet/)).toBeVisible()
    rerender(
      <StoreDashboard
        data={{ state: 'sample', snapshot, stock: null }}
        timezone="UTC"
        now={now}
      />
    )
    expect(screen.getByText(/We could not load your products/)).toBeVisible()
  })

  it('shows no invented numbers when orders are unavailable', () => {
    render(
      <StoreDashboard
        data={{
          state: 'unavailable',
          stock: stockReport([product('a', 0)], new Date(now))
        }}
        timezone="UTC"
        now={now}
      />
    )
    expect(
      screen.getByText(
        /Orders and customers from Shopify are not available yet/
      )
    ).toBeVisible()
    expect(screen.queryByText('Revenue · 30 days')).toBeNull()
    expect(screen.queryByText('Sample orders and customers')).toBeNull()
    expect(
      screen.getByRole('region', { name: 'Stock alerts' })
    ).toHaveTextContent('Out of stock: 1')
  })
})
