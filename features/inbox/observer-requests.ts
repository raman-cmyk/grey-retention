import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { readPages } from '@/lib/db/read-pages'
import { logger } from '@/lib/logger'
import {
  googleJson,
  observerSheetConfig,
  sheetUnavailable,
  writeScope
} from './observer-google'

/**
 * GROS-INS-002: brands a workspace asked to follow that Grey Observer does
 * not collect yet. Observer is the only system that subscribes, so GROS
 * hands each request over in the Observer Sheet's own "GROS requests" tab:
 * a row per request, appended, never edited or removed by GROS. Observer
 * reads the tab, subscribes, and lists the brand in its Brands tab; when the
 * Brands tab says its sign-up is verified, the request is marked subscribed
 * here. GROS writes only this tab (the owner protects the others), and only
 * websites that passed the database's domain rule (letters, digits, dots
 * and dashes: never a formula), written RAW. A brand asked for again after
 * its listed request (it was stopped and is pending anew) gets a new row.
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
/** Ids per lookup: keeps each request's address short. */
const chunk = 100

export type BrandRequest = {
  domain: string
  /** When it was (last) asked for (ISO). */
  requestedAt: string
  /** Workspaces following it now. */
  workspaces: number
}

export type RequestRun =
  | { state: 'off' }
  | { state: 'done'; pending: number; sent: number; subscribed: number }
  | { state: 'failed'; code: string }

type Env = Record<string, string | undefined>

/**
 * On only with the Observer source set to `sheet`, and never against a
 * database on this machine (a developer's or a Claude session's), so a
 * copied configuration cannot write to the owner's Sheet by accident.
 */
export function requestsEnabled(env: Env = process.env) {
  if (env.OBSERVER_SOURCE?.trim() !== 'sheet') return false
  try {
    return !['127.0.0.1', 'localhost', '[::1]'].includes(
      new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname
    )
  } catch {
    return true
  }
}

/** "2026-11-26T12:40:00.000Z" → "2026-11-26 12:40", the tab's own form. */
const minute = (iso: string) => iso.slice(0, 16).replace('T', ' ')

/** A website as both sides write it: lower case, without `www.`. */
const site = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')

/**
 * The rows to append: requests the tab does not list yet, or asked for
 * again after the latest row it lists for them; oldest first. Pure.
 */
export function newRequestRows(
  requests: readonly BrandRequest[],
  listed: ReadonlyMap<string, string>
): string[][] {
  return [...requests]
    .filter((r) => {
      const last = listed.get(r.domain)
      return last === undefined || minute(r.requestedAt) > last
    })
    .sort(
      (a, b) =>
        a.requestedAt.localeCompare(b.requestedAt) ||
        a.domain.localeCompare(b.domain)
    )
    .map((r) => [
      r.domain,
      minute(r.requestedAt),
      String(r.workspaces),
      requestsSchema
    ])
}

/** The latest request each website already has in the tab. Pure. */
export function listedRequests(rows: unknown[][]): Map<string, string> {
  const listed = new Map<string, string>()
  for (const row of rows.slice(1)) {
    const domain = site(row[0])
    const at = String(row[1] ?? '').trim()
    if (domain && (listed.get(domain) ?? '') <= at) listed.set(domain, at)
  }
  return listed
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
    const domain = site(row[1])
    if (domain && String(row[10] ?? '').trim() === 'Verified')
      verified.add(domain)
  }
  return verified
}

type Db = SupabaseClient<Database>

/** The pending real requests that still have a follower, oldest first. */
async function pendingRequests(db: Db): Promise<BrandRequest[]> {
  const captures = await readPages((from, to) =>
    db
      .from('competitor_captures')
      .select('id,domain,pending_since,created_at')
      .eq('synthetic', false)
      .eq('subscription_status', 'pending')
      .order('pending_since', { ascending: true, nullsFirst: true })
      .order('id')
      .range(from, to)
  )
  if (captures.error || !captures.data) throw captures.error
  const ids = captures.data.map((c) => c.id)
  const count = new Map<string, number>()
  for (let i = 0; i < ids.length; i += chunk) {
    const followers = await readPages((from, to) =>
      db
        .from('competitor_subscriptions')
        .select('id,capture_id')
        .in('capture_id', ids.slice(i, i + chunk))
        .eq('active', true)
        .order('id')
        .range(from, to)
    )
    if (followers.error || !followers.data) throw followers.error
    for (const f of followers.data)
      count.set(f.capture_id, (count.get(f.capture_id) ?? 0) + 1)
  }
  return captures.data.flatMap((c) =>
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
 * Marks requests Observer has signed up to as subscribed, then hands new
 * requests over. Off unless enabled and configured; nothing is asked of
 * Google while no request is pending. Stops at `stop` without starting
 * another write. Throws on a failure.
 */
export async function syncObserverRequests(
  db: Db,
  options: { env?: Env; request?: typeof fetch; stop?: AbortSignal } = {}
): Promise<RequestRun> {
  const env = options.env ?? process.env
  if (!requestsEnabled(env)) return { state: 'off' }
  const config = observerSheetConfig(env)
  if (!config) throw sheetUnavailable('observer_requests_config')
  const requests = await pendingRequests(db)
  if (!requests.length)
    return { state: 'done', pending: 0, sent: 0, subscribed: 0 }
  const stop = options.stop
  const live = () => {
    if (stop?.aborted) throw sheetUnavailable('observer_requests_timeout')
  }
  const json = googleJson(
    config.credential,
    writeScope,
    options.request,
    () =>
      sheetUnavailable(
        stop?.aborted
          ? 'observer_requests_timeout'
          : 'observer_requests_unavailable'
      ),
    stop
  )
  const base = 'https://sheets.googleapis.com/v4/spreadsheets/' + config.sheet
  const range = (a1: string) =>
    base + '/values/' + encodeURIComponent(`'${requestsTab}'!${a1}`)
  // Fulfilled first (reading only), so a refused write never holds them up.
  const brands = await json(
    base +
      '/values/' +
      encodeURIComponent("'Brands'!A6:K") +
      '?valueRenderOption=UNFORMATTED_VALUE'
  )
  const verified = verifiedBrands(brands.values ?? [])
  const done = requests.map((r) => r.domain).filter((d) => verified.has(d))
  let subscribed = 0
  if (done.length) {
    live()
    const updated = await db
      .from('competitor_captures')
      .update({ subscription_status: 'subscribed' })
      .in('domain', done)
      .eq('subscription_status', 'pending')
      .eq('synthetic', false)
      .select('id')
    if (updated.error) throw updated.error
    subscribed = updated.data?.length ?? 0
  }
  const open = requests.filter((r) => !verified.has(r.domain))
  if (!open.length)
    return { state: 'done', pending: requests.length, sent: 0, subscribed }
  const metadata = await json(base + '?fields=sheets(properties(title))')
  const titles: string[] = (metadata.sheets ?? []).map(
    (s: { properties?: { title?: string } }) => s.properties?.title ?? ''
  )
  let rows: unknown[][] = []
  if (!titles.includes(requestsTab)) {
    live()
    await json(base + ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: requestsTab } } }]
      })
    })
  } else {
    const current = await json(
      range('A1:D') + '?valueRenderOption=UNFORMATTED_VALUE'
    )
    rows = current.values ?? []
  }
  if (!rows.length) {
    // A new or empty tab gets its header first (also after an interrupted
    // run that added the tab but not its header).
    live()
    await json(range('A1:D1') + '?valueInputOption=RAW', {
      method: 'PUT',
      body: JSON.stringify({ values: [requestsHeader] })
    })
  } else if (requestsHeader.some((name, i) => (rows[0] ?? [])[i] !== name))
    // Someone changed the tab's columns: append nothing rather than guess.
    throw sheetUnavailable('observer_requests_layout')
  const append = newRequestRows(open, listedRequests(rows))
  if (append.length) {
    live()
    await json(
      range('A:D') +
        ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
      { method: 'POST', body: JSON.stringify({ values: append }) }
    )
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
 * `requestsStepMs`. At that point every call still running is ended and no
 * other write starts; the requests stay pending for the next run.
 */
export async function runObserverRequests(
  db: Db,
  run: (
    db: Db,
    options: { stop: AbortSignal }
  ) => Promise<RequestRun> = syncObserverRequests,
  timeoutMs = requestsStepMs
): Promise<RequestRun> {
  const stop = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      run(db, { stop: stop.signal }),
      new Promise<RequestRun>((_, reject) => {
        timer = setTimeout(() => {
          stop.abort()
          reject(sheetUnavailable('observer_requests_timeout'))
        }, timeoutMs)
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
