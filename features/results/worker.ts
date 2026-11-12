import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { fingerprints } from '@/features/klaviyo-push/pusher'
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
import { emailSections, type EmailSection } from './sections'
import {
  afterStatus,
  dayMs,
  hourMs,
  pauseMs,
  resultsPatch,
  sampleResults,
  sampleStatus,
  type ResultPatch,
  type ResultRow,
  type StatusRead
} from './sync'

type Db = SupabaseClient<Database>

/**
 * Where a workspace's pushed emails are read: its live Klaviyo account, or
 * nowhere for now (logged and looked at again later, D16).
 */
export type ResultsSource =
  { kind: 'live'; client: KlaviyoClient } | { kind: 'off'; reason: string }

export type ResultsRun = {
  state: 'done' | 'failed'
  /** Emails looked at and saved. */
  checked: number
  /** Results reads saved. */
  pulled: number
  /** Checks that could not read Klaviyo (put back for later). */
  paused: number
  /** Workspaces left for the next run (out of time). */
  deferred: number
  code?: string
}

/** Checks claimed per run, and the most one run starts. */
export const resultsBatch = 40
/** No new workspace is started after this much of the run. */
export const resultsBudgetMs = 35_000

type Context = {
  html: string
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
    .select('id,push_key,email')
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
    const html = (build?.email as { html?: unknown } | null)?.html
    found.set(row.build_id, {
      html: typeof html === 'string' ? html : '',
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
    : reason === 'klaviyo_unavailable'
      ? pauseMs.klaviyo_unavailable
      : reason === 'klaviyo_answer'
        ? pauseMs.klaviyo_answer
        : pauseMs.default

/** A failure that stops every check of the workspace (not one email's). */
const stopsAccount = (reason: string) => reason !== 'klaviyo_answer'

export async function runEmailResults(
  db: Db,
  deps: {
    sourceFor: (tenantId: string) => Promise<ResultsSource>
    now?: () => number
    /** No new workspace or Klaviyo request starts past this time. */
    deadline: number
    /** The longest one Klaviyo request may take. */
    callMs?: number
    limit?: number
  }
): Promise<ResultsRun> {
  const now = deps.now ?? Date.now
  const callMs = deps.callMs ?? 6_000
  const run: ResultsRun = {
    state: 'done',
    checked: 0,
    pulled: 0,
    paused: 0,
    deferred: 0
  }
  const claimed = await db.rpc('claim_klaviyo_results', {
    lim: deps.limit ?? resultsBatch
  })
  if (claimed.error) throw claimed.error
  const rows = (claimed.data ?? []) as ResultRow[]
  if (!rows.length) return run
  const context = await contexts(db, rows)
  const save = async (row: ResultRow, patch: ResultPatch) => {
    const saved = await db.rpc('save_klaviyo_result', {
      build: row.build_id,
      lease: row.lease_token!,
      patch: patch as unknown as Json
    })
    if (saved.error) {
      // A lease that ran out: the next run looks at it again.
      if (saved.error.code === 'PT409') {
        logger.warn('Email result not saved', { code: 'lease_lost' })
        return false
      }
      throw saved.error
    }
    run.checked++
    if (patch.pulls !== undefined && patch.pulls > row.pulls) run.pulled++
    if (patch.paused) run.paused++
    return true
  }
  const pause = (row: ResultRow, reason: string, error?: KlaviyoError) =>
    save(row, {
      paused: reason,
      next_check_at: new Date(now() + waitFor(reason, error)).toISOString()
    })

  const tenants = [...new Set(rows.map((r) => r.tenant_id))]
  for (const tenantId of tenants) {
    const own = rows.filter((r) => r.tenant_id === tenantId)
    if (now() >= deps.deadline) {
      // Left leased: picked up again once the lease runs out.
      run.deferred++
      continue
    }
    // A synthetic brand's sample drafts: no Klaviyo call.
    for (const row of own.filter((r) => r.sample)) {
      const t = now()
      const sections = emailSections(context.get(row.build_id)!.html)
      const checked = afterStatus(row, sampleStatus(row, t), t)
      const sentAt = checked.patch.sent_at ?? row.sent_at
      const patch =
        checked.pullDue && sentAt
          ? {
              ...checked.patch,
              ...resultsPatch(
                row,
                sentAt,
                {
                  ...sampleResults(row, sections),
                  templates: [],
                  sections
                },
                t
              )
            }
          : checked.patch
      await save(row, patch)
    }
    const live = own.filter((r) => !r.sample)
    if (!live.length) continue
    const source = await deps.sourceFor(tenantId)
    if (source.kind === 'off') {
      logger.info('Email results not read', { reason: source.reason })
      for (const row of live) await pause(row, source.reason)
      continue
    }
    await readLive(source.client, live)
  }
  return run

  /** One workspace's live emails: each one's status, then the due results at once. */
  async function readLive(client: KlaviyoClient, live: ResultRow[]) {
    const done = new Set<string>()
    const timed = <T>(call: () => Promise<T>) => {
      if (now() + callMs > deps.deadline) throw new TimeUp()
      return call()
    }
    const stop = async (error: unknown) => {
      if (error instanceof TimeUp) {
        run.deferred++
        return
      }
      if (!(error instanceof KlaviyoError)) throw error
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
          await pause(row, reason, error)
        }
    }
    const due: { row: ResultRow; patch: ResultPatch; sentAt: string }[] = []
    try {
      for (const row of live) {
        let read: StatusRead
        try {
          const draft = await timed(() => readDraft(client, row.message_id!))
          const written = context.get(row.build_id)!.written
          read = draft
            ? {
                found: true,
                status: draft.status,
                sendTime: draft.sendTime,
                changed:
                  draft.campaignId !== row.campaign_id ||
                  (written !== null &&
                    fingerprints(draft.variations) !== written)
              }
            : { found: false }
        } catch (error) {
          if (!(error instanceof KlaviyoError)) throw error
          if (stopsAccount(pauseOf(error))) throw error
          // This email's answer only: logged, looked at again later.
          logger.warn('Email status unreadable', {
            endpoint: error.details.endpoint,
            status: error.details.status ?? 0
          })
          done.add(row.build_id)
          await pause(row, 'klaviyo_answer', error)
          continue
        }
        const checked = afterStatus(row, read, now())
        const sentAt = checked.patch.sent_at ?? row.sent_at
        if (checked.pullDue && sentAt)
          due.push({ row, patch: checked.patch, sentAt })
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
          await pause(d.row, 'klaviyo_no_metrics')
        }
        return
      }
      // Without a Placed Order metric the counts are read, never orders.
      const conversion = metrics.placedOrder ?? metrics.clickedEmail!
      const results: VariationResult[] = []
      let complete = true
      for (let i = 0; i < due.length; i += maxReportCampaigns) {
        const part = due.slice(i, i + maxReportCampaigns)
        const from = Math.min(...part.map((d) => Date.parse(d.sentAt))) - dayMs
        const read = await timed(() =>
          readCampaignResults(
            client,
            conversion,
            [...new Set(part.map((d) => d.row.campaign_id))],
            { from: new Date(from), to: new Date(now() + dayMs) }
          )
        )
        results.push(...read.rows)
        complete &&= read.complete
      }
      for (const d of due) {
        let clicks: LinkClicks[] = []
        let clicksComplete = true
        if (metrics.clickedEmail) {
          const read = await timed(() =>
            readLinkClicks(client, metrics.clickedEmail!, d.row.message_id!, {
              from: new Date(Date.parse(d.sentAt) - hourMs),
              to: new Date(now() + hourMs)
            })
          )
          clicks = read.rows
          clicksComplete = read.complete
        }
        const own = results
          .filter(
            (r) =>
              r.campaignId === d.row.campaign_id &&
              r.messageId === d.row.message_id
          )
          .map((r) =>
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
          )
        const ctx = context.get(d.row.build_id)!
        const sections: EmailSection[] = emailSections(ctx.html)
        done.add(d.row.build_id)
        await save(d.row, {
          ...d.patch,
          ...resultsPatch(
            d.row,
            d.sentAt,
            {
              results: own,
              clicks,
              complete: complete && clicksComplete && !!metrics.placedOrder,
              templates: ctx.templates,
              sections
            },
            now()
          )
        })
      }
    } catch (error) {
      await stop(error)
    }
  }
}

class TimeUp extends Error {
  constructor() {
    super('time_up')
  }
}
