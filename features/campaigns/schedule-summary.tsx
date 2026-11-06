import { formatBrandDateTime, timezoneLabel } from '@/lib/brand-time'
import type { Database } from '@/lib/supabase/database.types'

type Audience = Pick<
  Database['public']['Tables']['audiences']['Row'],
  'provider_id' | 'label'
>

export type SummaryPackage = {
  subject: string
  sender: { name: string; email: string }
  audience: { includes: string[]; excludes: string[] }
  scheduledAt: string
  timezone: string
}

/** Audience names, never raw ids (OWNER_JOURNEYS.md §4 fix). */
export function audienceNames(
  ids: readonly string[],
  audiences: readonly Audience[]
) {
  return ids.map(
    (id) =>
      audiences.find((a) => a.provider_id === id)?.label ??
      `Unknown list (${id})`
  )
}

/**
 * What the owner confirms when scheduling (UIR-016): subject, from, who
 * gets it and who does not, and the time in the brand timezone.
 */
export function ScheduleSummary({
  pkg,
  audiences
}: {
  pkg: SummaryPackage
  audiences: readonly Audience[]
}) {
  const rows: [string, string][] = [
    ['Subject', pkg.subject],
    ['From', `${pkg.sender.name} · ${pkg.sender.email}`],
    ['Send to', audienceNames(pkg.audience.includes, audiences).join(', ')],
    [
      "Don't send to",
      audienceNames(pkg.audience.excludes, audiences).join(', ') || '—'
    ],
    [
      'When',
      `${formatBrandDateTime(pkg.scheduledAt, pkg.timezone) ?? 'Unknown time'} (${timezoneLabel(pkg.timezone)})`
    ]
  ]
  return (
    <dl
      aria-label="What you are scheduling"
      className="my-4 grid gap-3 text-sm sm:grid-cols-2"
    >
      {rows.map(([term, value]) => (
        <div key={term}>
          <dt className="text-[var(--text-muted)]">{term}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
