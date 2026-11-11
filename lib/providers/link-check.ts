import 'server-only'

export type LinkCheck =
  | { ok: true; status: number; finalUrl: string }
  | { ok: false; reason: 'timeout' | 'network' | 'blocked' }

/**
 * Checks a store link the way a reader's click would, following redirects
 * by hand so every hop is re-checked against the allowed hosts: the server
 * never fetches a host the email isn't allowed to link to (no SSRF through a
 * redirect). HEAD first; GET when the store refuses HEAD.
 */
export function createLinkChecker(config: {
  allowedHosts: readonly string[]
  fetch?: typeof fetch
  timeoutMs?: number
  maxRedirects?: number
}) {
  const doFetch = config.fetch ?? fetch
  const hosts = config.allowedHosts.map((h) => h.toLowerCase())
  const allowed = (url: URL) =>
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    (url.port === '' || url.port === '443') &&
    hosts.some(
      (h) =>
        url.hostname === h ||
        url.hostname === `www.${h}` ||
        `www.${url.hostname}` === h
    )

  return async function checkLink(raw: string): Promise<LinkCheck> {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return { ok: false, reason: 'blocked' }
    }
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      config.timeoutMs ?? 8_000
    )
    try {
      for (let hop = 0; hop <= (config.maxRedirects ?? 5); hop++) {
        if (!allowed(url)) return { ok: false, reason: 'blocked' }
        const init: RequestInit = {
          redirect: 'manual',
          signal: controller.signal,
          cache: 'no-store',
          headers: { 'user-agent': 'GreyRetention-LinkCheck/1.0' }
        }
        let response = await doFetch(url.href, { ...init, method: 'HEAD' })
        if (response.status === 405 || response.status === 501)
          response = await doFetch(url.href, { ...init, method: 'GET' })
        await response.body?.cancel().catch(() => undefined)
        if (response.status >= 300 && response.status < 400) {
          const next = response.headers.get('location')
          if (!next)
            return { ok: true, status: response.status, finalUrl: url.href }
          url = new URL(next, url)
          continue
        }
        return { ok: true, status: response.status, finalUrl: url.href }
      }
      return { ok: false, reason: 'blocked' }
    } catch {
      return {
        ok: false,
        reason: controller.signal.aborted ? 'timeout' : 'network'
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
