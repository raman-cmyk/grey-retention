import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  inUse,
  inUseFilter,
  ruleSourceSchema,
  type MemoryRule
} from '@/features/agents/memory'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import type { weeklyLearning } from '@/features/learning/patterns'
import { weeklyLearningFor } from '@/features/learning/run'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'

/**
 * Learned (master handoff sections 10 and 11): the do's and don'ts the
 * agents use for this workspace, each with where it came from and when,
 * pinned first, then surest. Read with the signed-in member's own client:
 * row rules keep it to their workspace, and platform and industry rules
 * (no workspace) are never asked for. A read that fails is marked, never
 * thrown. Remove and Pin are the owner's (`./actions`).
 */
export const maxLearnedRows = 200

export type LearnedSource = MemoryRule['source']

/** Where a rule came from, in the owner's words. */
export const sourceWords: Record<LearnedSource, string> = {
  results: 'From your results',
  inspector: 'From the email checks',
  owner_edit: 'From your edits',
  seed: 'From the starting rules'
}

export type LearnedItem = {
  id: string
  kind: 'do' | 'dont'
  rule: string
  why: string
  source: LearnedSource
  sourceWords: string
  /** When it was learned (ISO). */
  at: string
  /** That day in the store's time: 10 Nov (with the year when not this one). */
  date: string
  pinned: boolean
  /** The revision Remove and Pin send back. */
  revision: number
}

/**
 * Owner pick #74: the weekly learning report in plain words ("3 new do's,
 * 1 retired"): the rules added in the last 7 days, and those retired or
 * expired in them (`weeklyLearning`). Null when it could not be read: the
 * page then shows the rules without it.
 */
export type LearnedWeek = {
  summary: string
  dos: number
  donts: number
  retired: number
}

export type LearnedView = {
  owner: boolean
  do: LearnedItem[]
  avoid: LearnedItem[]
  /** The rules could not be read (the screen says so). */
  unread: boolean
  week: LearnedWeek | null
}

type Db = SupabaseClient<Database>
export type LearnedRow = Pick<
  Database['public']['Tables']['agent_memory_rules']['Row'],
  | 'id'
  | 'kind'
  | 'rule'
  | 'why'
  | 'source'
  | 'confidence'
  | 'status'
  | 'expires_at'
  | 'created_at'
  | 'pinned'
  | 'revision'
>

/**
 * The workspace's own rules the agents use now (`inUse`), pinned first,
 * then surest, then newest. Home reads its top three here too.
 */
export async function learnedRows(
  db: Db,
  tenantId: string,
  now: Date,
  limit = maxLearnedRows
): Promise<LearnedRow[] | null> {
  const { data, error } = await db
    .from('agent_memory_rules')
    .select(
      'id,kind,rule,why,source,confidence,status,expires_at,created_at,pinned,revision'
    )
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .or(inUseFilter(now))
    .order('pinned', { ascending: false })
    .order('confidence', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error || !data) return null
  return data
}

/** 10 Nov in the store's time; 10 Nov 2025 for another year. */
export function dateWords(at: string, timezone: string, now: Date) {
  const words = (zone: string) => {
    const year = (d: Date) =>
      new Intl.DateTimeFormat('en-GB', {
        year: 'numeric',
        timeZone: zone
      }).format(d)
    const day = new Date(at)
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric',
      month: 'short',
      year: year(day) === year(now) ? undefined : 'numeric',
      timeZone: zone
    }).format(day)
  }
  try {
    return words(timezone)
  } catch {
    // An unknown timezone: UTC.
    return words('UTC')
  }
}

function itemOf(
  row: LearnedRow,
  timezone: string,
  now: Date
): LearnedItem | null {
  const source = ruleSourceSchema.safeParse(row.source)
  const kind = row.kind === 'do' || row.kind === 'dont' ? row.kind : null
  const at = Date.parse(row.created_at)
  // A row it cannot name is left out rather than guessed.
  if (!source.success || !kind || Number.isNaN(at)) return null
  const rule = {
    status:
      row.status === 'active' ? ('active' as const) : ('retired' as const),
    pinned: row.pinned === true,
    confidence: Number(row.confidence),
    expiresAt: row.expires_at
  }
  if (!inUse(rule, now.getTime())) return null
  return {
    id: row.id,
    kind,
    rule: row.rule,
    why: row.why,
    source: source.data,
    sourceWords: sourceWords[source.data],
    at: new Date(at).toISOString(),
    date: dateWords(row.created_at, timezone, now),
    pinned: rule.pinned,
    revision: row.revision
  }
}

/** The Learned view from its rows (null: not read). Pure, for tests. */
export function learnedView(input: {
  context: Pick<ClientRequestContext, 'tenantRole' | 'timezone'>
  now: Date
  rows: readonly LearnedRow[] | null
  /** #74: this week's report (`weeklyLearning`), or null when unread. */
  week?: ReturnType<typeof weeklyLearning> | null
}): LearnedView {
  const { context, now, rows } = input
  const owner = context.tenantRole === 'owner'
  const week = input.week
    ? {
        summary: input.week.summary,
        dos: input.week.dos.length,
        donts: input.week.donts.length,
        retired: input.week.retired.length
      }
    : null
  if (!rows) return { owner, do: [], avoid: [], unread: true, week: null }
  const sure = new Map(rows.map((r) => [r.id, Number(r.confidence)]))
  const items = rows
    .map((r) => itemOf(r, context.timezone, now))
    .filter((i): i is LearnedItem => i !== null)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        sure.get(b.id)! - sure.get(a.id)! ||
        b.at.localeCompare(a.at)
    )
  return {
    owner,
    do: items.filter((i) => i.kind === 'do'),
    avoid: items.filter((i) => i.kind === 'dont'),
    unread: false,
    week
  }
}

/** Learned for the signed-in member's workspace. */
export async function learnedReadModel(
  context: ClientRequestContext,
  now = new Date()
): Promise<LearnedView> {
  const db = await createClient()
  const [rows, week] = db
    ? await Promise.all([
        learnedRows(db, context.tenantId, now).catch(() => null),
        // #74: what the learning runs added and retired this week. The
        // hourly run writes the rules; the report is read from them, so it
        // is current after every run.
        weeklyLearningFor(db, context.tenantId, now.getTime()).catch(() => null)
      ])
    : [null, null]
  return learnedView({ context, now, rows, week })
}
