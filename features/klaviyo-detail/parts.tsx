import 'server-only'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { DetailPage } from '@/components/ui/detail-page'
import { dashboardBack } from '@/features/dashboard/back'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { klaviyoData, type KlaviyoData } from '@/features/klaviyo-data/reader'
import { sourceLine } from '@/features/dashboard/sections'
import { validTimezone } from '@/lib/brand-time'

const label =
  'tracking-label font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'

/** The signed-in workspace's Klaviyo data (sample in fake mode). */
export async function loadKlaviyo() {
  const context = await requireRequestContext('client')
  const timezone = validTimezone(context.timezone)
  const now = new Date()
  const data = await klaviyoData(context.tenantId, timezone, now.getTime())
  return { context, timezone, now, data }
}

/** Detail-page frame: back to the dashboard tab, Refresh, sample note. */
export function KlaviyoDetail({
  from,
  sample,
  children
}: {
  from: unknown
  sample: boolean
  children: ReactNode
}) {
  const back = dashboardBack(from)
  return (
    <DetailPage backHref={back.href} backLabel={back.label}>
      {sample && (
        <p className="text-xs text-[var(--text-muted)]">
          <strong className="font-semibold text-[var(--warning-ink)]">
            Sample Klaviyo data
          </strong>{' '}
          — made up for this preview, not synced from a real account.
        </p>
      )}
      {children}
    </DetailPage>
  )
}

export function NotConnected({
  from,
  data
}: {
  from: unknown
  data: Exclude<KlaviyoData, { state: 'sample' }>
}) {
  const back = dashboardBack(from)
  return (
    <DetailPage backHref={back.href} backLabel={back.label}>
      <Notice>
        {sourceLine(data, new Date())} This page has nothing to show yet.
        {data.state === 'not_connected' && (
          <>
            {' '}
            <Link href="/connections" className="underline underline-offset-4">
              Go to Connections
            </Link>
          </>
        )}
      </Notice>
    </DetailPage>
  )
}

/** A small stat or explainer card: tiny label, value, muted line. */
export function InfoCard({
  title,
  value,
  line,
  tint = false,
  children
}: {
  title: string
  value?: ReactNode
  line?: ReactNode
  tint?: boolean
  children?: ReactNode
}) {
  return (
    <Card
      className={tint ? 'border-transparent bg-[var(--brand-soft)]' : undefined}
    >
      <h2 className={label}>{title}</h2>
      {value !== undefined && (
        <p className="mt-2 text-2xl font-semibold break-words tabular-nums">
          {value}
        </p>
      )}
      {line && <p className="mt-1 text-sm text-[var(--text-muted)]">{line}</p>}
      {children}
    </Card>
  )
}

export const smallLabel = label
