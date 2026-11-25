import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/logger'
import type { FailureClass } from '@/features/workflow/domain/contracts'
import { workspaceTimezone } from '@/features/strategy/offers'
import { within, writeBrandBook } from './brand-book'
import { listCorrections } from './brand-book-corrections'
import { listCatalog } from './catalog/read'
import { listFindings } from './findings'
import { readKlaviyoHistory } from './history/read'

/**
 * UI-BRAND-2: the Brand book rewrite (job kind `brand.write_book`). The
 * database queues one in the same transaction as the change that needs it
 * (the owner approves a brand version, or makes or takes back a Brand book
 * correction; migration `20260914090095`): a write that has not started
 * covers every later change, so there is at most one waiting per
 * workspace. The app runs it right after the click (`rewriteBrandBookSoon`)
 * and the onboarding readers' run picks up any left behind. Each write is
 * leased (`claim_brand_book_write`, never two of one workspace at once),
 * finished under its lease (`finish_brand_book_write`) or failed through
 * `fail_job` (four tries with its back-off). Writing reads what is stored
 * and saves a new version only when the book changed, so a write run twice
 * is harmless. Code only: the Brand strategist's reading (a live model,
 * never the fake) follows on the readers' run, which reads each new
 * version (ONB-106c).
 */
export const brandBookWriteKind = 'brand.write_book'
/** The longest one write may take (a few small reads, one save). */
export const brandBookWriteMs = 15_000

type Db = SupabaseClient<Database>

/** The Brand book from the workspace's own reads (the worker's client). */
export const writeOnboardedBrandBook = (db: Db, tenantId: string) =>
  writeBrandBook(db, tenantId, {
    findings: (d, t) => listFindings(d, t),
    catalog: (d, t) => listCatalog(d, t),
    history: readKlaviyoHistory,
    timezone: workspaceTimezone,
    corrections: listCorrections
  })

/** A write that ran out of time or met a busy database is tried again. */
export function writeFailure(error: unknown): FailureClass {
  const code = (error as { code?: string } | null)?.code
  return code === 'too_many_corrections' ? 'validation' : 'transient'
}

async function newestVersion(db: Db, tenantId: string) {
  const { data, error } = await db
    .from('brand_books')
    .select('version')
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0]?.version ?? null
}

export type BrandBookWrites = { ran: number; failed: number }

/**
 * Runs the due Brand book rewrites, one after another, as the worker: of
 * one workspace (`tenantId`, the owner's click) or of any. A write is
 * started only before `deadline`. It never throws: a failed write is
 * recorded on its job and tried again later.
 */
export async function runBrandBookWrites(
  db: Db,
  options: {
    tenantId?: string
    limit?: number
    deadline?: number
    now?: () => number
    write?: (db: Db, tenantId: string) => Promise<unknown>
    ms?: number
  } = {}
): Promise<BrandBookWrites> {
  const now = options.now ?? Date.now
  const write = options.write ?? writeOnboardedBrandBook
  const ms = options.ms ?? brandBookWriteMs
  const run = { ran: 0, failed: 0 }
  try {
    for (let n = 0; n < (options.limit ?? 1); n++) {
      if (options.deadline !== undefined && now() + ms > options.deadline) break
      const claimed = await db.rpc(
        'claim_brand_book_write',
        options.tenantId ? { t: options.tenantId } : {}
      )
      if (claimed.error) throw claimed.error
      const job = claimed.data?.[0]
      if (!job?.lease_token) break
      try {
        const written = await within(write(db, job.tenant_id), ms)
        const version =
          typeof written === 'number'
            ? written
            : await newestVersion(db, job.tenant_id)
        const finished = await db.rpc('finish_brand_book_write', {
          job: job.id,
          lease: job.lease_token,
          book_version: version as number
        })
        if (finished.error) throw finished.error
        run.ran++
      } catch (error) {
        run.failed++
        logger.warn('Brand book not rewritten', {
          code: (error as { code?: string })?.code ?? 'brand_book_error'
        })
        const failed = await db.rpc('fail_job', {
          job: job.id,
          lease: job.lease_token,
          failure: writeFailure(error)
        })
        if (failed.error)
          logger.warn('Brand book failure not recorded', {
            code: failed.error.code ?? 'unknown'
          })
      }
    }
  } catch (error) {
    logger.warn('Brand book rewrites could not run', {
      code: (error as { code?: string })?.code ?? 'brand_book_error'
    })
  }
  return run
}

/**
 * Right after the owner's click (approve, correct, take back, Try again):
 * the workspace's waiting rewrite runs once the reply is sent. When it
 * cannot (no worker client), it stays queued for the readers' run.
 */
export function rewriteBrandBookSoon(tenantId: string) {
  after(async () => {
    const service = createServiceClient()
    if (!service) return
    await runBrandBookWrites(service, { tenantId })
  })
}
