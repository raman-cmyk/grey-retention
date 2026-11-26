import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { logger } from '@/lib/logger'
import {
  googleJson,
  observerSheetConfig,
  sheetUnavailable,
  writeScope
} from './observer-google'
import { observerEnabled } from './observer-sheet'

/**
 * GROS-INS-002: brands a workspace asked to follow that Grey Observer does
 * not collect yet. Observer is the only system that subscribes, so GROS
 * hands each request over in the Observer Sheet's own "GROS requests" tab:
 * one row per website, appended once, never edited or removed by GROS.
 * Observer reads the tab, subscribes, and adds the brand to its Brands tab;
 * when the Brands tab says its sign-up is verified, the request is marked
 * subscribed here. GROS writes only this tab (the owner protects the
 * others), and only websites that passed the database's domain rule
 * (letters, digits, dots and dashes: never a formula), written RAW.
 */
export const requestsTab = 'GROS requests'
export const requestsSchema = 'gros-brand-requests-v1'
export const requestsHeader = [
  'Domain',
  'Requested at UTC',
  'Workspaces',
  'Schema version'
] as const

/** The longest the sweep waits for the request hand-over. */
export const requestsStepMs = 8_000

export type BrandRequest = {
  domain: string
  /** When it was first asked for (ISO). */
  requestedAt: string
  /** Workspaces following it now. */
  workspaces: number
}

export type RequestRun =
  | { state: 'off' }
  | { state: 'done'; pending: number; sent: number; subscribed: number }
  | { state: 'failed'; code: string }

/** The rows to append: requests the tab does not list yet, oldest first. Pure. */
export function newRequestRows(
  requests: readonly BrandRequest[],
  listed: ReadonlySet<string>
): string[][] {
  return [...requests]
    .filter((r) => !listed.has(r.domain))
    .sort(
      (a, b) =>
        a.requestedAt.localeCompare(b.requestedAt) ||
        a.domain.localeCompare(b.domain)
    )
    .map((r) => [
      r.domain,
      r.requestedAt.slice(0, 16).replace('T', ' '),
      String(r.workspaces),
      requestsSchema
    ])
}

/**
 * Websites the Brands tab shows as signed up (verified). Its header (row 6)
 * is checked first: an unexpected layout is a failure, never a guess. Pure.
 */
export function verifiedBrands(values: unknown[][]): Set<string> {
  const header = values[0] ?? []
  if (
    header[0] !== 'Brand ID' ||
    header[1] !== 'Domain' ||
    header[10] !== 'Signup status'
  )
    throw sheetUnavailable('observer_brands_layout')
  const verified = new Set<string>()
  for (const row of values.slice(1)) {
    const domain = String(row[1] ?? '')
      .trim()
      .toLowerCase()
    if (domain && String(row[10] ?? '').trim() === 'Verified')
      verified.add(domain)
  }
  return verified
}

type Db = SupabaseClient<Database>

/** The pending real requests that still have a follower. */
async function pendingRequests(db: Db): Promise<BrandRequest[]> {
  const captures = await db
    .from('competitor_captures')
    .select('id,domain,pending_since,created_at')
    .eq('synthetic', false)
    .eq('subscription_status', 'pending')
    .order('created_at')
    .limit(500)
  if (captures.error) throw captures.error
  const ids = (captures.data ?? []).map((c) => c.id)
  if (!ids.length) return []
  const followers = await db
    .from('competitor_subscriptions')
    .select('capture_id')
    .in('capture_id', ids)
    .eq('active', true)
  if (followers.error) throw followers.error
  const count = new Map<string, number>()
  for (const f of followers.data ?? [])
    count.set(f.capture_id, (count.get(f.capture_id) ?? 0) + 1)
  return (captures.data ?? []).flatMap((c) =>
    count.get(c.id)
      ? [
          {
            domain: c.domain,
            requestedAt: c.pending_since ?? c.created_at,
            workspaces: count.get(c.id)!
          }
        ]
      : []
  )
}

/**
 * Hands new requests to Observer and marks fulfilled ones subscribed.
 * Off unless the Observer source is on and configured. Throws on a failure.
 */
export async function syncObserverRequests(
  db: Db,
  options: {
    env?: Record<string, string | undefined>
    request?: typeof fetch
  } = {}
): Promise<RequestRun> {
  const env = options.env ?? process.env
  if (!observerEnabled(env)) return { state: 'off' }
  const config = observerSheetConfig(env)
  if (!config) throw sheetUnavailable('observer_requests_config')
  const requests = await pendingRequests(db)
  const json = googleJson(config.credential, writeScope, options.request, () =>
    sheetUnavailable('observer_requests_unavailable')
  )
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + config.sheet
  const range = (a1: string) =>
    base + '/values/' + encodeURIComponent(`'${requestsTab}'!${a1}`)
  const metadata = await json(base + '?fields=sheets(properties(title))')
  const titles: string[] = (metadata.sheets ?? []).map(
    (s: { properties?: { title?: string } }) => s.properties?.title ?? ''
  )
  const listed = new Set<string>()
  if (!titles.includes(requestsTab)) {
    await json(base + ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: requestsTab } } }]
      })
    })
    await json(range('A1:D1') + '?valueInputOption=RAW', {
      method: 'PUT',
      body: JSON.stringify({ values: [requestsHeader] })
    })
  } else {
    const current = await json(
      range('A1:D') + '?valueRenderOption=UNFORMATTED_VALUE'
    )
    const rows: unknown[][] = current.values ?? []
    // Someone changed the tab's columns: append nothing rather than guess.
    if (
      rows.length &&
      requestsHeader.some((name, i) => (rows[0] ?? [])[i] !== name)
    )
      throw sheetUnavailable('observer_requests_layout')
    for (const row of rows.slice(1)) {
      const domain = String(row[0] ?? '')
        .trim()
        .toLowerCase()
      if (domain) listed.add(domain)
    }
  }
  const append = newRequestRows(requests, listed)
  if (append.length)
    await json(
      range('A:D') +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: JSON.stringify({ values: append }) }
    )
  // Fulfilled: Observer's Brands tab shows the sign-up verified.
  let subscribed = 0
  if (requests.length) {
    const brands = await json(
      base +
        '/values/' +
        encodeURIComponent("'Brands'!A6:K") +
        '?valueRenderOption=UNFORMATTED_VALUE'
    )
    const verified = verifiedBrands(brands.values ?? [])
    const done = requests
      .map((r) => r.domain)
      .filter((domain) => verified.has(domain))
    if (done.length) {
      const updated = await db
        .from('competitor_captures')
        .update({ subscription_status: 'subscribed' })
        .in('domain', done)
        .eq('subscription_status', 'pending')
        .eq('synthetic', false)
      if (updated.error) throw updated.error
      subscribed = done.length
    }
  }
  return {
    state: 'done',
    pending: requests.length,
    sent: append.length,
    subscribed
  }
}

/**
 * The sweep's request step: never throws and never waits longer than
 * `requestsStepMs`; a failure leaves the requests pending for the next run.
 */
export async function runObserverRequests(
  db: Db,
  run: (db: Db) => Promise<RequestRun> = syncObserverRequests,
  timeoutMs = requestsStepMs
): Promise<RequestRun> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(db),
      new Promise<RequestRun>((resolve) => {
        timer = setTimeout(
          () => resolve({ state: 'failed', code: 'observer_requests_timeout' }),
          timeoutMs
        )
      })
    ])
  } catch (error) {
    const code =
      (error as { code?: string }).code ?? 'observer_requests_unavailable'
    logger.warn('Brand requests not handed to Observer', { code })
    return { state: 'failed', code }
  } finally {
    clearTimeout(timer)
  }
}
