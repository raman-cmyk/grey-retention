import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CloudDownload,
  Mail,
  PartyPopper,
  Table2,
  X
} from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { pillToneClasses, StatusPill } from '@/components/ui/pill'
import { formatBrandDateTime, timezoneLabel } from '@/lib/brand-time'
import {
  campaignStatuses,
  campaignStatusOrder,
  type CampaignStatus
} from '@/lib/campaign-status'
import type { KlaviyoCampaign } from '@/lib/providers/klaviyo-read'
import { cn } from '@/lib/utils'
import {
  filtersActive,
  klaviyoCampaignHref,
  plannerHref,
  type PlannerDay,
  type PlannerEntry,
  type PlannerQuery
} from './model'
import { NewMenu, type NewMenuItem } from './new-menu'

const weekdays = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
]

export const statusFilters: ('all' | CampaignStatus)[] = [
  'all',
  'draft',
  'with_designer',
  'needs_approval',
  'scheduled',
  'sent',
  'missed',
  'cancelled',
  'delivery_problem'
]

const channelFilters: { key: PlannerQuery['channel']; label: string }[] = [
  { key: 'all', label: 'All channels' },
  { key: 'email_design', label: 'Design email' },
  { key: 'email_text', label: 'Text email' }
]

const pillLink =
  'inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3 text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden aria-[current=true]:border-transparent aria-[current=true]:bg-[var(--brand-primary)] aria-[current=true]:text-[var(--on-brand)]'

/** What a chip's second line says: the status, plus where it came from. */
function chipLine(entry: PlannerEntry, klaviyoLabel: string) {
  return [
    entry.status ? campaignStatuses[entry.status].label : 'Replaced',
    entry.source === 'klaviyo' ? klaviyoLabel : null,
    entry.synthetic ? 'Synthetic demo' : null
  ]
    .filter(Boolean)
    .join(' · ')
}

/**
 * A campaign chip: the name, and the status in WORDS on a second line
 * (colours repeat between statuses, so colour is never the only signal).
 * Klaviyo chips have a dashed border and a download icon.
 */
function Chip({
  entry,
  klaviyoLabel,
  timezone
}: {
  entry: PlannerEntry
  klaviyoLabel: string
  timezone: string
}) {
  const tone = entry.status ? campaignStatuses[entry.status].tone : 'neutral'
  const line = chipLine(entry, klaviyoLabel)
  // The time is in the hover title too, but keyboard and screen-reader
  // users need it in the name.
  const time = formatBrandDateTime(entry.at, timezone)?.split(' · ')[1]
  const Icon = entry.source === 'klaviyo' ? CloudDownload : Mail
  return (
    <Link
      href={entry.href}
      title={entry.tooltip}
      aria-label={`${entry.name} · ${line}${time ? ` · ${time}` : ''}`}
      className={cn(
        'block min-w-0 rounded-md border px-1.5 py-1 text-[0.6875rem] leading-4 focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden',
        pillToneClasses[tone],
        entry.source === 'klaviyo' && 'border-dashed border-current',
        !entry.status && 'opacity-60'
      )}
    >
      <span className="flex min-w-0 items-center gap-1 font-medium">
        <Icon className="size-3 shrink-0" aria-hidden />
        <span
          className={cn(
            'truncate',
            entry.status === 'cancelled' && 'line-through'
          )}
        >
          {entry.name}
        </span>
      </span>
      <span className="tracking-label block text-[0.5625rem] font-semibold break-words uppercase">
        {line}
      </span>
    </Link>
  )
}

function Grid({
  label,
  days,
  canPlan,
  klaviyoLabel,
  timezone,
  backQuery
}: {
  label: string
  days: PlannerDay[]
  canPlan: boolean
  klaviyoLabel: string
  timezone: string
  /** `from=planner&…`, so the draft page can link back to this view. */
  backQuery: string
}) {
  const weeks = Array.from({ length: days.length / 7 }, (_, i) =>
    days.slice(i * 7, i * 7 + 7)
  )
  return (
    <div className="hidden md:block">
      <table
        className="w-full table-fixed border-collapse"
        aria-label={`${label} campaign calendar`}
      >
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <th
                key={weekday}
                scope="col"
                className="tracking-label border-y border-[var(--line)] px-2 py-2 text-left font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase"
              >
                <span aria-hidden>{weekday.slice(0, 3)}</span>
                <span className="sr-only">{weekday}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0].date}>
              {week.map((day) => (
                <td
                  key={day.date}
                  className={cn(
                    'group h-28 border-b border-[var(--line)] p-1.5 align-top [&:not(:last-child)]:border-r',
                    (day.past || !day.inMonth) && 'bg-[var(--surface-hover)]'
                  )}
                >
                  <div className="flex flex-wrap items-start gap-1">
                    <time
                      dateTime={day.date}
                      aria-label={`${day.label}${day.today ? ', today' : ''}${!day.inMonth ? ', outside selected month' : ''}`}
                      aria-current={day.today ? 'date' : undefined}
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                        day.today
                          ? 'bg-[var(--brand-secondary)] text-[var(--on-brand-secondary)]'
                          : day.past || !day.inMonth
                            ? 'text-[var(--text-muted)]'
                            : 'text-[var(--text)]'
                      )}
                    >
                      {day.day}
                    </time>
                    {day.holidays.map((h) => (
                      <span
                        key={h.id}
                        title={h.name}
                        className={cn(
                          'max-w-full truncate rounded-full px-1.5 py-0.5 text-[0.625rem] leading-4 font-medium',
                          pillToneClasses['accent-2']
                        )}
                      >
                        <PartyPopper
                          className="mr-0.5 inline size-2.5"
                          aria-hidden
                        />
                        <span className="sr-only">Holiday or event: </span>
                        {h.name}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 space-y-1">
                    {day.entries.map((entry) => (
                      <Chip
                        key={entry.key}
                        entry={entry}
                        klaviyoLabel={klaviyoLabel}
                        timezone={timezone}
                      />
                    ))}
                  </div>
                  {canPlan && day.inMonth && !day.past && (
                    <Link
                      href={
                        `/first-draft?date=${day.date}&${backQuery}` as Route
                      }
                      className="mt-1 block rounded-sm text-center text-[0.6875rem] text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--text)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
                    >
                      + plan send{' '}
                      <span className="sr-only">on {day.label}</span>
                    </Link>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Small screens: the days that have campaigns, as a list. Owners can plan
 * a send on any listed future day here; any other day is one tap away via
 * "+ New → Single send", whose form has a date field.
 */
function Agenda({
  days,
  timezone,
  klaviyoLabel,
  filtered,
  campaignsFailed,
  canPlan,
  backQuery
}: {
  days: PlannerDay[]
  timezone: string
  klaviyoLabel: string
  filtered: boolean
  campaignsFailed: boolean
  canPlan: boolean
  backQuery: string
}) {
  const busy = days.filter(
    (d) => d.inMonth && (d.entries.length || d.holidays.length)
  )
  if (!busy.length)
    return filtered || campaignsFailed ? null : (
      <p className="p-4 text-sm text-[var(--text-muted)] md:hidden">
        No campaigns, holidays or events this month.
      </p>
    )
  return (
    <div
      role="region"
      aria-label="Campaign agenda"
      className="space-y-4 p-4 md:hidden"
    >
      {busy.map((day) => (
        <div key={day.date}>
          <h3 className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold text-[var(--text-muted)]">
            <span>
              <time dateTime={day.date}>{day.label}</time>
              {day.today && ' · Today'}
            </span>
            {canPlan && !day.past && (
              <Link
                href={`/first-draft?date=${day.date}&${backQuery}` as Route}
                className="font-medium text-[var(--text)] underline-offset-4 hover:underline"
              >
                + plan send <span className="sr-only">on {day.label}</span>
              </Link>
            )}
          </h3>
          <ul className="mt-2 space-y-1.5">
            {day.holidays.map((h) => (
              <li key={h.id} className="text-accent-2 text-xs">
                Holiday or event: {h.name}
              </li>
            ))}
            {day.entries.map((entry) => (
              <li key={entry.key} className="flex items-center gap-2">
                <Link
                  href={entry.href}
                  className="min-w-0 flex-1 text-sm font-medium underline-offset-4 hover:underline"
                >
                  <span className="block truncate">{entry.name}</span>
                  {(entry.source === 'klaviyo' || entry.synthetic) && (
                    <span className="block text-xs font-normal text-[var(--text-muted)]">
                      {entry.source === 'klaviyo'
                        ? klaviyoLabel
                        : 'Synthetic demo'}
                    </span>
                  )}
                </Link>
                <span className="text-xs text-[var(--text-muted)]">
                  {formatBrandDateTime(entry.at, timezone)?.split(' · ')[1]}
                </span>
                {entry.status ? (
                  <StatusPill status={entry.status} />
                ) : (
                  <span className="text-xs text-[var(--text-muted)]">
                    Replaced
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function Table({
  entries,
  timezone,
  klaviyoLabel,
  filtered,
  campaignsFailed
}: {
  entries: PlannerEntry[]
  timezone: string
  klaviyoLabel: string
  /** Filters are on: the card already says nothing matches. */
  filtered: boolean
  /** The page already says the campaigns could not load. */
  campaignsFailed: boolean
}) {
  if (!entries.length)
    return filtered || campaignsFailed ? null : (
      <p className="flex items-center justify-center gap-2 p-10 text-center text-sm text-[var(--text-muted)]">
        <Table2 className="size-4" aria-hidden />
        No campaigns this month. Plan some on the calendar view, or wait for
        Klaviyo sends to appear.
      </p>
    )
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Campaigns this month</caption>
        <thead>
          <tr className="tracking-label font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase">
            <th
              scope="col"
              className="border-b border-[var(--line)] px-3 py-2 font-normal whitespace-nowrap"
            >
              When · {timezoneLabel(timezone)}
            </th>
            <th
              scope="col"
              className="border-b border-[var(--line)] px-3 py-2 font-normal"
            >
              Title
            </th>
            <th
              scope="col"
              className="border-b border-[var(--line)] px-3 py-2 font-normal"
            >
              Channel
            </th>
            <th
              scope="col"
              className="border-b border-[var(--line)] px-3 py-2 font-normal"
            >
              Status
            </th>
            <th
              scope="col"
              className="border-b border-[var(--line)] px-3 py-2 font-normal"
            >
              From
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--line)]">
          {entries.map((entry) => (
            <tr key={entry.key}>
              <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                {formatBrandDateTime(entry.at, timezone)}
              </td>
              <th scope="row" className="px-3 py-2.5 text-left font-medium">
                <Link
                  href={entry.href}
                  className="break-words underline-offset-4 hover:underline"
                >
                  {entry.name}
                </Link>
              </th>
              <td className="px-3 py-2.5 whitespace-nowrap">
                {entry.channel === 'email_text' ? 'Text email' : 'Design email'}
              </td>
              <td className="px-3 py-2.5">
                {entry.status ? (
                  <StatusPill status={entry.status} />
                ) : (
                  'Replaced'
                )}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-[var(--text-muted)]">
                {entry.source === 'klaviyo'
                  ? klaviyoLabel
                  : entry.synthetic
                    ? 'This workspace · synthetic demo'
                    : 'This workspace'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * The Campaigns planner card (docs/UI_REBUILD_SPEC.md §6, behaviour from
 * docs/OWNER_JOURNEYS.md §6 and §18): month navigation, one "+ New" menu,
 * status and channel filters kept in the URL, Calendar | Table, chips from
 * this workspace AND Klaviyo, holidays, a legend, and a tray for Klaviyo
 * drafts with no send time.
 */
export function Planner({
  query,
  month,
  unscheduled,
  timezone,
  klaviyoLine,
  klaviyoLabel,
  summary,
  canPlan,
  campaignsFailed = false,
  newItems
}: {
  query: PlannerQuery
  month: {
    label: string
    days: PlannerDay[]
    isTodayMonth: boolean
    todayMonth: string
    previousMonth: string | null
    nextMonth: string | null
    monthEntries: PlannerEntry[]
  }
  unscheduled: KlaviyoCampaign[]
  timezone: string
  /** One plain line on where Klaviyo sends come from. */
  klaviyoLine: string
  /** How Klaviyo entries are named, e.g. "Klaviyo sample". */
  klaviyoLabel: string
  /** The whole month in one line, whatever the filters. */
  summary: string
  /** Owners may plan a send on a day ("+ plan send"). */
  canPlan: boolean
  /** This workspace's campaigns did not load: no "empty month" messages. */
  campaignsFailed?: boolean
  /** The "+ New" choices; none hides the menu. */
  newItems: NewMenuItem[]
}) {
  const href = (patch: Partial<PlannerQuery>) => plannerHref(query, patch)
  const filtered = filtersActive(query)
  const backQuery = `from=planner&${plannerHref(query, {}).split('?')[1]}`
  // The tray holds Klaviyo design-email drafts, so it follows the filters.
  const showTray =
    unscheduled.length > 0 &&
    (query.status === 'all' || query.status === 'draft') &&
    query.channel !== 'email_text'
  return (
    <section
      aria-labelledby="planner-month"
      className="rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)]"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] p-4">
        <div className="flex items-center gap-2">
          {month.previousMonth && (
            <Link
              href={href({ m: month.previousMonth })}
              aria-label="Previous month"
              className="grid size-9 place-items-center rounded-full border border-[var(--line-strong)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          )}
          <h2
            id="planner-month"
            className="min-w-36 text-center text-base font-semibold"
          >
            {month.label}
          </h2>
          {month.nextMonth && (
            <Link
              href={href({ m: month.nextMonth })}
              aria-label="Next month"
              className="grid size-9 place-items-center rounded-full border border-[var(--line-strong)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
            >
              <ChevronRight className="size-4" aria-hidden />
            </Link>
          )}
          {!month.isTodayMonth && (
            <Link
              href={href({ m: month.todayMonth })}
              className="ml-1 text-sm font-medium underline underline-offset-4"
            >
              Today
            </Link>
          )}
        </div>
        <div className="text-xs text-[var(--text-muted)]">
          <p>{summary}</p>
          <p className="italic">{klaviyoLine}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <form action="/campaign-agent" className="flex items-center gap-1.5">
            <label htmlFor="planner-go-month" className="sr-only">
              Month
            </label>
            <input
              key={query.m}
              id="planner-go-month"
              type="month"
              name="m"
              min="0001-01"
              max="9999-12"
              defaultValue={query.m}
              className="min-h-9 rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-2 text-sm"
            />
            {query.view !== 'calendar' && (
              <input type="hidden" name="view" value={query.view} />
            )}
            {query.status !== 'all' && (
              <input type="hidden" name="status" value={query.status} />
            )}
            {query.channel !== 'all' && (
              <input type="hidden" name="channel" value={query.channel} />
            )}
            {query.history && <input type="hidden" name="history" value="1" />}
            <button
              type="submit"
              className="min-h-9 rounded-[var(--radius-control)] px-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
            >
              Show month
            </button>
          </form>
          <Link
            href="/holidays"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <PartyPopper className="size-4" aria-hidden />
            Holidays & Events
          </Link>
          {newItems.length > 0 && <NewMenu items={newItems} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] p-4">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {statusFilters.map((status) => (
            <Link
              key={status}
              href={href({ status })}
              aria-current={query.status === status ? 'true' : undefined}
              className={pillLink}
            >
              {status === 'all'
                ? 'All statuses'
                : campaignStatuses[status].label}
            </Link>
          ))}
        </nav>
        <span
          aria-hidden
          className="mx-1 hidden h-6 w-px bg-[var(--line)] sm:block"
        />
        <nav aria-label="Filter by channel" className="flex flex-wrap gap-1.5">
          {channelFilters.map((channel) => (
            <Link
              key={channel.key}
              href={href({ channel: channel.key })}
              aria-current={query.channel === channel.key ? 'true' : undefined}
              className={pillLink}
            >
              {channel.label}
            </Link>
          ))}
        </nav>
        {filtered && (
          <Link
            href={href({ status: 'all', channel: 'all' })}
            className="inline-flex min-h-8 items-center gap-1 px-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <X className="size-3.5" aria-hidden />
            Reset
          </Link>
        )}
        <nav
          aria-label="View"
          className="ml-auto flex gap-1 rounded-[var(--radius-control)] border border-[var(--line)] p-0.5"
        >
          {(
            [
              ['calendar', 'Calendar', CalendarDays],
              ['table', 'Table', Table2]
            ] as const
          ).map(([view, label, Icon]) => (
            <Link
              key={view}
              href={href({ view })}
              aria-current={query.view === view ? 'page' : undefined}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-3 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden aria-[current=page]:bg-[var(--brand-primary)] aria-[current=page]:text-[var(--on-brand)]"
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </div>
      {filtered && month.monthEntries.length === 0 && (
        <p
          role="status"
          className="border-b border-[var(--line)] px-4 py-3 text-sm text-[var(--text-muted)]"
        >
          No campaigns match these filters this month.{' '}
          <Link
            href={href({ status: 'all', channel: 'all' })}
            className="font-medium text-[var(--text)] underline underline-offset-4"
          >
            Show all
          </Link>
        </p>
      )}
      {query.view === 'calendar' ? (
        <>
          <Grid
            label={month.label}
            days={month.days}
            canPlan={canPlan}
            klaviyoLabel={klaviyoLabel}
            timezone={timezone}
            backQuery={backQuery}
          />
          <Agenda
            days={month.days}
            timezone={timezone}
            klaviyoLabel={klaviyoLabel}
            filtered={filtered}
            campaignsFailed={campaignsFailed}
            canPlan={canPlan}
            backQuery={backQuery}
          />
        </>
      ) : (
        <Table
          entries={month.monthEntries}
          timezone={timezone}
          klaviyoLabel={klaviyoLabel}
          filtered={filtered}
          campaignsFailed={campaignsFailed}
        />
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--line)] px-4 py-3 text-xs text-[var(--text-muted)]">
        <span>Legend:</span>
        {campaignStatusOrder.map((status) => (
          <StatusPill key={status} status={status} />
        ))}
        {month.monthEntries.some((e) => e.source === 'klaviyo') && (
          <span className="inline-flex items-center gap-1">
            <CloudDownload className="size-3.5" aria-hidden />
            Dashed outline: {klaviyoLabel}
          </span>
        )}
        <Link
          href={href({ history: !query.history })}
          className="underline underline-offset-4"
        >
          {query.history ? 'Hide replaced entries' : 'Show replaced entries'}
        </Link>
        <span className="ml-auto">Times: {timezoneLabel(timezone)}</span>
      </div>
      {showTray && (
        <section
          aria-labelledby="planner-unscheduled"
          className="border-t border-[var(--line)] p-4"
        >
          <h3 id="planner-unscheduled" className="text-sm font-semibold">
            Not scheduled in Klaviyo
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {klaviyoLabel === 'Klaviyo'
              ? 'Klaviyo drafts with no send time yet. Give one a time in Klaviyo and it appears on the calendar.'
              : `${klaviyoLabel} drafts with no send time. With a connected account, a draft you give a send time in Klaviyo appears on the calendar.`}
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unscheduled.map((c) => (
              <li key={c.id}>
                <Link
                  href={klaviyoCampaignHref(c.id, query)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line-strong)] px-3 py-1 text-sm hover:bg-[var(--surface-hover)]"
                >
                  {c.name}
                  <span className="text-xs text-[var(--text-muted)]">
                    · {klaviyoLabel}
                  </span>
                  <StatusPill status="draft" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
