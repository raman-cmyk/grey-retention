import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { fingerprints } from '@/features/klaviyo-push/fingerprints'
import { findStoreMetrics } from '@/lib/providers/klaviyo/catalog'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import { readDraft } from '@/lib/providers/klaviyo/drafts'
import {
  maxReportCampaigns,
  readCampaignResults,
  readLinkClicks,
  type LinkClicks,
  type VariationResult
} from '@/lib/providers/klaviyo/results'
import { emailSections } from './sections'
import {
  afterStatus,
  attributionMs,
  dayMs,
  hourMs,
  pauseMs,
  pausedPatch,
  reportGraceMs,
  resultsPatch,
  sampleResults,
  sampleStatus,
  sendTimeOf,
  type ReadContext,
  type ResultPatch,
  type ResultRow,
  type StatusRead
} from './sync'

type Db = SupabaseClient<Database>

/**
 * Where a workspace's pushed emails are read: its live Klaviyo account
 * (with its currency, when KLV-001 read it), or nowhere for now (logged
 * and looked at again later, D16).
 */
export type ResultsSource =
  | { kind: 'live'; client: KlaviyoClient; currency: string | null }
  | { kind: 'off'; reason: string }

export type ResultsRun = {
  state: 'done'
  /** Emails looked at and saved. */
  checked: number
  /** Results reads saved. */
  pulled: number
  /** Checks that could not read Klaviyo (put back for later, or ended). */
  paused: number
  /** Checks left for the next run (out of time). */
  deferred: number
  /** Checks whose outcome could not be saved (logged; tried next run). */
  failed: number
}

/** Checks claimed at a time, and claims per run at most. */
export const resultsBatch = 40
export const maxClaims = 5
/** No new claim, workspace or Klaviyo request starts after this much of the run. */
export const resultsBudgetMs = 35_000
/**
 * Klaviyo requests kept back in a workspace for its results questions
 * once an email is due (the metrics and the report; clicks not read in
 * time keep the earlier ones).
 */
const resultsReserve = 2
/** The least time between two click questions (Klaviyo allows 3 a second). */
export const clickGapMs = 350

type Context = {
  html: string
  builtAt: number
  templates: { approach?: unknown; variation?: unknown; deleted?: unknown }[]
  written: string | null
}

/** Each claimed email's built HTML and its push (our templates, what we last wrote). */
async function contexts(
  db: Db,
  rows: ResultRow[]
): Promise<Map<string, Context>> {
  const builds = await db
    .from('email_builds')
    .select('id,push_key,created_at,html:email->>html')
    .in(
      'id',
      rows.map((r) => r.build_id)
    )
  if (builds.error) throw builds.error
  const keys = (builds.data ?? []).map((b) => b.push_key)
  const pushes = keys.length
    ? await db
        .from('klaviyo_draft_pushes')
        .select('tenant_id,push_key,templates,written')
        .in('push_key', keys)
    : { data: [], error: null }
  if (pushes.error) throw pushes.error
  const found = new Map<string, Context>()
  for (const row of rows) {
    const build = builds.data?.find((b) => b.id === row.build_id)
    const push = pushes.data?.find(
      (p) => p.push_key === build?.push_key && p.tenant_id === row.tenant_id
    )
    const html = (build as { html?: unknown } | undefined)?.html
    const builtAt = Date.parse(build?.created_at ?? row.created_at)
    found.set(row.build_id, {
      html: typeof html === 'string' ? html : '',
      builtAt: Number.isFinite(builtAt) ? builtAt : Date.parse(row.created_at),
      templates: Array.isArray(push?.templates)
        ? (push.templates as Context['templates'])
        : [],
      written: push?.written ?? null
    })
  }
  return found
}

const pauseOf = (error: KlaviyoError) =>
  error.kind === 'rate_limited'
    ? 'rate_limited'
    : error.kind === 'bad_key'
      ? 'klaviyo_key_rejected'
      : error.kind === 'missing_scope'
        ? 'klaviyo_scope_missing'
        : error.kind === 'unavailable'
          ? 'klaviyo_unavailable'
          : 'klaviyo_answer'

const waitFor = (reason: string, error?: KlaviyoError) =>
  reason === 'rate_limited'
    ? Math.max(
        pauseMs.rate_limited,
        (error?.details.retryAfterSeconds ?? 60) * 1000
      )
    : reason in pauseMs
      ? pauseMs[reason as keyof typeof pauseMs]
      : pauseMs.default

/** A failure that stops every check of the account (not one email's). */
const stopsAccount = (error: KlaviyoError) =>
  pauseOf(error) !== 'klaviyo_answer'

class TimeUp extends Error {
  constructor() {
    super('time_up')
  }
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/**
 * The hourly results run: claims due checks (again while time is left),
 * and for each workspace looks at its emails in Klaviyo (a synthetic
 * brand's sample drafts in code), then asks for the due results at once.
 * One check that cannot be saved is logged and left for the next run;
 * it never stops the others.
 */
export async function runEmailResults(
  db: Db,
  deps: {
    sourceFor: (tenantId: string) => Promise<ResultsSource>
    now?: () => number
    /** No new claim, workspace or Klaviyo request starts past this time. */
    deadline: number
    /** The longest one Klaviyo request may take. */
    callMs?: number
    limit?: number
    wait?: (ms: number) => Promise<void>
  }
): Promise<ResultsRun> {
  const now = deps.now ?? Date.now
  const callMs = deps.callMs ?? 6_000
  const wait = deps.wait ?? sleep
  const run: ResultsRun = {
    state: 'done',
    checked: 0,
    pulled: 0,
    paused: 0,
    deferred: 0,
    failed: 0
  }
  let context = new Map<string, Context>()

  const save = async (row: ResultRow, patch: ResultPatch) => {
    const saved = await db.rpc('save_klaviyo_result', {
      build: row.build_id,
      lease: row.lease_token!,
      patch: patch as unknown as Json
    })
    if (saved.error) {
      // Logged and left: its lease runs out and the next run looks again.
      run.failed++
      logger.warn('Email result not saved', {
        code:
          saved.error.code === 'PT409'
            ? 'lease_lost'
            : (saved.error.code ?? 'save_failed')
      })
      return false
    }
    run.checked++
    if (patch.pulls !== undefined && patch.pulls > row.pulls) run.pulled++
    if (patch.paused) run.paused++
    return true
  }
  const pause = (
    row: ResultRow,
    reason: string,
    error?: KlaviyoError,
    patch?: ResultPatch
  ) => save(row, pausedPatch(row, reason, now(), waitFor(reason, error), patch))

  for (let claims = 0; claims < maxClaims; claims++) {
    if (now() + callMs > deps.deadline) break
    const deferredBefore = run.deferred
    const claimed = await db.rpc('claim_klaviyo_results', {
      lim: deps.limit ?? resultsBatch
    })
    if (claimed.error) throw claimed.error
    const rows = (claimed.data ?? []) as ResultRow[]
    if (!rows.length) break
    context = await contexts(db, rows)
    for (const tenantId of [...new Set(rows.map((r) => r.tenant_id))]) {
      const own = rows.filter((r) => r.tenant_id === tenantId)
      if (now() >= deps.deadline) {
        // Left leased: picked up again once the lease runs out.
        run.deferred += own.length
        continue
      }
      for (const row of own.filter((r) => r.sample)) await readSample(row)
      const live = own.filter((r) => !r.sample)
      if (!live.length) continue
      const source = await deps.sourceFor(tenantId)
      if (source.kind === 'off') {
        logger.info('Email results not read', { reason: source.reason })
        for (const row of live) await pause(row, source.reason)
        continue
      }
      await readLive(source, live)
    }
    // A batch not finished in time, or not full: no more claims.
    if (run.deferred > deferredBefore) break
    if (rows.length < (deps.limit ?? resultsBatch)) break
  }
  return run

  /** A synthetic brand's sample draft: no Klaviyo call. */
  async function readSample(row: ResultRow) {
    const t = now()
    const ctx = context.get(row.build_id)!
    const sections = emailSections(ctx.html)
    const read = sampleStatus(row, t)
    const checked = afterStatus(row, read, t, ctx.builtAt)
    const sentAt = checked.patch.sent_at ?? row.sent_at
    if (!checked.pullDue || !sentAt) return save(row, checked.patch)
    const sample = sampleResults(row, sections)
    return save(row, {
      ...checked.patch,
      ...resultsPatch(
        row,
        sentAt,
        {
          ...sample,
          templates: [],
          sections,
          context: {
            conversion: 'placed_order',
            attributionOpen: t < Date.parse(sentAt) + attributionMs,
            sendStrategy: 'static',
            sentAtFrom: row.sent_at
              ? sentAtFromOf(
                  read as Extract<StatusRead, { found: true }>,
                  row.sent_at
                )
              : sendTimeOf(read, t, ctx.builtAt).from,
            clicksBy: 'message',
            botsLeftOut: 0,
            reported: true
          }
        },
        t
      )
    })
  }

  /** One workspace's live emails: each one's status, then the due results at once. */
  async function readLive(
    source: Extract<ResultsSource, { kind: 'live' }>,
    live: ResultRow[]
  ) {
    const client = source.client
    const done = new Set<string>()
    const timed = <T>(call: () => Promise<T>, reserve = 0) => {
      if (now() + callMs * (1 + reserve) > deps.deadline) throw new TimeUp()
      return call()
    }
    type Due = {
      row: ResultRow
      patch: ResultPatch
      sentAt: string
      dueAt: number
      read: Extract<StatusRead, { found: true }>
      trackingParams: string[]
    }
    const due: Due[] = []
    const patchOf = (row: ResultRow) =>
      due.find((d) => d.row.build_id === row.build_id)?.patch
    /** Every check of the account not saved yet, put back with what was seen. */
    const stopAll = async (error: KlaviyoError) => {
      const reason = pauseOf(error)
      logger.warn('Email results paused', {
        reason,
        endpoint: error.details.endpoint,
        status: error.details.status ?? 0,
        retryAfterSeconds: error.details.retryAfterSeconds ?? 0
      })
      for (const row of live)
        if (!done.has(row.build_id)) {
          done.add(row.build_id)
          await pause(row, reason, error, patchOf(row))
        }
    }
    /** A read saved without parts Klaviyo did not give (they wait no longer). */
    const saveDue = async (
      d: Due,
      /** null: not read this time (the earlier ones are kept). */
      results: VariationResult[] | null,
      clicks: LinkClicks[] | null,
      complete: boolean,
      readContext: ReadContext
    ) => {
      const ctx = context.get(d.row.build_id)!
      done.add(d.row.build_id)
      await save(d.row, {
        ...d.patch,
        ...resultsPatch(
          d.row,
          d.sentAt,
          {
            results,
            clicks,
            complete,
            templates: ctx.templates,
            sections: emailSections(ctx.html),
            trackingParams: d.trackingParams,
            context: readContext
          },
          now()
        )
      })
    }
    // Sent emails first: their results are what is due.
    const ordered = [...live].sort(
      (a, b) => Number(b.status === 'sent') - Number(a.status === 'sent')
    )
    try {
      for (const row of ordered) {
        let draft: Awaited<ReturnType<typeof readDraft>>
        try {
          // Time is kept back for the results questions of the emails due.
          draft = await timed(
            () => readDraft(client, row.message_id!),
            due.length ? resultsReserve : 0
          )
        } catch (error) {
          if (error instanceof TimeUp) {
            // No more status reads: the ones not read wait for the next
            // run (leased until then); the due ones are read now.
            for (const r of ordered)
              if (
                !done.has(r.build_id) &&
                !due.some((d) => d.row.build_id === r.build_id)
              ) {
                done.add(r.build_id)
                run.deferred++
              }
            break
          }
          if (!(error instanceof KlaviyoError) || stopsAccount(error))
            throw error
          // This email's answer only: logged, looked at again later.
          logger.warn('Email status unreadable', {
            endpoint: error.details.endpoint,
            status: error.details.status ?? 0
          })
          done.add(row.build_id)
          await pause(row, 'klaviyo_answer', error)
          continue
        }
        const ctx = context.get(row.build_id)!
        const read: StatusRead = draft
          ? {
              found: true,
              status: draft.status,
              sendTime: draft.sendTime,
              firstSendTime: draft.firstSendTime,
              sendStrategy: draft.sendStrategy,
              changed:
                draft.campaignId !== row.campaign_id ||
                (ctx.written !== null &&
                  fingerprints(draft.variations) !== ctx.written)
            }
          : { found: false }
        const checked = afterStatus(row, read, now(), ctx.builtAt)
        const sentAt = checked.patch.sent_at ?? row.sent_at
        if (checked.pullDue && sentAt && read.found)
          due.push({
            row,
            patch: checked.patch,
            sentAt,
            dueAt: checked.dueAt,
            read,
            trackingParams: draft?.trackingParams ?? []
          })
        else {
          done.add(row.build_id)
          await save(row, checked.patch)
        }
      }
      if (!due.length) return
      const metrics = await timed(() =>
        findStoreMetrics(client, () => now() + callMs <= deps.deadline)
      )
      if (!metrics.placedOrder && !metrics.clickedEmail) {
        for (const d of due) {
          done.add(d.row.build_id)
          await pause(d.row, 'klaviyo_no_metrics', undefined, d.patch)
        }
        return
      }
      // Without a Placed Order metric the counts are read, never orders.
      const conversion = metrics.placedOrder ? 'placed_order' : 'clicked_email'
      const conversionId = metrics.placedOrder ?? metrics.clickedEmail!
      const reportTo = new Date(now() + dayMs)
      const reported = new Map<
        string,
        { rows: VariationResult[]; complete: boolean; from: Date }
      >()
      for (let i = 0; i < due.length; i += maxReportCampaigns) {
        const part = due.slice(i, i + maxReportCampaigns)
        const from = new Date(
          Math.min(...part.map((d) => Date.parse(d.sentAt))) - dayMs
        )
        let read: Awaited<ReturnType<typeof readCampaignResults>>
        try {
          read = await timed(() =>
            readCampaignResults(
              client,
              conversionId,
              [...new Set(part.map((d) => d.row.campaign_id))],
              { from, to: reportTo }
            )
          )
        } catch (error) {
          if (!(error instanceof KlaviyoError) || stopsAccount(error))
            throw error
          // An answer we cannot read: these reads wait, at most half a day.
          logger.warn('Email results report unreadable', {
            endpoint: error.details.endpoint,
            status: error.details.status ?? 0
          })
          for (const d of part) {
            if (now() > d.dueAt + reportGraceMs)
              await saveDue(d, null, null, false, {
                conversion,
                currency: source.currency,
                reported: false
              })
            else {
              done.add(d.row.build_id)
              await pause(d.row, 'klaviyo_answer', error, d.patch)
            }
          }
          continue
        }
        for (const d of part)
          reported.set(d.row.build_id, {
            // Matched on the campaign: Klaviyo may give its own id as the
            // message's (our drafts have one message each).
            rows: read.rows.filter((r) => r.campaignId === d.row.campaign_id),
            complete: read.complete,
            from
          })
      }
      let clicksStopped = false
      let lastClick = 0
      for (const d of due) {
        const report = reported.get(d.row.build_id)
        if (!report) continue
        // Not reported yet: waited for, at most half a day, then saved as not whole.
        if (!report.rows.length && now() <= d.dueAt + reportGraceMs) {
          done.add(d.row.build_id)
          await pause(d.row, 'klaviyo_not_reported', undefined, d.patch)
          continue
        }
        const clicksFrom = new Date(Date.parse(d.sentAt) - dayMs)
        const clicksTo = new Date(now() + hourMs)
        // People clicked, as the report says (or, not reported, the last read).
        const clicked = (
          report.rows.length
            ? report.rows.map((r) => r.statistics)
            : (Array.isArray(d.row.results) ? d.row.results : []).map(
                (r) =>
                  ((r as { statistics?: Record<string, number> } | null)
                    ?.statistics ?? {}) as Record<string, number>
              )
        ).reduce((n, st) => n + (st.clicks_unique ?? 0), 0)
        // The key that found clicks last time first, then the other.
        const byMessage = [d.row.message_id!, 'message'] as const
        const byCampaign = [d.row.campaign_id, 'campaign'] as const
        const keys =
          (d.row.context as { clicksBy?: unknown } | null)?.clicksBy ===
          'campaign'
            ? [byCampaign, byMessage]
            : [byMessage, byCampaign]
        let clicks: LinkClicks[] = []
        let clicksRead = false
        let clicksComplete = !!metrics.clickedEmail && metrics.complete
        let clicksBy: ReadContext['clicksBy'] = null
        let bots = 0
        if (metrics.clickedEmail && !clicksStopped) {
          // By the message, else (none found though people clicked) by the campaign.
          for (const [index, [key, by]] of keys.entries()) {
            // The other key only when none came though people clicked.
            if (index > 0 && (clicks.length || !clicked)) break
            try {
              const gap = lastClick + clickGapMs - now()
              if (gap > 0) await wait(gap)
              const read = await timed(() =>
                readLinkClicks(client, metrics.clickedEmail!, key, {
                  from: clicksFrom,
                  to: clicksTo
                })
              ).finally(() => {
                lastClick = now()
              })
              clicksRead = true
              clicks = read.rows
              bots += read.bots
              clicksComplete &&= read.complete
              if (read.rows.length) clicksBy = by
            } catch (error) {
              if (
                !(error instanceof KlaviyoError) &&
                !(error instanceof TimeUp)
              )
                throw error
              if (error instanceof TimeUp) {
                // Out of time: the results stand, the earlier clicks are kept.
                clicksStopped = true
                clicksComplete = false
                clicksRead = false
                break
              }
              // The results stand; the clicks are not whole this time.
              logger.warn('Email clicks unreadable', {
                endpoint: error.details.endpoint,
                status: error.details.status ?? 0
              })
              clicksComplete = false
              // A part not read keeps the earlier clicks.
              clicksRead = false
              if (error.kind === 'rate_limited' || stopsAccount(error))
                clicksStopped = true
              break
            }
          }
          if (clicked > 0 && !clicks.length) {
            // None found though people clicked: the earlier clicks stand.
            clicksComplete = false
            clicksRead = false
          }
        } else clicksComplete = false
        await saveDue(
          d,
          // Not reported (after waiting): the earlier results are kept.
          !report.rows.length
            ? null
            : report.rows.map((r) =>
                metrics.placedOrder
                  ? r
                  : {
                      ...r,
                      statistics: Object.fromEntries(
                        Object.entries(r.statistics).filter(
                          ([k]) =>
                            !k.startsWith('conversion') &&
                            k !== 'revenue_per_recipient'
                        )
                      )
                    }
              ),
          clicksRead ? clicks : null,
          report.complete &&
            report.rows.length > 0 &&
            clicksComplete &&
            !!metrics.placedOrder,
          {
            reportFrom: report.from.toISOString(),
            reportTo: reportTo.toISOString(),
            clicksFrom: clicksFrom.toISOString(),
            clicksTo: clicksTo.toISOString(),
            currency: source.currency,
            conversion,
            attributionOpen: now() < Date.parse(d.sentAt) + attributionMs,
            sendStrategy: d.read.sendStrategy ?? null,
            sentAtFrom: d.row.sent_at
              ? sentAtFromOf(d.read, d.row.sent_at)
              : sendTimeOf(d.read, now(), context.get(d.row.build_id)!.builtAt)
                  .from,
            clicksBy,
            botsLeftOut: Math.min(999_999_999, bots),
            reported: report.rows.length > 0
          }
        )
      }
    } catch (error) {
      if (error instanceof TimeUp) {
        // Out of time for the results: what each status read said is
        // kept, and the read is due again at the next run.
        for (const d of due)
          if (!done.has(d.row.build_id)) {
            done.add(d.row.build_id)
            // Its read waits for the next run.
            run.deferred++
            await save(d.row, d.patch)
          }
        run.deferred += live.filter((r) => !done.has(r.build_id)).length
        return
      }
      if (!(error instanceof KlaviyoError)) throw error
      await stopAll(error)
    }
  }
}

/** Where a send time saved earlier came from, as far as this read tells. */
function sentAtFromOf(
  read: Extract<StatusRead, { found: true }>,
  sentAt: string
): NonNullable<ReadContext['sentAtFrom']> {
  const same = (t: string | null | undefined) =>
    !!t && Date.parse(t) === Date.parse(sentAt)
  return same(read.sendTime)
    ? 'send_time'
    : same(read.firstSendTime)
      ? 'send_times'
      : 'first_seen'
}
