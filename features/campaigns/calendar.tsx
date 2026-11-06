import Link from 'next/link'
import type { Route } from 'next'
import { ChevronLeft, ChevronRight, CalendarDays, List } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Notice } from '@/components/ui/workspace'
import { StatusMark } from '@/components/ui/status-mark'
import { Pill, StatusPill } from '@/components/ui/pill'
import { cn } from '@/lib/utils'
import { controlClass } from '@/components/ui/control'
import { campaignStatusOf, hasDeliveryProblem } from './status'
import {
  buildCampaignCalendar,
  type CalendarCampaign,
  type CalendarDay,
  type CalendarView
} from './calendar-model'

const weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
]

function calendarHref(month: string, view: CalendarView) {
  return `/campaign-agent?m=${month}&view=${view}` as Route
}

/** The one campaign status (UIR-015), or "Replaced" for history entries. */
function CampaignStatusPill({
  campaign,
  compact = false
}: {
  campaign: CalendarCampaign
  compact?: boolean
}) {
  const status = campaignStatusOf(campaign)
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {status ? (
        <StatusPill status={status} />
      ) : (
        <Pill title="A newer plan replaced this entry.">Replaced</Pill>
      )}
      {hasDeliveryProblem(campaign) && (
        <Pill tone="danger" title="Delivery stopped with an error.">
          {compact ? 'Problem' : 'Delivery problem'}
        </Pill>
      )}
    </span>
  )
}

function CampaignCard({
  campaign,
  timezone,
  compact = false
}: {
  campaign: CalendarCampaign
  timezone: string
  compact?: boolean
}) {
  return (
    <Link
      href={`/campaigns/${campaign.id}` as Route}
      className={cn(
        'group block min-w-0 rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-3 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:ring-offset-2 focus-visible:outline-none',
        compact && 'p-2.5'
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
        <time
          dateTime={campaign.planned_at}
          className="font-medium tabular-nums"
        >
          {new Intl.DateTimeFormat('en', {
            timeZone: timezone,
            hour: 'numeric',
            minute: '2-digit'
          }).format(new Date(campaign.planned_at))}
        </time>
        <span className="text-[0.65rem]">
          {campaign.channel === 'email_design' ? 'Design' : 'Text'}
        </span>
      </div>
      <h3
        className={cn(
          'mt-2 text-sm leading-5 font-semibold break-words',
          compact && 'text-xs leading-4'
        )}
      >
        {campaign.title}
      </h3>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <CampaignStatusPill campaign={campaign} compact={compact} />
        <span className="text-[0.65rem] text-[var(--text-muted)]">
          v{campaign.calendar_revision}
        </span>
      </div>
      {!compact && (
        <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
          {campaign.channel === 'email_design' ? 'Design email' : 'Text email'}
          {campaign.synthetic && ' · Synthetic demo'}
        </p>
      )}
    </Link>
  )
}

function MonthGrid({
  days,
  label,
  timezone
}: {
  days: CalendarDay[]
  label: string
  timezone: string
}) {
  const weeks = Array.from({ length: days.length / 7 }, (_, index) =>
    days.slice(index * 7, index * 7 + 7)
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
                className="border-y border-[var(--line)] bg-[var(--surface-hover)] px-3 py-3 text-left text-xs font-medium text-[var(--text-muted)]"
              >
                <span aria-hidden="true">{weekday.slice(0, 3)}</span>
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
                    'border-b border-[var(--line)] p-2 align-top [&:not(:last-child)]:border-r',
                    !day.inMonth && 'bg-[var(--surface-hover)]'
                  )}
                >
                  <div className="min-h-32">
                    <time
                      dateTime={day.date}
                      aria-label={`${day.label}${day.today ? ', today' : ''}${!day.inMonth ? ', outside selected month' : ''}`}
                      aria-current={day.today ? 'date' : undefined}
                      className={cn(
                        'mb-2 inline-flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-xs font-medium tabular-nums',
                        day.inMonth
                          ? 'text-[var(--text)]'
                          : 'text-[var(--text-muted)]',
                        day.today &&
                          'bg-[var(--brand-soft)] text-[var(--brand-ink)]'
                      )}
                    >
                      {day.day}
                    </time>
                    <div className="space-y-2">
                      {day.campaigns.map((campaign) => (
                        <CampaignCard
                          key={campaign.id}
                          campaign={campaign}
                          timezone={timezone}
                          compact
                        />
                      ))}
                    </div>
                    {day.inMonth && day.campaigns.length === 0 && (
                      <span className="sr-only">No campaigns planned.</span>
                    )}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CampaignAgenda({
  days,
  timezone,
  mobile = false
}: {
  days: CalendarDay[]
  timezone: string
  mobile?: boolean
}) {
  return (
    <div
      className={cn('space-y-5 p-5 sm:p-6', mobile && 'md:hidden')}
      aria-label="Campaign agenda"
    >
      {days
        .filter((day) => day.campaigns.length > 0)
        .map((day) => (
          <section key={day.date} aria-label={day.label}>
            <div className="mb-2.5 flex items-center gap-2">
              <time
                dateTime={day.date}
                className="text-xs font-semibold text-[var(--text-muted)]"
              >
                {day.label}
              </time>
              {day.today && (
                <StatusMark tone="active" variant="text">
                  Today
                </StatusMark>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {day.campaigns.map((campaign) => (
                <CampaignCard
                  key={campaign.id}
                  campaign={campaign}
                  timezone={timezone}
                />
              ))}
            </div>
          </section>
        ))}
    </div>
  )
}

function CampaignList({
  campaigns,
  timezone
}: {
  campaigns: CalendarCampaign[]
  timezone: string
}) {
  return (
    <ol
      className="divide-y divide-[var(--line)] border-t border-[var(--line)]"
      aria-label="Campaign list"
    >
      {campaigns.map((campaign) => {
        return (
          <li key={campaign.id}>
            <Link
              href={`/campaigns/${campaign.id}` as Route}
              className="grid gap-3 px-5 py-4 transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none focus-visible:ring-inset sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center sm:px-6"
            >
              <time
                dateTime={campaign.planned_at}
                className="text-xs leading-5 text-[var(--text-muted)] tabular-nums"
              >
                <span className="font-medium text-[var(--text)]">
                  {new Intl.DateTimeFormat('en', {
                    timeZone: timezone,
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric'
                  }).format(new Date(campaign.planned_at))}
                </span>
                <span className="ml-2 sm:ml-0 sm:block">
                  {new Intl.DateTimeFormat('en', {
                    timeZone: timezone,
                    hour: 'numeric',
                    minute: '2-digit'
                  }).format(new Date(campaign.planned_at))}
                </span>
              </time>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold break-words">
                  {campaign.title}
                </h3>
                <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  {campaign.channel === 'email_design'
                    ? 'Design email'
                    : 'Text email'}
                  {campaign.synthetic && ' · Synthetic demo'}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <CampaignStatusPill campaign={campaign} />
                <span className="text-xs text-[var(--text-muted)]">
                  v{campaign.calendar_revision}
                </span>
              </div>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}

export function CampaignCalendar({
  campaigns,
  month,
  view,
  timezone
}: {
  campaigns: CalendarCampaign[]
  month: string
  view: CalendarView
  timezone: string
}) {
  const calendar = buildCampaignCalendar({ campaigns, month, view, timezone })
  return (
    <section
      className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)]"
      aria-labelledby="calendar-month-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
        <div>
          <h2
            id="calendar-month-title"
            className="text-xl font-semibold tracking-tight"
          >
            {calendar.label}
          </h2>
          <p className="mt-1.5 text-xs leading-5 text-[var(--text-muted)]">
            {calendar.entries.length}{' '}
            {calendar.entries.length === 1 ? 'campaign' : 'campaigns'}
            {' · '}
            {calendar.reviewCount} awaiting review
            {' · '}
            {calendar.approvedCount} approved
            {calendar.scheduledCount > 0 &&
              ` · ${calendar.scheduledCount} scheduled`}
          </p>
        </div>
        <div
          className="flex items-center gap-1.5"
          aria-label="Month navigation"
        >
          <Button asChild variant="secondary" size="sm">
            <Link href={calendarHref(calendar.todayMonth, view)} scroll={false}>
              Today
            </Link>
          </Button>
          {calendar.previousMonth ? (
            <Button asChild variant="quiet" size="sm" className="min-h-9 px-2">
              <Link
                href={calendarHref(calendar.previousMonth, view)}
                scroll={false}
                aria-label="Previous month"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button
              disabled
              variant="quiet"
              size="sm"
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Button>
          )}
          {calendar.nextMonth ? (
            <Button asChild variant="quiet" size="sm" className="min-h-9 px-2">
              <Link
                href={calendarHref(calendar.nextMonth, view)}
                scroll={false}
                aria-label="Next month"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button disabled variant="quiet" size="sm" aria-label="Next month">
              <ChevronRight className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3 sm:px-6">
        <nav
          className="inline-flex rounded-lg bg-[var(--surface-hover)] p-1"
          aria-label="Calendar view"
        >
          {(
            [
              { value: 'calendar', label: 'Calendar', icon: CalendarDays },
              { value: 'list', label: 'List', icon: List },
              { value: 'history', label: 'History', icon: null }
            ] as const
          ).map(({ value, label, icon: Icon }) => (
            <Link
              key={value}
              href={calendarHref(month, value)}
              scroll={false}
              aria-current={view === value ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none',
                view === value &&
                  'bg-[var(--surface-raised)] text-[var(--text)] shadow-sm'
              )}
            >
              {Icon && <Icon className="size-3.5" aria-hidden="true" />}
              {label}
            </Link>
          ))}
        </nav>
        <form className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="view" value={view} />
          <label htmlFor="calendar-month" className="sr-only">
            Month
          </label>
          <input
            key={month}
            id="calendar-month"
            name="m"
            type="month"
            min="0001-01"
            max="9999-12"
            defaultValue={month}
            className={cn(
              controlClass,
              'min-h-9 w-auto max-w-full px-2.5 py-1 text-xs'
            )}
          />
          <Button variant="secondary" size="sm" className="min-h-9">
            Show month
          </Button>
        </form>
      </div>
      {view === 'history' && (
        <p className="border-t border-[var(--line)] px-5 py-3 text-xs leading-5 text-[var(--text-muted)] sm:px-6">
          History includes superseded calendar entries. Each link opens its
          exact campaign record.
        </p>
      )}
      {calendar.entries.length === 0 && (
        <div className="px-5 py-4 sm:px-6">
          <Notice>No entries for this month. Create a campaign below.</Notice>
        </div>
      )}
      {view === 'calendar' ? (
        <>
          <MonthGrid
            days={calendar.days}
            label={calendar.label}
            timezone={timezone}
          />
          {calendar.entries.length > 0 && (
            <CampaignAgenda days={calendar.days} timezone={timezone} mobile />
          )}
        </>
      ) : (
        calendar.entries.length > 0 && (
          <CampaignList campaigns={calendar.entries} timezone={timezone} />
        )
      )}
      <div className="border-t border-[var(--line)] px-5 py-3 text-xs text-[var(--text-muted)] sm:px-6">
        All dates and times shown in {timezone}. Synthetic campaigns use demo
        data.
      </div>
    </section>
  )
}
