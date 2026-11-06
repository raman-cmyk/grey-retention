import 'server-only'
import { campaignWorkspace } from '@/features/campaigns/data'
import { klaviyoData, type KlaviyoData } from '@/features/klaviyo-data/reader'
import { localCalendarDate } from '@/features/campaigns/calendar-model'
import { validTimezone } from '@/lib/brand-time'
import { createClient } from '@/lib/supabase/server'
import {
  filterEntries,
  plannerEntries,
  plannerMonth,
  plannerSummary,
  readPlannerQuery,
  statusCounts,
  undatedShown,
  type PlannerHoliday
} from './model'

/** One plain line on where the Klaviyo chips come from. */
export function klaviyoLine(data: KlaviyoData) {
  if (data.state === 'sample')
    return 'Klaviyo sends here are sample data, not from a real account.'
  if (data.state === 'not_connected')
    return "Klaviyo is not connected, so only this workspace's campaigns are shown."
  return "Klaviyo sends aren't available yet, so only this workspace's campaigns are shown."
}

/** This workspace's holidays and events between two dates (inclusive). */
async function holidaysBetween(
  tenantId: string,
  from: string,
  to: string
): Promise<{ holidays: PlannerHoliday[]; failed: boolean }> {
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { holidays: [], failed: false }
  const { data, error } = await db
    .from('holidays')
    .select('id,name,event_date')
    .eq('tenant_id', tenantId)
    .gte('event_date', from)
    .lte('event_date', to)
    .order('event_date')
    .order('id')
  if (error) return { holidays: [], failed: true }
  return {
    holidays: (data ?? []).map((h) => ({
      id: h.id,
      name: h.name,
      date: h.event_date
    })),
    failed: false
  }
}

/**
 * Everything the Campaigns planner shows (docs/UI_REBUILD_SPEC.md §6), in
 * ONE brand timezone: this workspace's campaigns AND the Klaviyo sends,
 * holidays for the visible weeks, and filters read from the URL.
 */
export async function plannerView(
  raw: Record<string, string | string[] | undefined>
) {
  const workspace = await campaignWorkspace()
  const { context } = workspace
  const now = new Date()
  const timezone = validTimezone(context.timezone)
  const query = readPlannerQuery(raw, timezone, now)
  const klaviyo = await klaviyoData(context.tenantId, timezone, now.getTime())
  const snapshot = klaviyo.state === 'sample' ? klaviyo.snapshot : null
  const klaviyoLabel = klaviyo.state === 'sample' ? 'Klaviyo sample' : 'Klaviyo'
  // When this workspace's campaigns could not load, the month is not
  // "empty": the page says so instead of counting zero.
  const campaignsFailed = Boolean(workspace.error) || !workspace.data
  const { entries, unscheduled } = plannerEntries({
    campaigns: workspace.data?.campaigns ?? [],
    snapshot,
    timezone,
    now,
    includeReplaced: query.history,
    query,
    klaviyoLabel
  })
  const shown = filterEntries(entries, query)
  const inMonth = entries.filter((e) =>
    localCalendarDate(new Date(e.at), timezone).startsWith(`${query.m}-`)
  )
  // The visible weeks start and end outside the month, so ask for those
  // days' holidays too.
  const frame = plannerMonth({
    month: query.m,
    timezone,
    entries: [],
    holidays: [],
    now
  })
  // Postgres dates run from year 1 to 9999; the first and last weeks of
  // the calendar can reach past them.
  const clamp = (day: string) =>
    day.length > 10 ? '9999-12-31' : day < '0001-01-01' ? '0001-01-01' : day
  const { holidays, failed: holidaysFailed } = await holidaysBetween(
    context.tenantId,
    clamp(frame.days[0].date),
    clamp(frame.days.at(-1)!.date)
  )
  const month = plannerMonth({
    month: query.m,
    timezone,
    entries: shown,
    holidays,
    now
  })
  return {
    workspace,
    query,
    timezone,
    month,
    holidaysFailed,
    klaviyoLine: klaviyoLine(klaviyo),
    klaviyoLabel,
    campaignsFailed,
    summary: campaignsFailed
      ? 'Your campaigns could not load, so this month is not complete.'
      : plannerSummary(inMonth, klaviyoLabel),
    // Counts in the status pills follow the channel filter only, and
    // include the undated Klaviyo drafts the table lists.
    counts: statusCounts(
      filterEntries(inMonth, { ...query, status: 'all' }),
      undatedShown(unscheduled, { status: 'all', channel: query.channel })
        .length
    ),
    // The undated Klaviyo drafts this view lists (same rule everywhere).
    unscheduled: undatedShown(unscheduled, query),
    now,
    owner: context.tenantRole === 'owner'
  }
}
