import 'server-only'

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
 */

export const klaviyoHost = 'https://a.klaviyo.com'
/** The Klaviyo API revision this client is written against. */
export const klaviyoRevision = '2026-10-15'

export type KlaviyoScope =
  | 'accounts:read'
  | 'campaigns:read'
  | 'catalogs:read'
  | 'events:read'
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

export class KlaviyoError extends Error {
  constructor(
    readonly kind: KlaviyoFailureKind,
    readonly details: {
      /** The path we called, without its query (never the key). */
      endpoint: string
      status?: number
      /** Klaviyo's own error code, e.g. permission_denied. */
      code?: string
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

export const fetchTransport: KlaviyoTransport = async (request) => {
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
  { method: 'PATCH', path: new RegExp(`^/api/campaign-messages/${kid}/?$`) },
  { method: 'POST', path: /^\/api\/campaign-variations\/?$/ },
  { method: 'PATCH', path: new RegExp(`^/api/campaign-variations/${kid}/?$`) },
  { method: 'DELETE', path: new RegExp(`^/api/campaign-variations/${kid}/?$`) },
  { method: 'POST', path: /^\/api\/templates\/?$/ },
  { method: 'DELETE', path: new RegExp(`^/api/templates/${kid}/?$`) },
  { method: 'POST', path: /^\/api\/images\/?$/ }
]
export const isDraftWrite = (method: KlaviyoWriteMethod, path: string) =>
  draftWrites.some((w) => w.method === method && w.path.test(path))

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
    const endpoint = url.pathname
    if (!keyShape.test(apiKey)) throw new KlaviyoError('bad_key', { endpoint })
    for (let tries = 0; ; tries++) {
      let response: KlaviyoResponse
      try {
        response = await transport({
          method: change?.method ?? 'GET',
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
      } catch {
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
      const code = errorCode(response.body)
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
      throw new KlaviyoError('rejected', { endpoint, status, code })
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
      const url = new URL(path, klaviyoHost)
      if (
        url.origin !== klaviyoHost ||
        url.search !== '' ||
        !isDraftWrite(method, url.pathname) ||
        (method === 'DELETE') !== (body === null)
      )
        throw new KlaviyoError('rejected', { endpoint: url.pathname })
      return send(url, scope, {
        method,
        body: body === null ? undefined : JSON.stringify(body)
      })
    }
  }
}

/** Klaviyo's own error code from a JSON:API error body, if any. */
function errorCode(body: string) {
  try {
    const code = (JSON.parse(body) as { errors?: { code?: unknown }[] })
      .errors?.[0]?.code
    return typeof code === 'string' && /^[a-z_]{1,60}$/.test(code)
      ? code
      : undefined
  } catch {
    return undefined
  }
}
