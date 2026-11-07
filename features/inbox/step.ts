import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import { inboxConfig, type InboxConfig } from './config'
import { pollInbox, type InboxRun } from './worker'

/** The longest the sweep waits for the inbox before the workspace jobs. */
export const inboxStepMs = 15_000

export type InboxStep =
  | {
      transport: 'fake' | 'gmail_imap'
      ready: true
      /** Real newsletters (Gmail) or sample ones (the fake inbox). */
      synthetic: boolean
      run: InboxRun
    }
  | { transport: 'gmail_imap'; ready: false; reason: string }

/**
 * The inbox part of the scheduled sweep: one poll of the configured
 * mailbox. It never throws and never takes longer than `inboxStepMs`: a
 * poll still running then finishes on its own, and its lease keeps a second
 * one from starting. A failure here never stops the workspace jobs.
 */
export async function runInboxStep(
  db: SupabaseClient<Database>,
  config: InboxConfig = inboxConfig(),
  options: { timeoutMs?: number; poll?: typeof pollInbox } = {}
): Promise<InboxStep> {
  if (!config.ready) {
    logger.warn('Inbox not configured', { transport: config.kind })
    return { transport: config.kind, ready: false, reason: config.reason }
  }
  const transport = config.transport
  const poll = options.poll ?? pollInbox
  const done = (run: InboxRun): InboxStep => ({
    transport: transport.kind,
    ready: true,
    synthetic: transport.synthetic,
    run
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const run = await Promise.race([
      poll(db, transport),
      new Promise<InboxRun>((resolve) => {
        timer = setTimeout(
          () => resolve({ state: 'failed', code: 'inbox_step_timeout' }),
          options.timeoutMs ?? inboxStepMs
        )
      })
    ])
    if (run.state === 'failed')
      logger.warn('Inbox poll failed', {
        transport: transport.kind,
        code: run.code
      })
    return done(run)
  } catch (error) {
    const code = (error as { code?: string }).code ?? 'inbox_step_error'
    logger.warn('Inbox poll could not start', {
      transport: transport.kind,
      code
    })
    return done({ state: 'failed', code })
  } finally {
    clearTimeout(timer)
  }
}
