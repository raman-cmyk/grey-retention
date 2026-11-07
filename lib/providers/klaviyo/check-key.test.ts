// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
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

  it('asks only for values revision 2026-10-15 accepts', () => {
    // Page sizes within each endpoint's limits, one field each.
    expect(probes['lists:read']).toContain('page[size]=1')
    expect(probes['metrics:read']).not.toContain('page[size]')
    for (const path of Object.values(probes))
      expect(path).toMatch(/^\/api\/[a-z-]+\?.*fields\[[a-z-]+\]=/)
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
