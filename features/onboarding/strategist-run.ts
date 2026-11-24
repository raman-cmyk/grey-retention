import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  SupabaseMemoryStore,
  SupabaseRunLog
} from '@/features/agents/supabase-stores'
import type { MemoryStore } from '@/features/agents/memory'
import { runAgent, type AiCall, type RunLog } from '@/features/agents/runtime'
import { SupabaseBudgetLedger } from '@/features/ai/budget-ledger'
import { runAi } from '@/features/ai/run'
import { aiSetup, cappedAiEnv } from '@/features/ai/setup'
import { logger } from '@/lib/logger'
import { readerKinds, type BrandBookContent } from './brand-book'
import {
  checkStrategy,
  needsStrategy,
  strategistAgent,
  strategistAuthor,
  strategistInput,
  strategistName,
  strategyRoom,
  withStrategy
} from './strategist'

type Db = SupabaseClient<Database>

/** The longest the strategist's model call may take. */
export const strategistCallMs = 25_000
/**
 * Model calls per book version at most (any outcome, a refused allowance
 * too): a book the model cannot read well is not asked again until the
 * readers change it.
 */
export const maxAttempts = 2
/** Least room a strategy needs beside the book; less, and none is asked. */
export const minStrategyRoom = 300
/** Newest Brand book rows looked at for a missing strategy (no content read). */
const booksChecked = 500
/** Candidates whose content and tries are read per lookup, newest first. */
const candidatesRead = 25
/** Job states of a read that is not finished yet. */
const unfinished = ['queued', 'retry_wait', 'leased', 'running']

/**
 * The run log's `caller_key` of a strategist call for one book version
 * (with `agent` = `brand-strategist`, it is the attempt record).
 */
export const attemptKey = (version: number) => `brand-book:${version}`

/** Whether a live model is set up for the strategist (never the fake). */
export function strategistReady(env: NodeJS.ProcessEnv = process.env) {
  const setup = aiSetup('plan', env)
  return setup.provider !== 'fake' && setup.ready
}

export type StrategistRun =
  | 'saved'
  | 'current'
  | 'no_book'
  | 'sample'
  | 'no_room'
  | 'no_model'
  | 'tried'
  | 'failed'
  | 'nothing_usable'
  | 'moved'

/**
 * Workspaces whose newest Brand book needs a strategy (ONB-106c), newest
 * book first, at most `limit`: a real brand's book written by code (a
 * strategist version is current by construction), with no onboarding read
 * still waiting or running (each read changes the book), fewer than
 * `maxAttempts` strategist calls for that version, and room beside it.
 * The first read takes no content (the sample flag only); each candidate
 * is then checked on its own, newest first, until `limit` are found, so a
 * workspace left out (tried, no room) never hides an older one.
 */
export async function booksNeedingStrategy(
  db: Db,
  { limit = 3 }: { limit?: number } = {}
): Promise<string[]> {
  const books = await db
    .from('brand_books')
    .select('tenant_id,version,written_by,sample:content->sample')
    .order('created_at', { ascending: false })
    .limit(booksChecked)
  if (books.error) throw books.error
  const newest = new Map<
    string,
    { version: number; writtenBy: string; sample: unknown }
  >()
  for (const b of books.data ?? [])
    if (!newest.has(b.tenant_id))
      newest.set(b.tenant_id, {
        version: b.version,
        writtenBy: b.written_by,
        sample: b.sample
      })
  const coded = [...newest].filter(
    ([, b]) => b.writtenBy !== strategistAuthor && b.sample !== true
  )
  if (!coded.length) return []
  const reads = await db
    .from('job_runs')
    .select('tenant_id')
    .in(
      'tenant_id',
      coded.map(([t]) => t)
    )
    .in('kind', readerKinds)
    .in('status', unfinished)
    .limit(1000)
  if (reads.error) throw reads.error
  const reading = new Set((reads.data ?? []).map((r) => r.tenant_id))
  const out: string[] = []
  for (const [t, b] of coded
    .filter(([t]) => !reading.has(t))
    .slice(0, candidatesRead)) {
    if (out.length >= limit) break
    if ((await triesFor(db, t, b.version)) >= maxAttempts) continue
    const row = await db
      .from('brand_books')
      .select('content')
      .eq('tenant_id', t)
      .eq('version', b.version)
      .limit(1)
    if (row.error) throw row.error
    const content = row.data?.[0]?.content as BrandBookContent | undefined
    if (
      content &&
      needsStrategy(content) &&
      strategyRoom(content) >= minStrategyRoom
    )
      out.push(t)
  }
  return out
}

async function latestBook(db: Db, tenantId: string) {
  const { data, error } = await db
    .from('brand_books')
    .select('version,content,written_by')
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw error
  const row = data?.[0]
  return row
    ? {
        version: row.version,
        writtenBy: row.written_by,
        content: row.content as BrandBookContent
      }
    : null
}

/**
 * Strategist calls made for one book version: the run log's rows, or the
 * AI allowance's reservations when more (a reservation is written before
 * the provider is called, so a call whose run-log row was never written,
 * or came too late, still counts).
 */
async function triesFor(db: Db, tenantId: string, version: number) {
  const [runs, reserved] = await Promise.all([
    db
      .from('agent_runs')
      .select('id')
      .eq('agent', strategistName)
      .eq('tenant_id', tenantId)
      .eq('caller_key', attemptKey(version))
      .limit(maxAttempts),
    db
      .from('usage_reservations')
      .select('id')
      .eq('tenant_id', tenantId)
      .like('operation_id', `ai:%:${strategistName}:${attemptKey(version)}:%`)
      .limit(maxAttempts)
  ])
  if (runs.error) throw runs.error
  if (reserved.error) throw reserved.error
  return Math.max(runs.data?.length ?? 0, reserved.data?.length ?? 0)
}

/**
 * After the strategist's save: when a book landed between the version read
 * and the save (`save_brand_book` takes no expected version), the
 * strategist's version now sits on top of newer content. Only while the
 * strategist's own save is still the newest version, the newest version
 * between is saved again on top, as it was (its writer, its content), so
 * agents and `staleBooks` see it; a book written after the save is already
 * on top and is left alone. Returns whether it had to.
 */
async function restoreNewer(
  db: Db,
  tenantId: string,
  base: number,
  saved: number
): Promise<boolean> {
  if (saved <= base + 1) return false
  const top = await latestBook(db, tenantId)
  if (!top || top.version !== saved) return false
  const { data, error } = await db
    .from('brand_books')
    .select('version,content,written_by')
    .eq('tenant_id', tenantId)
    .gt('version', base)
    .lt('version', saved)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw error
  const newer = data?.[0]
  if (!newer) return false
  const again = await db.rpc('save_brand_book', {
    t: tenantId,
    content: newer.content as never,
    written_by: newer.written_by
  })
  if (again.error) throw again.error
  return true
}

/**
 * The Brand strategist for one workspace (ONB-106c): reads its newest Brand
 * book and, for a real brand's book with no strategy for its content, room
 * beside it and fewer than `maxAttempts` calls for that version, asks the
 * model once (the plan tier, capped at `strategistCallMs`, on the
 * workspace's own AI allowance; every call is in the run log, which is the
 * attempt record), keeps what code accepts and saves it as a new version.
 * Never with the fake AI (no strategy is better than a made-up one), never
 * for a sample book. Never throws for the model; a failed database read or
 * save throws.
 */
export async function runBrandStrategist(
  db: Db,
  tenantId: string,
  deps: {
    env?: NodeJS.ProcessEnv
    ai?: AiCall
    memory?: MemoryStore
    log?: RunLog
  } = {}
): Promise<StrategistRun> {
  const env = deps.env ?? process.env
  const book = await latestBook(db, tenantId)
  if (!book) return 'no_book'
  if (book.content.sample) return 'sample'
  if (book.writtenBy === strategistAuthor || !needsStrategy(book.content))
    return 'current'
  const room = strategyRoom(book.content)
  if (room < minStrategyRoom) return 'no_room'
  if (!deps.ai && !strategistReady(env)) return 'no_model'
  if ((await triesFor(db, tenantId, book.version)) >= maxAttempts)
    return 'tried'
  const capped = cappedAiEnv('plan', env, strategistCallMs)
  const answer = await runAgent(
    strategistAgent,
    strategistInput(book.content),
    {
      tenantId,
      industry: book.content.brand.industry,
      callerKey: attemptKey(book.version),
      memory: deps.memory ?? new SupabaseMemoryStore(db),
      log: deps.log ?? new SupabaseRunLog(db),
      ai:
        deps.ai ??
        ((call) =>
          runAi(call, { ledger: new SupabaseBudgetLedger(db), env: capped }))
    }
  )
  if (!answer.ok) {
    logger.warn('Brand strategist did not answer', { code: answer.code })
    return 'failed'
  }
  const strategy = checkStrategy(answer.output, book.content, room)
  if (!strategy) {
    logger.warn('Brand strategist answer not usable', { code: 'unusable' })
    return 'nothing_usable'
  }
  // The readers may have written a newer book while the model answered:
  // that one gets its own strategy on a later run.
  const now = await latestBook(db, tenantId)
  if (!now || now.version !== book.version) return 'moved'
  const saved = await db.rpc('save_brand_book', {
    t: tenantId,
    content: withStrategy(book.content, strategy) as never,
    written_by: strategistAuthor
  })
  if (saved.error) throw saved.error
  if (await restoreNewer(db, tenantId, book.version, saved.data as number))
    return 'moved'
  return 'saved'
}
