import { describe, expect, it } from 'vitest'
import {
  checkKlaviyoKey,
  checkShopDomain,
  checkShopifyToken,
  maskSecret
} from './credentials'

const klaviyoKey = 'pk_Ab3dEfg12hi34jk56lm78no90pq12rs1a2b'
const shopifyToken = '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'
// Same shape as the database check on workspace_connections.credential_hint.
const storedHint =
  /^(pk_[A-Za-z0-9]{5}|shp(at|ca)_[A-Za-z0-9]{4})•{8}[A-Za-z0-9]{4}$/

describe('maskSecret', () => {
  it('keeps only the start and the last four characters', () => {
    expect(maskSecret(klaviyoKey, 8)).toBe('pk_Ab3dE••••••••1a2b')
  })
})

describe('checkKlaviyoKey', () => {
  it('accepts a private key and returns only a masked hint', () => {
    const result = checkKlaviyoKey(`  ${klaviyoKey}\n`)
    expect(result).toEqual({
      ok: true,
      value: { hint: 'pk_Ab3dE••••••••1a2b' }
    })
    expect(JSON.stringify(result)).not.toContain('ab12cd34')
    expect(result.ok && result.value.hint).toMatch(storedHint)
  })

  it.each([
    ['', 'Paste your Klaviyo private API key.'],
    [undefined, 'Paste your Klaviyo private API key.'],
    ['AbC123', 'That looks like your public site ID.'],
    ['pk_short', 'That is not a Klaviyo private API key.'],
    [
      'sk_Ab3dEfg12hi34jk56lm78no90pq12rs',
      'That is not a Klaviyo private API key.'
    ],
    [
      'pk_Ab3dE fg12hi34jk56lm78no90pq12rs',
      'That is not a Klaviyo private API key.'
    ]
  ])('refuses %j with a plain explanation', (input, message) => {
    const result = checkKlaviyoKey(input)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain(message)
  })

  it('never repeats the pasted value in an error', () => {
    const pasted = 'pk_this-is-not-valid-but-secretish'
    const result = checkKlaviyoKey(pasted)
    expect(!result.ok && result.error).not.toContain('secretish')
  })
})

describe('checkShopDomain', () => {
  it.each([
    ['cedar-lane.myshopify.com', 'cedar-lane.myshopify.com'],
    ['  Cedar-Lane.MyShopify.com ', 'cedar-lane.myshopify.com'],
    ['https://cedar-lane.myshopify.com/admin', 'cedar-lane.myshopify.com'],
    ['cedar-lane', 'cedar-lane.myshopify.com']
  ])('accepts %j as %j', (input, domain) => {
    expect(checkShopDomain(input)).toEqual({ ok: true, value: domain })
  })

  it('refuses an autofilled email address (old-app bug)', () => {
    const result = checkShopDomain('owner@example.com')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('looks like an email address')
  })

  it.each([
    'cedar-lane.com',
    'shop.cedarlane.co.uk',
    'evil.myshopify.com.attacker.io',
    '-bad.myshopify.com'
  ])('refuses %j as not a .myshopify.com address', (input) => {
    const result = checkShopDomain(input)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('not your custom domain')
  })

  it('asks for the address when empty', () => {
    expect(checkShopDomain('')).toMatchObject({ ok: false })
  })
})

describe('checkShopifyToken', () => {
  it('accepts an Admin API access token and returns only a masked hint', () => {
    const result = checkShopifyToken(shopifyToken)
    expect(result).toEqual({
      ok: true,
      value: { hint: 'shpat_ab12••••••••ff00' }
    })
    expect(result.ok && result.value.hint).toMatch(storedHint)
    expect(
      checkShopifyToken('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')
    ).toMatchObject({ ok: true })
  })

  it('explains the two common mix-ups', () => {
    const secret = checkShopifyToken('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')
    expect(!secret.ok && secret.error).toContain('API secret key')
    const apiKey = checkShopifyToken('0123456789abcdef0123456789abcdef')
    expect(!apiKey.ok && apiKey.error).toContain('API key')
  })

  it.each(['', 'shpat_', 'shpat_has spaces in it 1234567890', 'token'])(
    'refuses %j',
    (input) => expect(checkShopifyToken(input).ok).toBe(false)
  )
})
