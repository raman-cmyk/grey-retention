import 'server-only'
import { klaviyoWritesUnlocked } from '@/lib/env/server'

/**
 * The live Klaviyo client (KLV-001): JSON:API requests to Klaviyo's one
 * host with a private API key, a pinned API revision and typed failures.
 * The key is only ever in a request header: it never appears in an error,
 * a log line or a returned value. Tests and the sample mode give it a
 * recorded transport instead of the network.
 *
 * Writes (PSH-001) go only to the addresses that make or change a draft
 * campaign, its variations, templates and images: nothing this client can
 * call schedules or sends an email (D17: the owner schedules in Klaviyo).
 * And none is made at all while the write lock is on (KLV-LOCK-001, the
 * default): only reads and the read-only report questions go out.
 */

export const klaviyoHost = 'https://a.klaviyo.com'
/** The Klaviyo API revision this client is written against. */
export const klaviyoRevision = '2026-10-15'

export type KlaviyoScope =
  | 'accounts:read'
  | 'campaigns:read'
  | 'catalogs:read'
  | 'events:read'
  | 'flows:read'
  | 'lists:read'
  | 'metrics:read'
  | 'profiles:read'
  | 'segments:read'
  | 'segments:write'
  | 'campaigns:write'
  | 'templates:read'
  | 'templates:write'
  | 'images:read'
  | 'images:write'

export type KlaviyoFailureKind =
  /** 401: a wrong, expired or revoked key. */
  | 'bad_key'
  /** 403: the key lacks the scope this endpoint needs. */
  | 'missing_scope'
  /** 429: too many requests; `retryAfterSeconds` says when to come back. */
  | 'rate_limited'
  /** 5xx, a timeout or no network on a read. */
  | 'unavailable'
  /** Any other refusal (400, 404, 409, 410, 422). */
  | 'rejected'
  /** A 2xx answer we cannot read (Klaviyo changed its shape). */
  | 'invalid_response'
  /**
   * KLV-LOCK-001: refused by the write lock before any network call (a
   * write, or anything that is not a read, while Klaviyo is locked).
   */
  | 'write_locked'

export class KlaviyoError extends Error {
  constructor(
    readonly kind: KlaviyoFailureKind,
    readonly details: {
      /** The path we called, without its query (never the key). */
      endpoint: string
      status?: number
      /** Klaviyo's own error code, e.g. permission_denied. */
      code?: string
      /** Where Klaviyo says the request was wrong (a JSON pointer, bounded). */
      pointer?: string
      scope?: KlaviyoScope
      retryAfterSeconds?: number
    }
  ) {
    super(`Klaviyo ${kind} (${details.endpoint})`)
  }
}

/** A recorded or live answer: status, headers and the raw body. */
export type KlaviyoResponse = {
  status: number
  headers: Record<string, string>
  body: string
}
/** Sends one request; the live one uses fetch, tests use recordings. */
export type KlaviyoTransport = (request: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  url: string
  headers: Record<string, string>
  body?: string
  timeoutMs: number
}) => Promise<KlaviyoResponse>

/** A Klaviyo answer bigger than this is not read (pages are far smaller). */
const maxBodyBytes = 8 * 1024 * 1024

/**
 * KLV-LOCK-001: the write lock, locked by default and owned by the server.
 * While locked, the only requests made at all are an exact `GET` on
 * Klaviyo's own origin and an exact `POST` of one of the read-only report
 * questions below, at exactly its address (no query, no other spelling).
 * Anything else (PATCH, PUT, DELETE, any other POST or method, any other
 * origin) is refused as `write_locked` before any network call: by the
 * client (`send`, `write`, `query`) and again by `fetchTransport` itself.
 * Only the server environment's `KLAVIYO_WRITE_LOCK=unlocked`, exactly,
 * read at each request, releases it: no option, argument or setting a
 * caller passes can. It wins over KLAVIYO_MODE and KLAVIYO_DRAFT_PUSH
 * (docs/KLAVIYO_WRITE_LOCK.md).
 */
export const reportQuestionPaths: readonly string[] = Object.freeze([
  // The campaign report (ONB-103 history, LRN-001 results).
  '/api/campaign-values-reports',
  // The flow report (ONB-103 history).
  '/api/flow-values-reports',
  // A metric's counts (LRN-001's link clicks).
  '/api/metric-aggregates'
])

/** Klaviyo's origin, exactly (https, its host, the default port, no user). */
function onKlaviyo(url: string) {
  try {
    const u = new URL(url)
    return u.origin === klaviyoHost && !u.username && !u.password
  } catch {
    return false
  }
}

/**
 * What the lock lets through: an exact `GET` on Klaviyo's origin, or an
 * exact `POST` whose address is exactly one of `reportQuestionPaths`.
 */
export function readOnlyRequest(method: string, url: string) {
  if (!onKlaviyo(url)) return false
  if (method === 'GET') return true
  return (
    method === 'POST' &&
    reportQuestionPaths.some((path) => url === `${klaviyoHost}${path}`)
  )
}

/** The path of an address, for an error (never its query or a key). */
const endpointOf = (url: string) => {
  try {
    return new URL(url, klaviyoHost).pathname.slice(0, 200)
  } catch {
    return 'request'
  }
}

/** A path as the address it names (an address given whole stays as given). */
const absolute = (path: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(path) ? path : `${klaviyoHost}${path}`

/** Refuses what the lock does not let through, before any network call. */
function lockGuard(method: string, url: string) {
  if (!klaviyoWritesUnlocked() && !readOnlyRequest(method, url))
    throw new KlaviyoError('write_locked', { endpoint: endpointOf(url) })
}

export const fetchTransport: KlaviyoTransport = async (request) => {
  // The lock again, from the method and address alone: code holding this
  // transport cannot go round the client.
  lockGuard(request.method, request.url)
  // Klaviyo's own origin only, always: the key goes in the header.
  if (!onKlaviyo(request.url))
    throw new KlaviyoError('invalid_response', { endpoint: 'next link' })
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(request.timeoutMs)
  })
  const headers: Record<string, string> = {}
  response.headers.forEach((value, name) => {
    headers[name.toLowerCase()] = value
  })
  const body = await capped(response, maxBodyBytes)
  // Too big to be a Klaviyo page: treated as Klaviyo being unwell.
  return body === null
    ? { status: 502, headers, body: '' }
    : { status: response.status, headers, body }
}

/** The body as text, or null once it passes `limit` bytes (then not read further). */
async function capped(response: Response, limit: number) {
  if (Number(response.headers.get('content-length') ?? 0) > limit) {
    await response.body?.cancel()
    return null
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Waits at most this long inside one call for a short rate limit. */
const shortWaitSeconds = 10
/** A private API key, and nothing else, ever goes into the header. */
const keyShape = /^pk_[A-Za-z0-9]{20,64}$/
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

export type KlaviyoWriteMethod = 'POST' | 'PATCH' | 'DELETE'
const kid = '[A-Za-z0-9_-]{1,64}'
/**
 * Every write this client makes: a draft campaign, its message's test
 * settings, its variations, templates and images. Never a schedule, a send
 * job, a list, a segment, a profile or a campaign deletion.
 */
const draftWrites: { method: KlaviyoWriteMethod; path: RegExp }[] = [
  { method: 'POST', path: /^\/api\/campaigns\/?$/ },
  { method: 'POST', path: /^\/api\/campaign-messages\/?$/ },
  { method: 'PATCH', path: new RegExp(`^/api/campaign-messages/${kid}/?$`) },
  { method: 'PATCH', path: new RegExp(`^/api/campaign-variations/${kid}/?$`) },
  { method: 'DELETE', path: new RegExp(`^/api/campaign-variations/${kid}/?$`) },
  { method: 'POST', path: /^\/api\/templates\/?$/ },
  { method: 'DELETE', path: new RegExp(`^/api/templates/${kid}/?$`) },
  { method: 'POST', path: /^\/api\/images\/?$/ }
]
export const isDraftWrite = (method: KlaviyoWriteMethod, path: string) =>
  draftWrites.some((w) => w.method === method && w.path.test(path))

/**
 * Fields a draft write never carries, anywhere in its body: a message's
 * status, send options and times (D17: only the owner schedules).
 */
const scheduleFields = new Set([
  'status',
  'send_options',
  'send_time',
  'send_times',
  'recipient_percentage',
  'scheduled_at'
])
export function carriesSchedule(body: unknown): boolean {
  if (Array.isArray(body)) return body.some(carriesSchedule)
  if (body && typeof body === 'object')
    return Object.entries(body).some(
      ([k, v]) => scheduleFields.has(k) || carriesSchedule(v)
    )
  return false
}

export type KlaviyoClient = {
  /** A GET of `path` (with its query) on Klaviyo's host; the parsed body. */
  get(path: string, scope: KlaviyoScope): Promise<unknown>
  /** Follows a `links.next` URL, only on Klaviyo's own host. */
  next(url: string, scope: KlaviyoScope): Promise<unknown>
  /**
   * A change to a draft (`isDraftWrite`): the parsed body, or null for an
   * empty answer (a deletion). Any other address is refused before it is
   * sent. A write that times out may still have been made: the caller
   * checks before making it again.
   */
  write(
    method: KlaviyoWriteMethod,
    path: string,
    body: Record<string, unknown> | null,
    scope: KlaviyoScope
  ): Promise<unknown>
  /**
   * A report query (Klaviyo's reporting endpoints take a POST with the
   * question in the body; nothing is written): `path` on Klaviyo's host.
   */
  query(path: string, body: unknown, scope: KlaviyoScope): Promise<unknown>
}

/**
 * A client for one key. A short rate limit (Retry-After of 10 s or less)
 * is waited out inside the call, at most twice; anything longer is a
 * `rate_limited` failure for the job to retry later.
 */
export function klaviyoClient(
  apiKey: string,
  options: {
    transport?: KlaviyoTransport
    timeoutMs?: number
    /** Short rate limits waited out inside one call (2 by default). */
    maxWaits?: number
    wait?: (ms: number) => Promise<void>
  } = {}
): KlaviyoClient {
  const transport = options.transport ?? fetchTransport
  const wait = options.wait ?? sleep
  const maxWaits = options.maxWaits ?? 2
  const send = async (
    url: URL,
    scope: KlaviyoScope,
    change?: { method: KlaviyoWriteMethod; body: string | undefined }
  ) => {
    if (url.origin !== klaviyoHost)
      throw new KlaviyoError('invalid_response', { endpoint: 'next link' })
    const method = change?.method ?? 'GET'
    // KLV-LOCK-001: the lock, from the address as sent, before any transport.
    lockGuard(method, url.toString())
    const endpoint = url.pathname
    if (!keyShape.test(apiKey)) throw new KlaviyoError('bad_key', { endpoint })
    for (let tries = 0; ; tries++) {
      let response: KlaviyoResponse
      try {
        response = await transport({
          method,
          url: url.toString(),
          headers: {
            authorization: `Klaviyo-API-Key ${apiKey}`,
            revision: klaviyoRevision,
            accept: 'application/vnd.api+json',
            ...(change?.body !== undefined
              ? { 'content-type': 'application/vnd.api+json' }
              : {})
          },
          ...(change?.body !== undefined ? { body: change.body } : {}),
          timeoutMs: options.timeoutMs ?? 10_000
        })
      } catch (error) {
        // The transport's own lock says so; anything else is Klaviyo unwell.
        if (error instanceof KlaviyoError && error.kind === 'write_locked')
          throw error
        throw new KlaviyoError('unavailable', { endpoint })
      }
      if (response.status >= 200 && response.status < 300) {
        // A deletion answers 204 with no body.
        if (change && (response.status === 204 || response.body.trim() === ''))
          return null
        try {
          return JSON.parse(response.body) as unknown
        } catch {
          throw new KlaviyoError('invalid_response', {
            endpoint,
            status: response.status
          })
        }
      }
      const { code, pointer } = errorOf(response.body)
      const status = response.status
      if (status === 401)
        throw new KlaviyoError('bad_key', { endpoint, status, code })
      if (status === 403)
        throw new KlaviyoError('missing_scope', {
          endpoint,
          status,
          code,
          scope
        })
      if (status === 429) {
        const given = Number.parseInt(response.headers['retry-after'] ?? '', 10)
        const retryAfterSeconds =
          Number.isFinite(given) && given >= 0 ? Math.max(1, given) : 60
        if (retryAfterSeconds <= shortWaitSeconds && tries < maxWaits) {
          // A little margin, so the retry lands after the window resets.
          await wait(retryAfterSeconds * 1000 + 250)
          continue
        }
        throw new KlaviyoError('rate_limited', {
          endpoint,
          status,
          code,
          retryAfterSeconds
        })
      }
      if (status >= 500)
        throw new KlaviyoError('unavailable', { endpoint, status, code })
      throw new KlaviyoError('rejected', { endpoint, status, code, pointer })
    }
  }
  return {
    get: (path, scope) => send(new URL(path, klaviyoHost), scope),
    next: async (url, scope) => {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new KlaviyoError('invalid_response', { endpoint: 'next link' })
      }
      return send(parsed, scope)
    },
    write: async (method, path, body, scope) => {
      // The lock first: while locked, nothing is written at all.
      lockGuard(method, absolute(path))
      const url = new URL(path, klaviyoHost)
      if (
        url.origin !== klaviyoHost ||
        url.search !== '' ||
        !isDraftWrite(method, url.pathname) ||
        (method === 'DELETE') !== (body === null) ||
        carriesSchedule(body)
      )
        throw new KlaviyoError('rejected', { endpoint: url.pathname })
      return send(url, scope, {
        method,
        body: body === null ? undefined : JSON.stringify(body)
      })
    },
    query: async (path, body, scope) => {
      // Only Klaviyo's report questions, at exactly their addresses (drafts
      // are changed by write).
      if (!reportQuestionPaths.includes(path))
        throw new KlaviyoError('rejected', { endpoint: endpointOf(path) })
      const url = new URL(path, klaviyoHost)
      if (body === undefined || body === null)
        throw new KlaviyoError('rejected', { endpoint: url.pathname })
      return send(url, scope, {
        method: 'POST',
        body: JSON.stringify(body)
      })
    }
  }
}

/** Klaviyo's own error code and the place it names, from a JSON:API error body. */
function errorOf(body: string) {
  try {
    const first = (
      JSON.parse(body) as {
        errors?: { code?: unknown; source?: { pointer?: unknown } }[]
      }
    ).errors?.[0]
    const code = first?.code
    const pointer = first?.source?.pointer
    return {
      code:
        typeof code === 'string' && /^[a-z_]{1,60}$/.test(code)
          ? code
          : undefined,
      pointer:
        typeof pointer === 'string' && /^\/[A-Za-z0-9_/-]{0,120}$/.test(pointer)
          ? pointer
          : undefined
    }
  } catch {
    return { code: undefined, pointer: undefined }
  }
}
