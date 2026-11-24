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
import type { BrandBookContent } from './brand-book'
import {
  checkStrategy,
  needsStrategy,
  strategistAgent,
  strategistAuthor,
  strategistInput,
  withStrategy
} from './strategist'

type Db = SupabaseClient<Database>

/** The longest the strategist's model call may take. */
export const strategistCallMs = 25_000
/** Books looked at for a missing strategy, newest first. */
const booksChecked = 200

export type StrategistRun =
  | 'saved'
  | 'current'
  | 'no_book'
  | 'sample'
  | 'no_model'
  | 'failed'
  | 'nothing_usable'
  | 'moved'

/**
 * Workspaces whose newest Brand book is a real brand's with no strategy for
 * its own content (ONB-106c), newest book first, at most `limit`.
 */
export async function booksNeedingStrategy(
  db: Db,
  { limit = 5 }: { limit?: number } = {}
): Promise<string[]> {
  const { data, error } = await db
    .from('brand_books')
    .select('tenant_id,version,content')
    .order('created_at', { ascending: false })
    .limit(booksChecked)
  if (error) throw error
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of data ?? []) {
    if (seen.has(row.tenant_id)) continue
    seen.add(row.tenant_id)
    if (needsStrategy(row.content as BrandBookContent)) out.push(row.tenant_id)
    if (out.length >= limit) break
  }
  return out
}

async function latestBook(db: Db, tenantId: string) {
  const { data, error } = await db
    .from('brand_books')
    .select('version,content')
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false })
    .limit(1)
  if (error) throw error
  const row = data?.[0]
  return row
    ? { version: row.version, content: row.content as BrandBookContent }
    : null
}

/**
 * The Brand strategist for one workspace (ONB-106c): reads its newest Brand
 * book and, for a real brand's book with no strategy for its content, asks
 * the model once (the plan tier, capped at `strategistCallMs`, on the
 * workspace's own AI allowance), keeps what code accepts and saves it as a
 * new version of the book. Never with the fake AI (no strategy is better
 * than a made-up one), never for a sample book, and never over a book the
 * readers changed while the model was answering. Never throws for the
 * model; a failed database read throws.
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
  if (!needsStrategy(book.content)) return 'current'
  const setup = aiSetup('plan', env)
  if (!deps.ai && (setup.provider === 'fake' || !setup.ready)) return 'no_model'
  const capped = cappedAiEnv('plan', env, strategistCallMs)
  const answer = await runAgent(
    strategistAgent,
    strategistInput(book.content),
    {
      tenantId,
      industry: book.content.brand.industry,
      callerKey: `brand-book:${book.version}`,
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
  const strategy = checkStrategy(answer.output, book.content)
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
  return 'saved'
}
