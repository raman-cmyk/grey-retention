import type { SupabaseClient } from '@supabase/supabase-js'
import type { BrandFacts } from '@/features/copy-qa/check'
import type { Database } from '@/lib/supabase/database.types'
import {
  resolveTokens,
  tokenFromText,
  tokenKeys,
  type DesignTokens,
  type TokenKey
} from '@/features/design-engine/tokens'

/**
 * The owner's corrections of the Brand book (owner pick #58, ONB-058). The
 * owner (only the owner since UI-BRAND-2) removes a line, replaces it with his own words, adds
 * a line, or sets a fact (`correct_brand_book`); a correction names its
 * line by its words (case and spacing aside), so it holds when the book is
 * written again. Applied on top of what the readers found (ONB-106b's
 * `observed` lines), the owner wins: his facts become the confirmed ones
 * (for copy QA too) and are no longer "unclear". A correction reaches the
 * agents when the book is next written (after a read). Data only: the
 * review page waits for its approved design.
 */

export const correctableSections = [
  'offering',
  'customers.who',
  'customers.love',
  'customers.worries',
  'voice',
  'marketing',
  'facts.freeShipping',
  'facts.returnDays',
  'facts.guaranteeDays',
  'facts.deliveryDays',
  // PICK-006: the design tokens, corrected like facts (replace or remove).
  ...tokenKeys.map((k) => `tokens.${k}` as const)
] as const
export type CorrectableSection = (typeof correctableSections)[number]
export type TokenSection = `tokens.${TokenKey}`

/** The token a section corrects, or null when it is no token's. */
export const tokenOfSection = (section: string): TokenKey | null => {
  const key = section.startsWith('tokens.') ? section.slice(7) : ''
  return (tokenKeys as readonly string[]).includes(key)
    ? (key as TokenKey)
    : null
}

/**
 * PICK-006: the owner's design tokens from his live corrections: each one
 * he set (a removal gives the site's value, or the default, back). A
 * stored value that no longer reads is skipped.
 */
export function ownerTokens(
  corrections: readonly Correction[]
): Partial<Record<TokenKey, unknown>> {
  const out: Partial<Record<TokenKey, unknown>> = {}
  for (const c of corrections) {
    const key = tokenOfSection(c.section)
    if (!key) continue
    if (c.action === 'remove') {
      delete out[key]
      continue
    }
    const value = tokenFromText(key, c.value)
    if (value !== undefined) out[key] = value
  }
  return out
}

/** The site's own values of a book's tokens (those it marked `site`). */
const siteOf = (design: DesignTokens) =>
  Object.fromEntries(
    tokenKeys.flatMap((k) =>
      design[k]?.source === 'site' ? [[k, design[k].value]] : []
    )
  )

export type Correction = {
  id: string
  section: CorrectableSection
  /** The line's own words; null for a fact or an added line. */
  original: string | null
  action: 'remove' | 'replace' | 'add'
  value: string | null
  createdAt: string
}

type Db = SupabaseClient<Database>

/** More live corrections than a workspace can have (20 added lines a section, one per line). */
const maxLive = 500

/**
 * The workspace's live corrections, oldest first. Throws on a failed read,
 * and when there are more than it reads (never drops the newest).
 */
export async function listCorrections(
  db: Db,
  tenantId: string
): Promise<Correction[]> {
  const { data, error } = await db
    .from('brand_book_corrections')
    .select('id,section,original,action,value,created_at')
    .eq('tenant_id', tenantId)
    .is('withdrawn_at', null)
    .order('created_at', { ascending: true })
    .limit(maxLive + 1)
  if (error) throw error
  if ((data ?? []).length > maxLive)
    throw Object.assign(new Error('too_many_corrections'), {
      code: 'too_many_corrections'
    })
  return (data ?? []).flatMap((r) =>
    (correctableSections as readonly string[]).includes(r.section) &&
    ['remove', 'replace', 'add'].includes(r.action)
      ? [
          {
            id: r.id,
            section: r.section as CorrectableSection,
            original: r.original,
            action: r.action as Correction['action'],
            value: r.value,
            createdAt: r.created_at
          }
        ]
      : []
  )
}

/** Corrects one line (the owner only since UI-BRAND-2; the database checks). Returns its id. */
export async function correctBrandBook(
  db: Db,
  tenantId: string,
  input: {
    section: CorrectableSection
    original: string | null
    action: Correction['action']
    value: string | null
  }
): Promise<string> {
  const { data, error } = await db.rpc('correct_brand_book', {
    t: tenantId,
    book_section: input.section,
    // The command reads an empty text as none.
    book_original: input.original ?? '',
    book_action: input.action,
    book_value: input.value ?? ''
  })
  if (error) throw error
  return data
}

/** Takes a correction back. */
export async function withdrawCorrection(
  db: Db,
  tenantId: string,
  correction: string
): Promise<void> {
  const { error } = await db.rpc('withdraw_brand_book_correction', {
    t: tenantId,
    correction
  })
  if (error) throw error
}

type Fact = 'freeShipping' | 'returnDays' | 'guaranteeDays' | 'deliveryDays'
const factTopic: Record<Fact, string> = {
  freeShipping: 'free_shipping',
  returnDays: 'returns',
  guaranteeDays: 'guarantee',
  deliveryDays: 'delivery_days'
}

/**
 * The owner's fact as copy QA holds it, exactly as the database takes it
 * (`private.brand_fact_ok`): free shipping `always`, `never` or `over 75`
 * (the store's currency); return and guarantee days a whole number from 0
 * (`0`: none to offer); delivery `min-max` in calendar days for the
 * slowest customer, 1 to 90. Null for a removed fact: unknown, so copy QA
 * refuses every claim about it (to say there is none, set `0` or `never`).
 * Undefined when the words do not fit.
 */
export function factValue(
  fact: Fact,
  value: string | null
): BrandFacts[Fact] | undefined {
  if (value === null) return null
  const v = value.trim()
  if (fact === 'freeShipping') {
    if (v === 'always' || v === 'never') return v
    const over = /^over ((?:0|[1-9]\d{0,6})(?:\.\d{1,2})?)$/.exec(v)
    return over ? { over: Number(over[1]) } : undefined
  }
  if (fact === 'deliveryDays') {
    const window = /^(0|[1-9]\d?)-([1-9]\d?)$/.exec(v)
    if (!window) return undefined
    const [min, max] = [Number(window[1]), Number(window[2])]
    return min <= max && max <= 90 ? { min, max } : undefined
  }
  return /^(?:0|[1-9]\d{0,3})$/.test(v) && Number(v) <= 3650
    ? Number(v)
    : undefined
}

/** The same line whatever its case and spacing (as the database keys it). */
const line = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()
const same = (a: string, b: string) => line(a) === line(b)

/** The owner's facts on top of the ones the readers found (copy QA's view). */
export function correctedFacts(
  facts: BrandFacts,
  corrections: readonly Correction[]
): BrandFacts {
  const out = { ...facts }
  for (const c of corrections) {
    if (!c.section.startsWith('facts.')) continue
    const fact = c.section.slice('facts.'.length) as Fact
    const value = factValue(fact, c.action === 'remove' ? null : c.value)
    if (value !== undefined) (out as Record<Fact, unknown>)[fact] = value
  }
  return out
}

/** A Brand book's correctable parts (ONB-106b's shape), whatever else it holds. */
export type CorrectableBook = {
  facts?: Partial<BrandFacts>
  unclear?: { topic: string }[]
  observed?: {
    offering?: string[]
    customers?: { who?: string[]; love?: string[]; worries?: string[] }
    voice?: string[]
    marketing?: string[]
  }
  /** The sections the owner corrected. */
  corrected?: string[]
  /** PICK-006: the design tokens with their sources. */
  design?: DesignTokens
}

/**
 * The book with the owner's corrections applied, oldest first (a newer one
 * of the same line has already withdrawn the older). A line removed or
 * replaced is found by its words; an added line goes last, once.
 */
export function applyCorrections<T extends CorrectableBook>(
  book: T,
  corrections: readonly Correction[]
): T & { corrected: string[] } {
  const out = structuredClone(book) as T & { corrected: string[] }
  const corrected = new Set(out.corrected ?? [])
  // PICK-006: the owner's tokens win over the site's (resolved again, so
  // headings still never shrink below the text under them).
  const tokens = ownerTokens(corrections)
  if (out.design && Object.keys(tokens).length)
    out.design = resolveTokens({ site: siteOf(out.design), owner: tokens })
  for (const c of corrections) {
    if (tokenOfSection(c.section)) {
      if (out.design) corrected.add(c.section)
      continue
    }
    if (c.section.startsWith('facts.')) {
      const fact = c.section.slice('facts.'.length) as Fact
      const value = factValue(fact, c.action === 'remove' ? null : c.value)
      if (value === undefined) continue
      out.facts = { ...out.facts, [fact]: value }
      // The owner settled it.
      out.unclear = (out.unclear ?? []).filter(
        (u) => u.topic !== factTopic[fact]
      )
      corrected.add(c.section)
      continue
    }
    const [head, sub] = c.section.split('.') as [string, string | undefined]
    const observed = (out.observed ??= {}) as Record<string, unknown>
    const holder = (sub ? (observed[head] ??= {}) : observed) as Record<
      string,
      string[] | undefined
    >
    const key = sub ?? head
    const lines = [...(holder[key] ?? [])]
    if (c.action === 'add') {
      if (!c.value || lines.some((l) => same(l, c.value!))) continue
      lines.push(c.value)
    } else {
      const at = lines.findIndex(
        (l) => c.original !== null && same(l, c.original)
      )
      if (at === -1) continue
      // Never the same line twice: a replacement already there removes it.
      if (
        c.action === 'remove' ||
        lines.some((l, i) => i !== at && same(l, c.value!))
      )
        lines.splice(at, 1)
      else lines[at] = c.value!
    }
    holder[key] = lines
    corrected.add(c.section)
  }
  out.corrected = [...corrected].sort()
  return out
}
