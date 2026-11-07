export class BodyTooLarge extends Error {}

/** Reads at most `limit` bytes of a response body, cancelling beyond it. */
export async function readBounded(response: Response, limit: number) {
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > limit) {
    await response.body?.cancel().catch(() => undefined)
    throw new BodyTooLarge()
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new BodyTooLarge()
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Provider strings are untrusted: keep only short identifier-like values. */
export function safeToken(value: unknown, max = 64) {
  return typeof value === 'string' &&
    /^[A-Za-z0-9_.:-]+$/.test(value) &&
    value.length <= max
    ? value
    : value
      ? 'other'
      : ''
}

/** Seconds from a Retry-After header (seconds or HTTP date), capped at 300. */
export function retryAfterSeconds(headers: Headers) {
  const raw = headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds))
    return Math.max(0, Math.min(300, Math.ceil(seconds)))
  const date = Date.parse(raw)
  return Number.isFinite(date)
    ? Math.max(0, Math.min(300, Math.ceil((date - Date.now()) / 1000)))
    : undefined
}
