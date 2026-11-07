// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import {
  KlaviyoError,
  klaviyoClient,
  klaviyoRevision,
  type KlaviyoResponse,
  type KlaviyoTransport
} from './client'
import { recorded } from './recorded'

const key = 'pk_SAMPLE0123456789abcdefghij'
const answering = (...answers: (KlaviyoResponse | Error)[]) => {
  const requests: Parameters<KlaviyoTransport>[0][] = []
  const transport: KlaviyoTransport = vi.fn(async (request) => {
    requests.push(request)
    const next = answers.shift() ?? recorded.page('item')
    if (next instanceof Error) throw next
    return next
  })
  return { transport, requests }
}
const failure = async (call: Promise<unknown>) => {
  try {
    await call
  } catch (error) {
    return error as KlaviyoError
  }
  throw new Error('expected a failure')
}

describe('klaviyoClient', () => {
  it("sends the key, the pinned revision and JSON:API only to Klaviyo's host", async () => {
    const { transport, requests } = answering(recorded.account)
    const body = await klaviyoClient(key, { transport }).get(
      '/api/accounts?fields[account]=timezone',
      'accounts:read'
    )
    expect(body).toMatchObject({ data: [{ id: 'CdrG01' }] })
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: 'https://a.klaviyo.com/api/accounts?fields[account]=timezone',
      headers: {
        authorization: `Klaviyo-API-Key ${key}`,
        revision: klaviyoRevision,
        accept: 'application/vnd.api+json'
      },
      timeoutMs: 10_000
    })
    expect(klaviyoRevision).toBe('2026-10-15')
  })

  it('names each failure, with the scope a 403 is about', async () => {
    const cases: [KlaviyoResponse | Error, string][] = [
      [recorded.badKey, 'bad_key'],
      [recorded.noScope, 'missing_scope'],
      [recorded.down, 'unavailable'],
      [new Error('socket hang up'), 'unavailable'],
      [{ status: 404, headers: {}, body: '{}' }, 'rejected'],
      [{ status: 200, headers: {}, body: '<html>' }, 'invalid_response']
    ]
    for (const [answer, kind] of cases) {
      const { transport } = answering(answer)
      const error = await failure(
        klaviyoClient(key, { transport }).get(
          '/api/catalog-items',
          'catalogs:read'
        )
      )
      expect(error, kind).toBeInstanceOf(KlaviyoError)
      expect(error.kind).toBe(kind)
      expect(error.details.endpoint).toBe('/api/catalog-items')
    }
    const { transport } = answering(recorded.noScope)
    expect(
      (
        await failure(
          klaviyoClient(key, { transport }).get('/api/events', 'events:read')
        )
      ).details
    ).toMatchObject({
      scope: 'events:read',
      code: 'permission_denied',
      status: 403
    })
  })

  it('waits out a short rate limit, at most twice, and reports a long one', async () => {
    const wait = vi.fn(async () => {})
    const short = answering(recorded.throttled(7), recorded.account)
    await klaviyoClient(key, { transport: short.transport, wait }).get(
      '/api/accounts',
      'accounts:read'
    )
    expect(wait).toHaveBeenCalledWith(7_250)
    expect(short.requests).toHaveLength(2)
    const again = answering(
      recorded.throttled(2),
      recorded.throttled(2),
      recorded.throttled(2)
    )
    expect(
      (
        await failure(
          klaviyoClient(key, { transport: again.transport, wait }).get(
            '/api/accounts',
            'accounts:read'
          )
        )
      ).details
    ).toMatchObject({ retryAfterSeconds: 2 })
    expect(again.requests).toHaveLength(3)
    const long = answering(recorded.throttled(60))
    const error = await failure(
      klaviyoClient(key, { transport: long.transport, wait }).get(
        '/api/accounts',
        'accounts:read'
      )
    )
    expect(error.kind).toBe('rate_limited')
    expect(error.details.retryAfterSeconds).toBe(60)
    expect(long.requests).toHaveLength(1)
  })

  it('follows a next link only on Klaviyo, so the key never goes elsewhere', async () => {
    const { transport, requests } = answering(recorded.page('item'))
    const client = klaviyoClient(key, { transport })
    await client.next(
      'https://a.klaviyo.com/api/catalog-items/?page%5Bcursor%5D=abc',
      'catalogs:read'
    )
    for (const url of [
      'https://evil.example/api/catalog-items/',
      'http://a.klaviyo.com/api/catalog-items/',
      'not a url'
    ])
      expect((await failure(client.next(url, 'catalogs:read'))).kind, url).toBe(
        'invalid_response'
      )
    expect(requests).toHaveLength(1)
  })

  it('sends nothing for a value that is not a private key', async () => {
    const { transport, requests } = answering()
    const error = await failure(
      klaviyoClient('pk_x\r\nX-Evil: 1', { transport }).get(
        '/api/accounts',
        'accounts:read'
      )
    )
    expect(error.kind).toBe('bad_key')
    expect(requests).toHaveLength(0)
  })

  it('waits a little past a Retry-After of 0, and not at all when told not to', async () => {
    const wait = vi.fn(async () => {})
    const zero = answering(recorded.throttled(0), recorded.account)
    await klaviyoClient(key, { transport: zero.transport, wait }).get(
      '/api/accounts',
      'accounts:read'
    )
    expect(wait).toHaveBeenCalledWith(1_250)
    const none = answering(recorded.throttled(2))
    const error = await failure(
      klaviyoClient(key, { transport: none.transport, wait, maxWaits: 0 }).get(
        '/api/accounts',
        'accounts:read'
      )
    )
    expect(error.kind).toBe('rate_limited')
    expect(wait).toHaveBeenCalledTimes(1)
  })

  it('never puts the key in an error', async () => {
    for (const answer of [recorded.badKey, recorded.noScope, recorded.down]) {
      const { transport } = answering(answer)
      const error = await failure(
        klaviyoClient(key, { transport }).get('/api/accounts', 'accounts:read')
      )
      expect(`${error.message} ${JSON.stringify(error.details)}`).not.toContain(
        key
      )
    }
  })
})
