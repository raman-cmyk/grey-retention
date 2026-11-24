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
import {
  brandBookAuthor,
  readerKinds,
  type BrandBookContent
} from './brand-book'
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
/** Newest books looked at for a missing strategy (no content read). */
const booksChecked = 50
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
 * Only the candidates' content is read.
 */
export async function booksNeedingStrategy(
  db: Db,
  { limit = 3 }: { limit?: number } = {}
): Promise<string[]> {
  const books = await db
    .from('brand_books')
    .select('tenant_id,version,written_by')
    .order('created_at', { ascending: false })
    .limit(booksChecked)
  if (books.error) throw books.error
  const newest = new Map<string, { version: number; writtenBy: string }>()
  for (const b of books.data ?? [])
    if (!newest.has(b.tenant_id))
      newest.set(b.tenant_id, { version: b.version, writtenBy: b.written_by })
  const coded = [...newest].filter(([, b]) => b.writtenBy !== strategistAuthor)
  if (!coded.length) return []
  const ids = coded.map(([t]) => t)
  const [reads, runs] = await Promise.all([
    db
      .from('job_runs')
      .select('tenant_id')
      .in('tenant_id', ids)
      .in('kind', readerKinds)
      .in('status', unfinished)
      .limit(1000),
    db
      .from('agent_runs')
      .select('tenant_id,caller_key')
      .eq('agent', strategistName)
      .in('tenant_id', ids)
      .in(
        'caller_key',
        coded.map(([, b]) => attemptKey(b.version))
      )
      .limit(1000)
  ])
  if (reads.error) throw reads.error
  if (runs.error) throw runs.error
  const reading = new Set((reads.data ?? []).map((r) => r.tenant_id))
  const tries = new Map<string, number>()
  for (const r of runs.data ?? []) {
    const key = `${r.tenant_id} ${r.caller_key}`
    tries.set(key, (tries.get(key) ?? 0) + 1)
  }
  const open = coded.filter(
    ([t, b]) =>
      !reading.has(t) &&
      (tries.get(`${t} ${attemptKey(b.version)}`) ?? 0) < maxAttempts
  )
  if (!open.length) return []
  // Only now the content: sample books and books with no room are left out.
  const content = await db
    .from('brand_books')
    .select('tenant_id,version,content')
    .in(
      'tenant_id',
      open.map(([t]) => t)
    )
    .order('version', { ascending: false })
    .limit(open.length * 4)
  if (content.error) throw content.error
  const read = new Map<string, BrandBookContent>()
  for (const row of content.data ?? [])
    if (newest.get(row.tenant_id)?.version === row.version)
      read.set(row.tenant_id, row.content as BrandBookContent)
  return open
    .flatMap(([t]) => {
      const book = read.get(t)
      return book &&
        needsStrategy(book) &&
        strategyRoom(book) >= minStrategyRoom
        ? [t]
        : []
    })
    .slice(0, limit)
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

async function triesFor(db: Db, tenantId: string, version: number) {
  const { data, error } = await db
    .from('agent_runs')
    .select('id')
    .eq('agent', strategistName)
    .eq('tenant_id', tenantId)
    .eq('caller_key', attemptKey(version))
    .limit(maxAttempts)
  if (error) throw error
  return data?.length ?? 0
}

/**
 * After the strategist's save: when a code write landed between the
 * version read and the save (`save_brand_book` takes no expected version),
 * the strategist's version now sits on top of newer content. That newer
 * book is saved again on top, so agents and `staleBooks` see it; its own
 * strategy is written on a later run. Returns whether it had to.
 */
async function restoreNewer(
  db: Db,
  tenantId: string,
  base: number,
  saved: number
): Promise<boolean> {
  if (saved <= base + 1) return false
  const { data, error } = await db
    .from('brand_books')
    .select('version,content,written_by')
    .eq('tenant_id', tenantId)
    .gt('version', base)
    .lt('version', saved)
    .order('version', { ascending: false })
    .limit(10)
  if (error) throw error
  const newer = (data ?? []).find((b) => b.written_by !== strategistAuthor)
  if (!newer) return false
  const again = await db.rpc('save_brand_book', {
    t: tenantId,
    content: newer.content as never,
    written_by: newer.written_by || brandBookAuthor
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
