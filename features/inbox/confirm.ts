import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import type { ImageFetcher } from '@/lib/providers/image-fetch'
import { createImageFetcher } from './image-fetch'
import { clickableHost, trustedHost } from './signals'

type Db = SupabaseClient<Database>
type Lease = { id: string; lease_token: string; subject_key: string }

export type ConfirmRun = { clicked: number; refused: number; failed: number }

/** Opens links for one brand: the link and every redirect on `allowHost`. */
export type LinkClicker = (allowHost: (host: string) => boolean) => ImageFetcher

/**
 * Opens a confirm link like a person clicking it once: a plain GET (no
 * cookies), https on port 443 only, never a private address, and every
 * redirect checked again, also against the brand's trusted hosts.
 */
export const liveLinkClicker: LinkClicker = (allowHost) =>
  createImageFetcher({
    ports: ['443'],
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
    userAgent: 'Mozilla/5.0 (compatible; MailConfirm/1.0)',
    allowHost
  })

/** Sample brands' confirmations are "clicked" without the network. */
export const sampleLinkClicker: ImageFetcher = {
  async fetch(url) {
    return {
      ok: true,
      bytes: new TextEncoder().encode('<p>Confirmed</p>'),
      url
    }
  }
}

const hostOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).hostname.toLowerCase() || null : null
  } catch {
    return null
  }
}

/**
 * The confirm part of the sweep (INB-004): takes `inbox.confirm` jobs until
 * `deadline`. A known brand's confirm link is opened only when it, and
 * every redirect after it, stays on the brand's own domain, one of its
 * sender domains or a well-known email service; anything else is refused
 * and left to a person. 'attempted' is logged before the link is opened, so
 * a retry never opens it again; the outcome is logged once. A failed read
 * retries the job (it is never taken as a refusal).
 */
export async function confirmSubscriptions(
  db: Db,
  clickers: { real: LinkClicker; sample: ImageFetcher },
  deadline: number
): Promise<ConfirmRun> {
  const run: ConfirmRun = { clicked: 0, refused: 0, failed: 0 }
  while (Date.now() < deadline) {
    const claimed = await db.rpc('claim_platform_job', {
      kinds: ['inbox.confirm']
    })
    if (claimed.error) throw claimed.error
    const job = (claimed.data as unknown as Lease[] | null)?.[0]
    if (!job) break
    const lease = { job: job.id, lease: job.lease_token }
    try {
      const outcome = await confirmOne(db, clickers, lease, job, deadline)
      if (outcome) run[outcome]++
    } catch (error) {
      logger.warn('Inbox confirm job failed', {
        code: (error as { code?: string }).code ?? 'unknown'
      })
      const failed = await db.rpc('fail_platform_job', {
        ...lease,
        failure: 'internal',
        error_code:
          (error as { code?: string }).code === 'PT409'
            ? 'confirm_conflict'
            : 'confirm_not_recorded'
      })
      if (failed.error)
        logger.warn('Inbox confirm job failure not recorded', {
          code: failed.error.code ?? 'unknown'
        })
    }
  }
  return run
}

async function confirmOne(
  db: Db,
  clickers: { real: LinkClicker; sample: ImageFetcher },
  lease: { job: string; lease: string },
  job: Lease,
  deadline: number
): Promise<keyof ConfirmRun | null> {
  const logged = await db
    .from('inbox_confirmation_clicks')
    .select('outcome')
    .eq('inbox_message_id', job.subject_key)
    .maybeSingle()
  if (logged.error) throw logged.error
  const finish = async (outcome: Record<string, unknown>) => {
    const finished = await db.rpc('finish_platform_job', {
      ...lease,
      outcome: outcome as never
    })
    if (finished.error) throw finished.error
  }
  if (logged.data && logged.data.outcome !== 'attempted') {
    await finish({ outcome: logged.data.outcome, already: true })
    return null
  }
  const message = await db
    .from('inbox_messages')
    .select('id,confirm_url,capture_id,synthetic')
    .eq('id', job.subject_key)
    .single()
  if (message.error) throw message.error
  const url = message.data.confirm_url ?? ''
  const record = async (
    outcome: keyof ConfirmRun,
    host: string,
    finalHost?: string | null
  ) => {
    const recorded = await db.rpc('record_confirmation_click', {
      ...lease,
      host,
      outcome,
      final_host: finalHost ?? undefined
    })
    if (recorded.error) throw recorded.error
    await finish({ outcome })
    return outcome
  }
  // Begun before but never logged (a crash mid-click): it may have been
  // opened, so it is not opened again; a person checks it.
  if (logged.data?.outcome === 'attempted')
    return record('failed', hostOf(url) ?? 'unknown')
  const [brand, senders] = message.data.capture_id
    ? await Promise.all([
        db
          .from('competitor_captures')
          .select('domain')
          .eq('id', message.data.capture_id)
          .single(),
        db
          .from('competitor_sender_domains')
          .select('domain')
          .eq('capture_id', message.data.capture_id)
      ])
    : [null, null]
  if (brand?.error) throw brand.error
  if (senders?.error) throw senders.error
  const trusted = brand?.data
    ? {
        domain: brand.data.domain,
        senders: (senders?.data ?? []).map((s) => s.domain)
      }
    : null
  const host = trusted && url ? clickableHost(url, trusted) : null
  if (!host) return record('refused', hostOf(url) ?? 'unknown')
  const begun = await db.rpc('begin_confirmation_click', { ...lease, host })
  if (begun.error) throw begun.error
  // Someone else began it in between: nothing is opened twice.
  if (begun.data !== true) {
    await finish({ already: true })
    return null
  }
  const clicker = message.data.synthetic
    ? clickers.sample
    : clickers.real((h) => trustedHost(h, trusted!))
  const got = await clicker.fetch(url, {
    maxBytes: 1024 * 1024,
    timeoutMs: Math.max(1_000, Math.min(10_000, deadline - Date.now()))
  })
  return record(
    got.ok ? 'clicked' : got.failure === 'blocked' ? 'refused' : 'failed',
    host,
    got.ok ? hostOf(got.url) : null
  )
}
