import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'
import type { Database } from '@/lib/supabase/database.types'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/logger'
import type { FailureClass } from '@/features/workflow/domain/contracts'
import { workspaceTimezone } from '@/features/strategy/offers'
import {
  brandBookAuthor,
  changedBook,
  composeBrandBook,
  within,
  type BrandBookContent
} from './brand-book'
import { listCorrections } from './brand-book-corrections'
import { listCatalog } from './catalog/read'
import { listFindings } from './findings'
import { readKlaviyoHistory } from './history/read'

/**
 * UI-BRAND-2: the Brand book rewrite (job kind `brand.write_book`). The
 * database queues one in the same transaction as the change that needs it
 * (the owner approves a brand version, or makes or takes back a Brand book
 * correction; migration `20260914090095`), and the readers' run queues one
 * after a read or for a stale book: every book the code writes goes
 * through here. A write that has not started covers every later change,
 * so there is at most one waiting per workspace. The app runs it right
 * after the click (`rewriteBrandBookSoon`) and the readers' run picks up
 * any left behind. Each write is leased (`claim_brand_book_write`, never
 * two of one workspace at once) and its book is saved by
 * `finish_brand_book_write` under the lease and the workspace lock, only
 * on top of the version it read: a write that timed out or lost its lease,
 * or read before a newer book, never saves (it fails through `fail_job`,
 * four tries with its back-off). Code only: the Brand strategist's
 * reading (a live model, never the fake) follows on the readers' run.
 */
export const brandBookWriteKind = 'brand.write_book'
/** The longest one write may take (a few small reads, one save). */
export const brandBookWriteMs = 15_000
/**
 * After a click: everything ends within `clickDeadlineMs` of the reply
 * (the Brand pages allow 60 s, `maxDuration`), each write taking at most
 * `clickWriteMs`. A write already running in the workspace is waited for
 * only while a whole write still fits before the deadline, so at most
 * `clickDeadlineMs - clickWriteMs` (15 s).
 */
export const clickDeadlineMs = 25_000
export const clickWriteMs = 10_000

type Db = SupabaseClient<Database>

/** The Brand book from the workspace's own reads (the worker's client). */
export const composeOnboardedBrandBook = (db: Db, tenantId: string) =>
  composeBrandBook(db, tenantId, {
    findings: (d, t) => listFindings(d, t),
    catalog: (d, t) => listCatalog(d, t),
    history: readKlaviyoHistory,
    timezone: workspaceTimezone,
    corrections: listCorrections
  })

/** What one write saves: the book, on top of the version it read. */
export type PreparedWrite = {
  basedOn: number
  /** null: nothing to save (unchanged, or only sample data). */
  content: BrandBookContent | null
}

async function newestBook(db: Db, tenantId: string) {
  const { data, error } = await db
    .from('brand_books')
    .select('version,content')
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw error
  return data?.[0] ?? null
}

/**
 * Reads the newest book, then writes the book from what is stored; an
 * unchanged book (the strategist's reading aside) saves nothing.
 */
export async function prepareBrandBookWrite(
  db: Db,
  tenantId: string,
  compose: (
    db: Db,
    t: string
  ) => Promise<BrandBookContent | null> = composeOnboardedBrandBook
): Promise<PreparedWrite> {
  const before = await newestBook(db, tenantId)
  const content = await compose(db, tenantId)
  return {
    basedOn: before?.version ?? 0,
    content: content ? changedBook(before?.content, content) : null
  }
}

/** A write that ran out of time or met a busy database is tried again. */
export function writeFailure(error: unknown): FailureClass {
  const code = (error as { code?: string } | null)?.code
  // A book the database refuses (23514) or corrections that can never fit
  // are refused again on every try: no retry.
  return code === 'too_many_corrections' || code === '23514'
    ? 'validation'
    : 'transient'
}

/** The finish found a newer book than the write read (the strategist saved). */
const newerBook = (error: unknown) =>
  (error as { hint?: string } | null)?.hint === 'brand_book_changed'

export type BrandBookWrites = { ran: number; failed: number }

async function waitingFor(db: Db, tenantId: string) {
  const { data, error } = await db
    .from('job_runs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('kind', brandBookWriteKind)
    .in('status', ['queued', 'retry_wait'])
    .lt('attempt', 4)
    .lte('available_at', new Date().toISOString())
    .limit(1)
  if (error) throw error
  return (data ?? []).length > 0
}

/**
 * Runs the due Brand book rewrites, one after another, as the worker: of
 * one workspace (`tenantId`) or of any. A write is started only before
 * `deadline`. With `waitForBusy` (a click, one workspace, with a
 * deadline), a due write waiting behind the workspace's running one is
 * waited for while a whole write still fits before the deadline, then run.
 * A write that finds a newer book than it read (the strategist saved
 * meanwhile) is written again once from it, under the same lease, while
 * time remains. It never throws: a failed write is recorded on its job and
 * tried again later.
 */
export async function runBrandBookWrites(
  db: Db,
  options: {
    tenantId?: string
    limit?: number
    deadline?: number
    waitForBusy?: boolean
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    prepare?: (db: Db, tenantId: string) => Promise<PreparedWrite>
    ms?: number
  } = {}
): Promise<BrandBookWrites> {
  const now = options.now ?? Date.now
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const prepare =
    options.prepare ?? ((d: Db, t: string) => prepareBrandBookWrite(d, t))
  const ms = options.ms ?? brandBookWriteMs
  const run = { ran: 0, failed: 0 }
  try {
    for (let n = 0; n < (options.limit ?? 1);) {
      if (options.deadline !== undefined && now() + ms > options.deadline) break
      const claimed = await db.rpc(
        'claim_brand_book_write',
        options.tenantId ? { t: options.tenantId } : {}
      )
      if (claimed.error) throw claimed.error
      const job = claimed.data?.[0]
      if (!job?.lease_token) {
        // Another rewrite of this workspace is running: the one queued
        // behind it runs next, once it ends.
        if (
          options.tenantId &&
          options.waitForBusy &&
          options.deadline !== undefined &&
          now() + 500 + ms <= options.deadline &&
          (await waitingFor(db, options.tenantId))
        ) {
          await sleep(500)
          continue
        }
        break
      }
      n++
      try {
        const finish = async () => {
          const write = await within(prepare(db, job.tenant_id), ms)
          return db.rpc('finish_brand_book_write', {
            job: job.id,
            lease: job.lease_token!,
            based_on: write.basedOn,
            content: (write.content ?? null) as never,
            written_by: write.content ? brandBookAuthor : (null as never)
          })
        }
        let finished = await finish()
        // Once more from the newer book, while the lease and time allow.
        if (
          newerBook(finished.error) &&
          (options.deadline === undefined || now() + ms <= options.deadline)
        )
          finished = await finish()
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
 * The readers' run: queues a rewrite of the workspace's book (after a
 * read, or for a stale book; `ref` names it once) and runs the workspace's
 * due rewrite at once. Throws when it cannot be queued.
 */
export async function rewriteBrandBookNow(
  db: Db,
  tenantId: string,
  {
    cause,
    ref,
    ms = brandBookWriteMs
  }: { cause: string; ref: string; ms?: number }
): Promise<BrandBookWrites> {
  const queued = await db.rpc('queue_brand_book_write_as_worker', {
    t: tenantId,
    cause,
    ref
  })
  if (queued.error) throw queued.error
  return runBrandBookWrites(db, { tenantId, ms })
}

/**
 * Right after the owner's click (approve, correct, take back, Try again):
 * the workspace's due rewrites run once the reply is sent, all within
 * `clickDeadlineMs`, waiting for one already running there while a whole
 * write still fits (about 15 s at most). When they cannot (no worker client), they
 * stay queued for the readers' run.
 */
export function rewriteBrandBookSoon(tenantId: string) {
  after(async () => {
    const service = createServiceClient()
    if (!service) return
    await runBrandBookWrites(service, {
      tenantId,
      limit: 3,
      ms: clickWriteMs,
      deadline: Date.now() + clickDeadlineMs,
      waitForBusy: true
    })
  })
}
