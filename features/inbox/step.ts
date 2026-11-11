import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { keepInboxImages, type AssetsRun } from './assets'
import { inboxConfig, type InboxConfig } from './config'
import { liveImageFetcher, sampleImageFetcher } from './image-fetch'
import { labelInboxEmails, type LabelRun } from './label'
import {
  confirmSubscriptions,
  liveLinkClicker,
  sampleLinkClicker,
  type ConfirmRun
} from './confirm'
import { inboxTagging } from '@/features/intelligence/live'
import { pollInbox, type InboxRun } from './worker'

/** The longest the sweep waits for the inbox before the workspace jobs. */
export const inboxStepMs = 18_000
/** No new email's images are started after this long into the step. */
export const assetsUntilMs = 15_000

export type InboxStep =
  | {
      transport: 'fake' | 'gmail_imap'
      ready: true
      /** Real newsletters (Gmail) or sample ones (the fake inbox). */
      synthetic: boolean
      run: InboxRun
      /** Images kept for emails recorded now or earlier (INB-002). */
      assets: AssetsRun | { state: 'failed'; code: string } | null
      /** Emails tagged, with their sections and facts (INB-003, CI-001). */
      labels: LabelRun | { state: 'failed'; code: string } | null
      /** Subscription confirmations clicked or refused (INB-004). */
      confirms: ConfirmRun | { state: 'failed'; code: string } | null
    }
  | { transport: 'gmail_imap'; ready: false; reason: string }

type Steps = {
  poll?: typeof pollInbox
  assets?: (
    db: SupabaseClient<Database>,
    deadline: number
  ) => Promise<AssetsRun>
  label?: (db: SupabaseClient<Database>, deadline: number) => Promise<LabelRun>
  confirm?: (
    db: SupabaseClient<Database>,
    deadline: number
  ) => Promise<ConfirmRun>
}

/**
 * The inbox part of the scheduled sweep: one poll of the configured
 * mailbox, then the images of new emails. It never throws and never takes
 * longer than `inboxStepMs`: work still running then finishes on its own,
 * and its lease keeps a second one from starting. A failure here never
 * stops the workspace jobs.
 */
export async function runInboxStep(
  db: SupabaseClient<Database>,
  config: InboxConfig = inboxConfig(),
  options: { timeoutMs?: number; assetsUntilMs?: number } & Steps = {}
): Promise<InboxStep> {
  if (!config.ready) {
    logger.warn('Inbox not configured', { transport: config.kind })
    return { transport: config.kind, ready: false, reason: config.reason }
  }
  const transport = config.transport
  const started = Date.now()
  const poll = options.poll ?? pollInbox
  const assets =
    options.assets ??
    ((d: SupabaseClient<Database>, deadline: number) =>
      keepInboxImages(
        d,
        { real: liveImageFetcher, sample: sampleImageFetcher },
        deadline
      ))
  const result: Extract<InboxStep, { ready: true }> = {
    transport: transport.kind,
    ready: true,
    synthetic: transport.synthetic,
    run: { state: 'failed', code: 'inbox_step_timeout' },
    assets: null,
    labels: null,
    confirms: null
  }
  const confirm =
    options.confirm ??
    ((d: SupabaseClient<Database>, deadline: number) =>
      confirmSubscriptions(
        d,
        { real: liveLinkClicker, sample: sampleLinkClicker },
        deadline
      ))
  const label =
    options.label ??
    ((d: SupabaseClient<Database>, deadline: number) => {
      const { ask, pictures, batchMs } = inboxTagging(d)
      return labelInboxEmails(d, ask, deadline, { pictures, batchMs })
    })
  const work = async () => {
    try {
      result.run = await poll(db, transport)
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'inbox_step_error'
      result.run = { state: 'failed', code }
    }
    try {
      result.assets = await assets(
        db,
        started + (options.assetsUntilMs ?? assetsUntilMs)
      )
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'assets_step_error'
      result.assets = { state: 'failed', code }
    }
    // Tagging shares the images' deadline. Live, it works a batch at a time
    // and puts an email back when time runs short (it continues next sweep).
    try {
      result.labels = await label(
        db,
        started + (options.assetsUntilMs ?? assetsUntilMs)
      )
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'labels_step_error'
      result.labels = { state: 'failed', code }
    }
    try {
      result.confirms = await confirm(
        db,
        started + (options.assetsUntilMs ?? assetsUntilMs)
      )
      // Brands that have sent nothing a week after being added (one open
      // task per brand; cheap, so on every sweep).
      const pending = await db.rpc('check_pending_subscriptions')
      if (pending.error) throw pending.error
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'confirm_step_error'
      result.confirms = { state: 'failed', code }
    }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    work(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, options.timeoutMs ?? inboxStepMs)
    })
  ])
  clearTimeout(timer)
  // A snapshot: work that is still running cannot change the answer.
  const step = { ...result }
  if (step.run.state === 'failed')
    logger.warn('Inbox poll failed', {
      transport: transport.kind,
      code: step.run.code
    })
  if (step.assets && 'state' in step.assets)
    logger.warn('Inbox images failed', { code: step.assets.code })
  return step
}
