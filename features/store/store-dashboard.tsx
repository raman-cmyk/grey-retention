import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  PackageX,
  ShoppingBag,
  Users
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Pill } from '@/components/ui/pill'
import {
  formatBrandDate,
  formatBrandDateTime,
  relativeTime,
  timezoneLabel
} from '@/lib/brand-time'
import { cn } from '@/lib/utils'
import { formatCount, formatMoney } from '@/features/klaviyo-data/summary'
import type { StoreData } from '@/features/store-data/reader'
import {
  lowStockAt,
  type CatalogueProduct,
  type StockReport
} from '@/features/store-data/stock'
import { changeText, storeSummary } from '@/features/store-data/summary'
import type { ShopifySnapshot } from '@/lib/providers/shopify-read'

const label =
  'tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'
const card =
  'rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6'

/** A `YYYY-MM-DD` day as "Nov 6, 2026" (the date itself, no timezone shift). */
const dayLabel = (date: string) =>
  formatBrandDate(`${date}T12:00:00Z`, 'UTC') ?? date

function Card({
  title,
  icon,
  children,
  aside
}: {
  title: string
  icon: ReactNode
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    // min-w-0: a wide table scrolls inside the card, never the page.
    <section aria-label={title} className={cn(card, 'min-w-0')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          {icon}
          {title}
        </h3>
        {aside}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function Kpis({ snapshot }: { snapshot: ShopifySnapshot }) {
  const s = storeSummary(snapshot)
  const items = [
    {
      name: 'Revenue · 30 days',
      value: formatMoney(s.revenue),
      note: changeText(s.revenueChange)
    },
    {
      name: 'Orders · 30 days',
      value: formatCount(s.orders),
      note: changeText(s.ordersChange)
    },
    {
      name: 'Average order',
      value: s.averageOrder
        ? formatMoney(s.averageOrder, { cents: true })
        : '—',
      note: s.averageOrder ? 'Revenue ÷ orders' : 'No orders yet'
    },
    {
      name: 'Returning customers',
      value: s.returningPercent === null ? '—' : `${s.returningPercent}%`,
      note:
        snapshot.customers30d.total > 0
          ? `${formatCount(snapshot.customers30d.returning)} of ${formatCount(snapshot.customers30d.total)} who ordered had ordered before`
          : 'No customers ordered yet'
    }
  ]
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.name} className={cn(card, 'min-w-0 p-4')}>
          <dt className={cn(label, 'break-words')}>{item.name}</dt>
          <dd className="mt-1 text-2xl font-semibold break-words tabular-nums">
            {item.value}
          </dd>
          {item.note && (
            <dd className="mt-1 text-xs text-[var(--text-muted)]">
              {item.note}
            </dd>
          )}
        </div>
      ))}
    </dl>
  )
}

function RevenueTrend({
  snapshot,
  timezone
}: {
  snapshot: ShopifySnapshot
  timezone: string
}) {
  const { bestDay } = storeSummary(snapshot)
  const max = Math.max(1, ...snapshot.daily.map((d) => d.revenue.minor))
  const days = snapshot.daily
  const ticks = [
    ...new Set([0, Math.floor(days.length / 2), days.length - 1])
  ].filter((index) => index >= 0)
  return (
    <Card
      title="Revenue trend"
      icon={<ShoppingBag className="size-4" aria-hidden="true" />}
      aside={
        <span className="text-xs text-[var(--text-muted)]">
          Last 30 days · {timezoneLabel(timezone)}
        </span>
      }
    >
      <div
        role="img"
        aria-label={`Store revenue per day for the last 30 days (${timezoneLabel(timezone)}). Best day ${bestDay ? `${dayLabel(bestDay.date)}, ${formatMoney(bestDay.revenue)}` : 'none'}. The table below lists every day.`}
        className="flex h-32 items-end gap-[3px]"
      >
        {days.map((day, index) => {
          const isBest = bestDay?.date === day.date
          const align =
            index < 4
              ? 'left-0'
              : index > days.length - 5
                ? 'right-0'
                : 'left-1/2 -translate-x-1/2'
          return (
            <div
              key={day.date}
              className="group relative flex h-full min-w-0 flex-1 items-end"
            >
              <span
                data-best={isBest || undefined}
                className="block w-full rounded-t-[3px] bg-[var(--line-strong)] group-hover:bg-[var(--text-muted)] data-[best]:bg-[var(--brand-secondary)] forced-colors:bg-[CanvasText] forced-colors:data-[best]:bg-[Highlight]"
                style={{
                  height: `${Math.max(2, Math.round((day.revenue.minor / max) * 100))}%`
                }}
              />
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute bottom-full z-10 mb-2 hidden rounded-sm bg-[var(--text)] px-2 py-1 text-xs whitespace-nowrap text-[var(--surface-raised)] group-hover:block',
                  align
                )}
              >
                {dayLabel(day.date)} · {formatMoney(day.revenue)} · {day.orders}{' '}
                {day.orders === 1 ? 'order' : 'orders'}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs text-[var(--text-muted)]">
        {ticks.map((index) => (
          <span key={index}>{dayLabel(days[index]?.date ?? '')}</span>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-[var(--text-muted)]">
          Show revenue per day as a table
        </summary>
        <table className="mt-2 w-full max-w-md text-left tabular-nums">
          <caption className="sr-only">
            Store revenue per day, last 30 days
          </caption>
          <thead>
            <tr>
              <th scope="col" className={label}>
                Day
              </th>
              <th scope="col" className={cn(label, 'text-right')}>
                Orders
              </th>
              <th scope="col" className={cn(label, 'text-right')}>
                Revenue
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td className="py-0.5">{dayLabel(day.date)}</td>
                <td className="py-0.5 text-right">{day.orders}</td>
                <td className="py-0.5 text-right">
                  {formatMoney(day.revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </Card>
  )
}

function TopCustomers({
  snapshot,
  timezone,
  now
}: {
  snapshot: ShopifySnapshot
  timezone: string
  now: Date
}) {
  return (
    <Card
      title="Top customers"
      icon={<Users className="size-4" aria-hidden="true" />}
      aside={
        <span className="text-xs text-[var(--text-muted)]">Last 12 months</span>
      }
    >
      {snapshot.topCustomers.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No orders yet.</p>
      ) : (
        // Focusable, so keyboard users can scroll it on a narrow screen.
        <div
          tabIndex={0}
          role="region"
          aria-label="Top customers table"
          className="overflow-x-auto"
        >
          <table className="w-full min-w-[22rem] text-left text-sm tabular-nums">
            <caption className="sr-only">
              Top customers by total spent, last 12 months
            </caption>
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th scope="col" className={cn(label, 'pb-2')}>
                  Customer
                </th>
                <th scope="col" className={cn(label, 'pb-2 text-right')}>
                  Orders
                </th>
                <th scope="col" className={cn(label, 'pb-2 text-right')}>
                  Spent
                </th>
                <th scope="col" className={cn(label, 'pb-2 text-right')}>
                  Last order
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshot.topCustomers.map((customer) => (
                <tr
                  key={customer.id}
                  className="border-b border-[var(--line)] last:border-b-0"
                >
                  <th scope="row" className="py-2 font-medium">
                    {customer.name}
                  </th>
                  <td className="py-2 text-right">{customer.orders}</td>
                  <td className="py-2 text-right">
                    {formatMoney(customer.spent)}
                  </td>
                  <td className="py-2 text-right text-[var(--text-muted)]">
                    <time
                      dateTime={customer.lastOrderAt}
                      title={
                        formatBrandDateTime(customer.lastOrderAt, timezone) ??
                        undefined
                      }
                    >
                      {relativeTime(customer.lastOrderAt, now)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function ProductList({
  products,
  detail
}: {
  products: CatalogueProduct[]
  detail: (p: CatalogueProduct) => string
}) {
  const shown = products.slice(0, 5)
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {shown.map((p) => (
        <li key={p.id} className="flex flex-wrap justify-between gap-2">
          <span className="min-w-0 break-words">{p.title}</span>
          <span className="text-[var(--text-muted)] tabular-nums">
            {detail(p)}
          </span>
        </li>
      ))}
      {products.length > shown.length && (
        <li className="text-[var(--text-muted)]">
          and {products.length - shown.length} more
        </li>
      )}
    </ul>
  )
}

function StockAlerts({
  stock,
  timezone,
  now
}: {
  stock: StockReport | null
  timezone: string
  now: Date
}) {
  const productsLink = (
    <Link href="/brand#catalogue" className="text-sm font-medium underline">
      See your products
    </Link>
  )
  if (!stock)
    return (
      <Card
        title="Stock alerts"
        icon={<PackageX className="size-4" aria-hidden="true" />}
      >
        <p className="text-sm text-[var(--danger-ink)]">
          We could not load your products. Reload the page to try again.
        </p>
      </Card>
    )
  const clear =
    stock.outOfStock.length === 0 &&
    stock.low.length === 0 &&
    stock.stale.length === 0
  return (
    <Card
      title="Stock alerts"
      icon={<PackageX className="size-4" aria-hidden="true" />}
      aside={
        stock.sample ? <Pill tone="neutral">Sample products</Pill> : undefined
      }
    >
      {stock.total === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No products in your catalogue yet. {productsLink}
        </p>
      ) : clear ? (
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="text-success size-4" aria-hidden="true" />
          {stock.total === 1
            ? 'Your 1 product is in stock'
            : `All ${formatCount(stock.total)} products are in stock`}
          , and stock was checked in the last 24 hours.
        </p>
      ) : (
        <div className="space-y-4">
          {stock.outOfStock.length > 0 && (
            <div>
              <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--danger-ink)]">
                <PackageX className="size-4" aria-hidden="true" />
                Out of stock: {stock.outOfStock.length}
              </h4>
              <ProductList
                products={stock.outOfStock}
                detail={() => '0 left'}
              />
            </div>
          )}
          {stock.low.length > 0 && (
            <div>
              <h4 className="flex items-center gap-2 text-sm font-semibold text-[var(--warning-ink)]">
                <AlertTriangle className="size-4" aria-hidden="true" />
                Low stock ({lowStockAt} or fewer left): {stock.low.length}
              </h4>
              <ProductList
                products={stock.low}
                detail={(p) => `${p.stock} left`}
              />
            </div>
          )}
          {stock.stale.length > 0 && (
            <div>
              <h4 className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4" aria-hidden="true" />
                Stock not checked in the last 24 hours: {stock.stale.length}
              </h4>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                A campaign that features one of these products can’t be
                scheduled until its stock is checked again.
              </p>
              <ProductList
                products={stock.stale}
                detail={(p) =>
                  `checked ${relativeTime(p.stockObservedAt, now) ?? 'never'}`
                }
              />
            </div>
          )}
          <p className="text-xs text-[var(--text-muted)]">
            Times in {timezoneLabel(timezone)}. {productsLink}
          </p>
        </div>
      )}
    </Card>
  )
}

const brokenWords = {
  disconnected: 'Shopify is disconnected.',
  expired: 'The Shopify connection has expired.',
  error: 'The Shopify connection has an error.'
} as const

/**
 * The Store dashboard (UI_REBUILD_SPEC §5): revenue trend, top customers
 * and stock alerts, in the same card language as the Dashboard. Orders and
 * customers are sample data until the live Shopify read exists; products
 * and stock are the workspace's own catalogue.
 */
export function StoreDashboard({
  data,
  timezone,
  now
}: {
  data: Extract<StoreData, { state: 'sample' | 'unavailable' | 'broken' }>
  timezone: string
  now: number
}) {
  const at = new Date(now)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Store Intelligence</h2>
        {data.state === 'sample' && (
          <Pill tone="neutral">Sample orders and customers</Pill>
        )}
      </div>
      {data.state === 'sample' ? (
        <>
          <p className="text-sm text-[var(--text-muted)]">
            Shopify ({data.snapshot.shop.domain}) is connected with sample data.
            The orders and customers below are examples until the live Shopify
            sync is built. Products and stock are your catalogue.
          </p>
          <Kpis snapshot={data.snapshot} />
          <RevenueTrend snapshot={data.snapshot} timezone={timezone} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TopCustomers
              snapshot={data.snapshot}
              timezone={timezone}
              now={at}
            />
            <StockAlerts stock={data.stock} timezone={timezone} now={at} />
          </div>
        </>
      ) : data.state === 'broken' ? (
        <>
          <p
            role="status"
            className="rounded-[var(--radius-control)] bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning-ink)]"
          >
            {brokenWords[data.reason]} No orders or customers are shown. Stock
            alerts below come from your catalogue.{' '}
            <Link href="/connections" className="font-medium underline">
              Open Connections
            </Link>
          </p>
          <StockAlerts stock={data.stock} timezone={timezone} now={at} />
        </>
      ) : (
        <>
          <p className="rounded-[var(--radius-control)] bg-[var(--surface-hover)] px-4 py-3 text-sm">
            Orders and customers from Shopify are not available yet. Stock
            alerts below come from your catalogue.
          </p>
          <StockAlerts stock={data.stock} timezone={timezone} now={at} />
        </>
      )}
    </div>
  )
}
