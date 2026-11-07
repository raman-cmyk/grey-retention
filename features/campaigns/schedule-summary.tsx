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

/** The required suppression segment (unsubscribed, spam, bounced). */
export const SUPPRESSED = 'Unsubscribed, spam and bounced profiles'

/**
 * Audience names, never raw ids (OWNER_JOURNEYS.md §4 fix). Exclusions are
 * the workspace's required suppression segment, which is not an audience
 * row, so an unknown exclusion is named for what it is.
 */
export function audienceNames(
  ids: readonly string[],
  audiences: readonly Audience[],
  kind: 'include' | 'exclude'
) {
  const names = ids.map(
    (id) =>
      audiences.find((a) => a.provider_id === id)?.label ??
      (kind === 'exclude' ? SUPPRESSED : 'A list no longer in this workspace')
  )
  return [...new Set(names)]
}

/**
 * What the owner confirms when scheduling (UIR-016): subject, from, who
 * gets it and who does not, and the time in the brand timezone.
 */
export function ScheduleSummary({
  pkg,
  audiences,
  timezone,
  label = 'What you are scheduling'
}: {
  pkg: SummaryPackage
  audiences: readonly Audience[]
  /** The one brand timezone (the workspace's). */
  timezone: string
  label?: string
}) {
  const rows: [string, string][] = [
    ['Subject', pkg.subject],
    ['From', `${pkg.sender.name} · ${pkg.sender.email}`],
    [
      'Send to',
      audienceNames(pkg.audience.includes, audiences, 'include').join(', ')
    ],
    [
      "Don't send to",
      audienceNames(pkg.audience.excludes, audiences, 'exclude').join(', ') ||
        '—'
    ],
    [
      'When',
      `${formatBrandDateTime(pkg.scheduledAt, timezone) ?? 'Unknown time'} (${timezoneLabel(timezone)})`
    ]
  ]
  return (
    <>
      <dl aria-label={label} className="my-4 grid gap-3 text-sm sm:grid-cols-2">
        {rows.map(([term, value]) => (
          <div key={term}>
            <dt className="text-[var(--text-muted)]">{term}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {pkg.timezone !== timezone && (
        <p className="mb-4 text-xs text-[var(--text-muted)]">
          This package was made for {timezoneLabel(pkg.timezone)}; times here
          are in the brand timezone, {timezoneLabel(timezone)}.
        </p>
      )}
    </>
  )
}
