// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const log = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: log }))
import {
  accountFacts,
  accountZone,
  laterScopes,
  probeKlaviyoKey,
  probes,
  requiredScopes,
  websiteOrigin
} from './check-key'
import { klaviyoClient } from './client'
import { recorded, recordedTransport } from './recorded'

const key = 'pk_SAMPLE0123456789abcdefghij'
const check = (scenario: Parameters<typeof recordedTransport>[0] = {}) => {
  const transport = recordedTransport(scenario)
  return {
    transport,
    run: probeKlaviyoKey(
      klaviyoClient(key, { transport, wait: async () => {} })
    )
  }
}

describe('probeKlaviyoKey', () => {
  it('accepts a key that reads everything, and reads the account facts', async () => {
    const { run, transport } = check()
    expect(await run).toEqual({
      ok: true,
      account: {
        accountId: 'CdrG01',
        organization: 'Cedar Goods',
        website: 'https://cedar.example',
        timezone: 'America/Los_Angeles',
        currency: 'USD',
        country: 'US'
      },
      missing: [],
      laterMissing: []
    })
    // One read-only GET per scope, nothing written.
    expect(transport.calls).toHaveLength(
      requiredScopes.length + laterScopes.length
    )
    expect(transport.calls.every((c) => c.startsWith('GET /api/'))).toBe(true)
  })

  it('names exactly the scopes a key lacks, and the ones later steps need', async () => {
    expect(
      await check({
        missing: ['catalogs:read', 'events:read', 'templates:read']
      }).run
    ).toMatchObject({
      ok: true,
      missing: ['catalogs:read', 'events:read'],
      laterMissing: ['templates:read']
    })
    expect(await check({ missing: ['accounts:read'] }).run).toMatchObject({
      ok: true,
      account: null,
      missing: ['accounts:read']
    })
  })

  it('stops at a bad key, a long rate limit or an outage', async () => {
    expect(await check({ all: recorded.badKey }).run).toEqual({
      ok: false,
      reason: 'bad_key'
    })
    expect(await check({ all: recorded.throttled(60) }).run).toEqual({
      ok: false,
      reason: 'rate_limited'
    })
    expect(await check({ all: recorded.down }).run).toEqual({
      ok: false,
      reason: 'unavailable'
    })
  })

  it('says Klaviyo changed when it refuses a probe or sends an unreadable account', async () => {
    expect(
      await check({ all: { status: 400, headers: {}, body: '{}' } }).run
    ).toEqual({ ok: false, reason: 'klaviyo_changed' })
    expect(
      await check({ all: { status: 200, headers: {}, body: '{"data":[]}' } })
        .run
    ).toEqual({ ok: false, reason: 'klaviyo_changed' })
  })

  it('asks only for addresses and values revision 2026-10-15 publishes', () => {
    // From Klaviyo's published OpenAPI spec for 2026-10-15: each list
    // endpoint, its page size limit (none: no page[size]) and the fields
    // its sparse fieldset accepts.
    const spec: Record<string, { maxPage: number | null; fields: string[] }> = {
      '/api/accounts': {
        maxPage: null,
        fields: [
          'contact_information',
          'timezone',
          'preferred_currency',
          'locale',
          'industry',
          'test_account'
        ]
      },
      '/api/catalog-items': { maxPage: 100, fields: ['title', 'price', 'url'] },
      '/api/campaign-messages': { maxPage: 100, fields: ['definition'] },
      '/api/events': { maxPage: 1000, fields: ['datetime'] },
      '/api/lists': { maxPage: 10, fields: ['name'] },
      '/api/metrics': { maxPage: null, fields: ['name'] },
      '/api/segments': { maxPage: 10, fields: ['name'] },
      '/api/templates': { maxPage: 10, fields: ['name'] },
      '/api/images': { maxPage: 100, fields: ['name'] },
      '/api/flows': { maxPage: 50, fields: ['name'] }
    }
    for (const probe of Object.values(probes)) {
      const url = new URL(probe, 'https://a.klaviyo.com')
      const endpoint = spec[url.pathname]!
      expect(endpoint, probe).toBeDefined()
      const size = url.searchParams.get('page[size]')
      if (endpoint.maxPage === null) expect(size, probe).toBeNull()
      else expect(Number(size), probe).toBeLessThanOrEqual(endpoint.maxPage)
      const fields = [...url.searchParams].filter(([k]) =>
        k.startsWith('fields[')
      )
      expect(fields, probe).toHaveLength(1)
      for (const f of fields[0]![1].split(','))
        expect(endpoint.fields, probe).toContain(f)
    }
  })

  it('says Klaviyo changed, and logs it without the key, when a probe is not found', async () => {
    log.warn.mockClear()
    const changed = recordedTransport()
    const client = klaviyoClient(key, {
      wait: async () => {},
      transport: (request) =>
        changed({
          ...request,
          // A probe Klaviyo would not know any more.
          url: request.url.replace('/api/lists', '/api/list')
        })
    })
    expect(await probeKlaviyoKey(client)).toEqual({
      ok: false,
      reason: 'klaviyo_changed'
    })
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.warn.mock.calls)).toContain('rejected')
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain(key)
  })
})

describe('account facts', () => {
  it('keeps only well-formed values', () => {
    expect(
      accountFacts({
        data: [
          {
            id: 'Abc123',
            attributes: {
              timezone: 'Mars/Olympus',
              preferred_currency: 'dollars',
              contact_information: {
                organization_name: '  ',
                website_url: 'javascript:alert(1)',
                street_address: { country: 'USA' }
              }
            }
          }
        ]
      })
    ).toEqual({
      accountId: 'Abc123',
      organization: null,
      website: null,
      timezone: null,
      currency: null,
      country: null
    })
    expect(() => accountFacts({ data: [] })).toThrow()
    expect(() =>
      accountFacts({ data: [{ id: 'not an id!', attributes: {} }] })
    ).toThrow()
  })

  it('keeps a correct timezone as written and maps only old aliases', () => {
    expect(accountZone('Asia/Kathmandu')).toBe('Asia/Kathmandu')
    expect(accountZone('Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(accountZone('Europe/Kyiv')).toBe('Europe/Kyiv')
    expect(accountZone('US/Pacific')).toBe('America/Los_Angeles')
    expect(accountZone('UTC')).toBeNull()
    expect(accountZone('Nowhere/Land')).toBeNull()
  })

  it('makes the website an https origin', () => {
    expect(websiteOrigin('sundari.example')).toBe('https://sundari.example')
    expect(websiteOrigin('www.Shop.com/home')).toBe('https://www.shop.com')
    expect(websiteOrigin('http://shop.com')).toBe('https://shop.com')
    expect(websiteOrigin('javascript:alert(1)')).toBeNull()
    expect(websiteOrigin('localhost')).toBeNull()
  })
})
