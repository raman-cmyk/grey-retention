import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import type { Ask } from '@/features/intelligence/passes'
import {
  accountPath,
  findStoreMetrics,
  type PagedRead
} from '@/lib/providers/klaviyo/catalog'
import { accountFacts } from '@/lib/providers/klaviyo/check-key'
import {
  KlaviyoError,
  type KlaviyoClient
} from '@/lib/providers/klaviyo/client'
import {
  readAudiences,
  readCampaignAudiences,
  readCampaignMessages,
  readCampaignReport,
  readFlowReport,
  readFlows,
  readMessageContent,
  type Audience,
  type CampaignAudience,
  type CampaignMessage,
  type Flow,
  type ReportRow
} from '@/lib/providers/klaviyo/history'
import { findingInput, type FindingInput } from '../findings'
import { klaviyoCallMs } from '../catalog/worker'
import {
  audienceList,
  bestEmails,
  cadence,
  flowResults,
  historySnapshot,
  scheduledEmails,
  sentEmails,
  windowRead,
  zoneOr,
  type HistorySnapshot
} from './facts'
import { historianInput, readHistory, type HistorianRead } from './historian'

type Db = SupabaseClient<Database>
type Job = Database['public']['Tables']['job_runs']['Row']

/** The whole read, so it ends well inside the job's 90-second lease. */
export const historyRunMs = 30_000
/** Sent emails are read from the last year. */
export const historyDays = 365
/** Messages whose content is asked for one by one, at most. */
export const maxContentReads = 20
/** Klaviyo answers one report question a second. */
export const reportGapMs = 1_100

const day = 86_400_000
const none = <T>(): PagedRead<T> => ({
  records: [],
  complete: true,
  skipped: 0
})
const unread = <T>(): PagedRead<T> => ({
  records: [],
  complete: false,
  skipped: 0
})

export type HistoryRun = {
  state: 'ready' | 'empty'
  sent: number
  scheduled: number
  flows: number
  audiences: number
  findings: number
  complete: boolean
  flowsRead: boolean
  live: boolean
  analysis: 'done' | 'skipped'
}

type Finding = FindingInput & {
  pass: 'sample' | 'model' | 'code'
  model: string | null
}

/**
 * The Klaviyo historian's job (ONB-103): reads the account (currency and
 * timezone), the store's Placed Order metric, the emails sent in the last
 * year and those scheduled, the scheduled campaigns' audiences, the
 * campaign report, the flows and their report (when the key can read
 * flows), the lists and segments; counts the history in code; asks the
 * historian to put it into words; and stores it all at once
 * (`record_klaviyo_history`, which also finishes the job).
 *
 * A page is asked for only while there is time for it and the historian's
 * call; a read cut short is stored as incomplete, and one that found
 * nothing in time is tried again. Klaviyo refusing the key, a needed scope
 * or the pace throws (`KlaviyoError`): the job is paused by its runner.
 * Missing Flows access only leaves the flows out.
 */
export async function readBrandHistory(
  db: Db,
  job: Job,
  deps: {
    client: KlaviyoClient
    live: boolean
    ask: Ask | null
    callMs: number
    klaviyoMs?: number
    now?: () => number
    /** Waits between the two report questions (tests pass a fake). */
    sleep?: (ms: number) => Promise<void>
  }
): Promise<HistoryRun> {
  const now = deps.now ?? Date.now
  const started = now()
  const deadline = started + historyRunMs
  const klaviyoMs = deps.klaviyoMs ?? klaviyoCallMs
  const more = () => now() + klaviyoMs + deps.callMs <= deadline
  const sleep =
    deps.sleep ??
    ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)))
  const [brand, tenant] = await Promise.all([
    db
      .from('brand_profiles')
      .select('brand_name')
      .eq('tenant_id', job.tenant_id)
      .single(),
    db.from('tenants').select('timezone').eq('id', job.tenant_id).single()
  ])
  if (brand.error) throw brand.error
  if (tenant.error) throw tenant.error

  const account = accountFacts(
    await deps.client.get(accountPath, 'accounts:read')
  )
  // Every day and hour in the brand's one timezone (UIR-023); the Klaviyo
  // account's only when the workspace has none.
  const timezone = zoneOr(tenant.data.timezone || account.timezone)
  const currency = account.currency
  if (!currency) {
    logger.warn('History read: no currency in the account')
    throw Object.assign(new Error('No store currency'), { code: 'no_currency' })
  }
  const metrics = more()
    ? await findStoreMetrics(deps.client, more)
    : { placedOrder: null, viewedProduct: null, complete: false }

  const sentRead: PagedRead<CampaignMessage> = more()
    ? await readCampaignMessages(
        deps.client,
        'sent',
        new Date(started - historyDays * day),
        more
      )
    : unread()
  const scheduledRead: PagedRead<CampaignMessage> = more()
    ? await readCampaignMessages(deps.client, 'scheduled', null, more)
    : unread()

  // Klaviyo may send a message's variations apart from the list: the
  // newest ones without their subject are asked for one by one.
  let fetched = 0
  for (const m of [...scheduledRead.records, ...sentRead.records]) {
    if (m.contentKnown || fetched >= maxContentReads || !more()) continue
    fetched++
    let content: Awaited<ReturnType<typeof readMessageContent>>
    try {
      content = await readMessageContent(deps.client, m.id)
    } catch (error) {
      // One message Klaviyo no longer finds (or answers oddly) stays
      // without its content; the read goes on, counted incomplete.
      if (
        !(error instanceof KlaviyoError) ||
        !['rejected', 'invalid_response'].includes(error.kind)
      )
        throw error
      logger.warn('History read: a message content left out', {
        kind: error.kind,
        status: error.details.status ?? 0
      })
      continue
    }
    Object.assign(m, {
      channel: content.channel,
      subject: content.subject,
      preview: content.preview,
      abTest: content.abTest,
      contentKnown: content.found
    })
  }
  const unknownContent = [...scheduledRead.records, ...sentRead.records].filter(
    (m) => !m.contentKnown
  ).length

  const scheduledIds = [
    ...new Set(
      scheduledRead.records.flatMap((m) => (m.campaignId ? [m.campaignId] : []))
    )
  ]
  let audiencesRead: PagedRead<CampaignAudience> = none()
  if (scheduledIds.length)
    try {
      audiencesRead = more()
        ? await readCampaignAudiences(deps.client, scheduledIds, more)
        : unread()
    } catch (error) {
      // The audiences of the scheduled emails are a detail: a refusal leaves
      // them out (the days still count as taken), and the read goes on.
      if (
        !(error instanceof KlaviyoError) ||
        !['rejected', 'invalid_response'].includes(error.kind)
      )
        throw error
      logger.warn('History read: scheduled audiences left out', {
        kind: error.kind,
        status: error.details.status ?? 0,
        code: error.details.code ?? 'none'
      })
      audiencesRead = unread()
    }

  // The campaign report: a refusal or an outage leaves the results unknown
  // (null), not the read; only Klaviyo's pace pauses the job.
  let campaignReport: ReportRow[] = []
  let reportRead = !metrics.placedOrder || !sentRead.records.length
  let lastReportAt: number | null = null
  if (metrics.placedOrder && sentRead.records.length && more())
    try {
      const report = await readCampaignReport(deps.client, metrics.placedOrder)
      campaignReport = report.rows
      reportRead = report.complete
    } catch (error) {
      if (
        !(error instanceof KlaviyoError) ||
        error.kind === 'rate_limited' ||
        error.kind === 'bad_key'
      )
        throw error
      if (error.kind === 'missing_scope') throw error
      logger.warn('History read: campaign results left out', {
        kind: error.kind,
        status: error.details.status ?? 0,
        code: error.details.code ?? 'none'
      })
    } finally {
      lastReportAt = now()
    }

  // Flows need the Flows scope, which reading the store does not require:
  // without it, the flows are left out and the read goes on. Their report
  // is a detail too: any failure, Klaviyo's pace included, leaves their
  // results unknown.
  let flowsRead = true
  let flowsList: PagedRead<Flow> = unread()
  let flowReport: ReportRow[] = []
  let flowReportRead = !metrics.placedOrder
  try {
    if (more()) flowsList = await readFlows(deps.client, more)
    if (!flowsList.records.length && flowsList.complete) flowReportRead = true
    else if (metrics.placedOrder && more()) {
      // Klaviyo answers one report question a second.
      if (lastReportAt !== null) {
        const gap = reportGapMs - (now() - lastReportAt)
        if (gap > 0) await sleep(gap)
      }
      try {
        const report = await readFlowReport(deps.client, metrics.placedOrder)
        flowReport = report.rows
        flowReportRead = report.complete
      } catch (error) {
        if (!(error instanceof KlaviyoError) || error.kind === 'bad_key')
          throw error
        if (error.kind === 'missing_scope') throw error
        logger.warn('History read: flow results left out', {
          kind: error.kind,
          status: error.details.status ?? 0,
          code: error.details.code ?? 'none'
        })
        flowReport = []
        flowReportRead = false
      }
    }
  } catch (error) {
    if (!(
      error instanceof KlaviyoError &&
      error.kind === 'missing_scope' &&
      error.details.scope === 'flows:read'
    ))
      throw error
    logger.info('History read: the key cannot read flows; left out')
    flowsRead = false
    flowsList = none()
    flowReport = []
    flowReportRead = true
  }
  const lists: PagedRead<Audience> = more()
    ? await readAudiences(deps.client, 'list', more)
    : unread()
  const segments: PagedRead<Audience> = more()
    ? await readAudiences(deps.client, 'segment', more)
    : unread()

  const noSendTime = sentRead.records.filter((m) => m.sendAt === null).length
  const reads = [
    sentRead,
    scheduledRead,
    audiencesRead,
    flowsList,
    lists,
    segments
  ]
  const skipped =
    reads.reduce((n, r) => n + r.skipped, 0) + noSendTime + unknownContent
  const parts = {
    sent: sentRead.complete && sentRead.skipped === 0 && noSendTime === 0,
    scheduled: scheduledRead.complete && scheduledRead.skipped === 0,
    audiences: audiencesRead.complete && audiencesRead.skipped === 0,
    campaignReport: reportRead,
    flows: flowsList.complete && flowsList.skipped === 0,
    flowReport: flowReportRead,
    lists: lists.complete && lists.skipped === 0,
    segments: segments.complete && segments.skipped === 0
  }
  const complete =
    metrics.complete &&
    Object.values(parts).every(Boolean) &&
    unknownContent === 0

  const sent = sentEmails(sentRead.records, campaignReport, started)
  const scheduled = scheduledEmails(
    scheduledRead.records,
    audiencesRead.records,
    timezone,
    started
  )
  const { sendsPerWeek, usualSendTime } = cadence(sent, timezone, started)
  const snapshot: HistorySnapshot = historySnapshot.parse({
    currency,
    timezone,
    sendsPerWeek,
    usualSendTime,
    sent,
    scheduled,
    // Without the store's Placed Order metric no report was asked: the
    // flows' results are unknown, not nothing.
    flows: flowResults(
      flowsList.records,
      flowReport,
      flowReportRead && metrics.placedOrder !== null
    ),
    audiences: audienceList(
      [...lists.records, ...segments.records],
      audiencesRead.records
    ),
    flowsRead,
    window: windowRead,
    parts
  })
  const empty = !sent.length && !scheduled.length
  if (empty && !complete) {
    logger.warn('History read: nothing found before the time ran out', {
      live: deps.live
    })
    throw new KlaviyoError('unavailable', {
      endpoint: '/api/campaign-messages/'
    })
  }

  let analysis: HistorianRead = { answered: false, reason: 'no_emails' }
  if (sent.length && !deps.ask)
    analysis = { answered: false, reason: 'no_model' }
  else if (sent.length && now() + deps.callMs > deadline)
    analysis = { answered: false, reason: 'time_up' }
  else if (sent.length && deps.ask)
    analysis = await readHistory(
      historianInput(brand.data.brand_name, snapshot),
      snapshot,
      deps.ask,
      `history:${job.id}`
    )
  if (!analysis.answered && analysis.reason !== 'no_emails')
    logger.info('History read: analysis skipped', { reason: analysis.reason })

  const counted = deps.live ? ('code' as const) : ('sample' as const)
  const findings: Finding[] = []
  if (sent.length && sendsPerWeek > 0)
    findings.push({
      topic: 'performance',
      statement: usualSendTime
        ? `The brand sends about ${sendsPerWeek} emails a week, most often at ${usualSendTime}.`
        : `The brand sends about ${sendsPerWeek} emails a week.`,
      value: {},
      evidence: { ref: 'klaviyo:campaigns' },
      confidence: complete ? 0.9 : 0.7,
      pass: counted,
      model: null
    })
  const best = parts.campaignReport ? bestEmails(sent, 1)[0] : undefined
  if (best?.subject)
    findings.push({
      topic: 'performance',
      statement: complete
        ? `The email "${best.subject.slice(0, 200)}" earned the most per recipient in the last year.`
        : `Of the emails read, "${best.subject.slice(0, 200)}" earned the most per recipient.`,
      value: {},
      evidence: { ref: `klaviyo:campaign:${best.id}` },
      confidence: complete ? 0.9 : 0.7,
      pass: counted,
      model: null
    })
  // The sample rules only for the sample account, a model's words only for
  // a live one.
  if (analysis.answered && (analysis.pass === 'model') === deps.live)
    for (const f of analysis.findings)
      findings.push({
        topic: f.topic,
        statement: f.statement,
        value: {},
        evidence: {
          ref: f.emailId
            ? `klaviyo:campaign:${f.emailId}`
            : f.topic === 'audience'
              ? 'klaviyo:audiences'
              : 'klaviyo:campaigns'
        },
        confidence: f.confidence,
        pass: deps.live ? 'model' : 'sample',
        model: analysis.model
      })
  const kept = findings.filter((f) => findingInput.safeParse(f).success)

  const summary = {
    state: empty ? 'empty' : 'ready',
    complete,
    flowsRead,
    ...(empty ? { reason: 'no_emails' } : {})
  }
  logger.info('History read', {
    state: summary.state,
    sent: sent.length,
    scheduled: scheduled.length,
    flows: snapshot.flows.length,
    audiences: snapshot.audiences.length,
    skipped,
    complete,
    flowsRead,
    live: deps.live
  })
  const stored = await db.rpc('record_klaviyo_history', {
    job: job.id,
    lease: job.lease_token!,
    snapshot: snapshot as unknown as Json,
    findings: kept as unknown as Json,
    summary: summary as unknown as Json,
    live: deps.live
  })
  if (stored.error) throw stored.error
  return {
    state: empty ? 'empty' : 'ready',
    sent: sent.length,
    scheduled: scheduled.length,
    flows: snapshot.flows.length,
    audiences: snapshot.audiences.length,
    findings: kept.length,
    complete,
    flowsRead,
    live: deps.live,
    analysis: analysis.answered ? 'done' : 'skipped'
  }
}
