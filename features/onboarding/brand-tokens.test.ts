// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { sampleAsk } from '@/features/intelligence/passes'
import { resolveTokens, tokenDefaults } from '@/features/design-engine/tokens'
import {
  brandBookFrom,
  withCorrections,
  type BrandBookParts
} from './brand-book'
import {
  applyCorrections,
  correctedFacts,
  ownerTokens,
  type Correction
} from './brand-book-corrections'
import { brandTokens } from './brand-tokens'
import { sampleSiteFetcher } from './site/fetch'
import { readBrandSite } from './site/worker'
import { storeFrom, type OwnStoreParts } from './store-source'

/**
 * PICK-006: the design tokens from the Site reader to the Brand book and
 * the store: the sample site's are kept by its read, the book carries them
 * with their sources, the owner's corrections win over the site's, and
 * the store gives them to the email build (values on the brand for the
 * coded blocks, with sources for the library copy).
 */
let n = 0
const token = (section: string, value: string | null): Correction => ({
  id: `t${++n}`,
  section: section as Correction['section'],
  original: null,
  action: value === null ? 'remove' : 'replace',
  value,
  createdAt: '2026-11-27T10:00:00Z'
})

const site = {
  'radius.button': 4,
  'button.style': 'filled',
  'type.h1': 36,
  'spacing.base': 8
} as const

const bookParts = (over: Partial<BrandBookParts> = {}): BrandBookParts => ({
  brandName: 'Cedar Lane',
  domain: 'cedar-lane.example',
  timezone: 'UTC',
  currency: 'USD',
  findings: [],
  catalog: [],
  history: null,
  catalogStatus: null,
  owner: null,
  ...over
})

describe('the Brand book’s design tokens', () => {
  it('carries the site’s tokens with their sources, the rest as defaults', () => {
    const book = brandBookFrom(bookParts({ tokens: site }))
    expect(book.design?.['radius.button']).toEqual({ value: 4, source: 'site' })
    expect(book.design?.['spacing.steps']).toEqual({
      value: [8, 16, 24, 32, 48, 64],
      source: 'default'
    })
    expect(book.design?.['radius.card']).toEqual({
      value: tokenDefaults['radius.card'],
      source: 'default'
    })
    // No site read: every token a default.
    const none = brandBookFrom(bookParts())
    expect(
      Object.values(none.design!).every((t) => t.source === 'default')
    ).toBe(true)
  })

  it('lets the owner’s corrections win, and a removal gives the site’s back', () => {
    const book = brandBookFrom(bookParts({ tokens: site }))
    const corrected = withCorrections(book, [
      token('tokens.radius.button', '12'),
      token('tokens.type.h1', '40'),
      token('tokens.type.h1', null),
      token('tokens.button.case', 'uppercase')
    ])
    expect(corrected.design?.['radius.button']).toEqual({
      value: 12,
      source: 'owner'
    })
    expect(corrected.design?.['type.h1']).toEqual({ value: 36, source: 'site' })
    expect(corrected.design?.['button.case']).toEqual({
      value: 'uppercase',
      source: 'owner'
    })
    expect(corrected.design?.['button.style']).toEqual({
      value: 'filled',
      source: 'site'
    })
    expect(corrected.corrected).toEqual(
      expect.arrayContaining([
        'tokens.radius.button',
        'tokens.type.h1',
        'tokens.button.case'
      ])
    )
  })

  it('skips a stored token correction that no longer reads, and never touches the facts', () => {
    const tokens = ownerTokens([
      token('tokens.radius.button', '99'),
      token('tokens.button.style', 'ghost'),
      token('tokens.type.body', '15')
    ])
    // 99 is clamped to the email-safe 24; an unknown style is dropped.
    expect(tokens).toEqual({ 'radius.button': 24, 'type.body': 15 })
    const facts = correctedFacts(
      {
        freeShipping: null,
        deliveryDays: null,
        returnDays: 30,
        guaranteeDays: null,
        reviewsVerified: false,
        approvedClaims: [],
        bannedPhrases: []
      },
      [token('tokens.radius.button', '4')]
    )
    expect(facts.returnDays).toBe(30)
    expect(Object.keys(facts)).not.toContain('tokens.radius.button')
    // A book without tokens (written before them) gets none from a correction.
    expect(
      applyCorrections({ facts: {} }, [token('tokens.radius.button', '4')])
    ).toEqual({ facts: {}, corrected: [] })
  })
})

const storeParts = (over: Partial<OwnStoreParts> = {}): OwnStoreParts => ({
  brandName: 'Cedar Lane',
  domain: 'cedar-lane.example',
  kit: { colors: ['#ffffff', '#111111', '#2a6f4e'], fonts: ['Inter'] },
  timezone: 'UTC',
  status: { live: true, currency: 'USD' },
  catalog: [],
  findings: [],
  corrections: [],
  ...over
})

describe('the store’s design tokens', () => {
  it('gives the build the owner’s tokens over the site’s over the defaults', () => {
    const store = storeFrom(
      storeParts({
        tokens: site,
        corrections: [token('tokens.radius.button', '16')]
      })
    )
    expect(store.tokens?.['radius.button']).toEqual({
      value: 16,
      source: 'owner'
    })
    expect(store.tokens?.['type.h1']).toEqual({ value: 36, source: 'site' })
    expect(store.brand.tokens?.['radius.button']).toBe(16)
    expect(store.brand.tokens?.['radius.card']).toBe(
      tokenDefaults['radius.card']
    )
  })

  it('gives the defaults when the site read kept none', () => {
    const store = storeFrom(storeParts())
    expect(store.tokens).toEqual(resolveTokens({}))
    expect(store.brand.tokens).toEqual(tokenDefaults)
  })
})

describe('brandTokens', () => {
  const db = (domain: string | null, kept: unknown) =>
    ({
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data:
              table === 'brand_profiles'
                ? { domain }
                : kept === undefined
                  ? null
                  : { domain: 'cedar-lane.example', tokens: kept },
            error: null
          })
        }
        return chain
      }
    }) as unknown as Parameters<typeof brandTokens>[0]

  it('reads the tokens kept from the current website, clamped again', async () => {
    expect(
      await brandTokens(
        db('www.Cedar-Lane.example', { 'radius.button': 40 }),
        't'
      )
    ).toEqual({ 'radius.button': 24 })
  })

  it('reads none from another website, or when none were kept', async () => {
    expect(
      await brandTokens(db('other.example', { 'radius.button': 4 }), 't')
    ).toBeNull()
    expect(
      await brandTokens(db('cedar-lane.example', undefined), 't')
    ).toBeNull()
    expect(await brandTokens(db(null, { 'radius.button': 4 }), 't')).toBeNull()
  })

  it('throws on a failed read', async () => {
    const failing = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: null, error: { code: 'XX000' } })
        }
        return chain
      }
    } as unknown as Parameters<typeof brandTokens>[0]
    await expect(brandTokens(failing, 't')).rejects.toEqual({ code: 'XX000' })
  })
})

describe('the Site reader keeps the sample site’s tokens', () => {
  it('reads them from the fake fixture, never the network, and keeps them before the findings', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const calls: { name: string; args: Record<string, unknown> }[] = []
    const chain = {
      select: () => chain,
      eq: () => chain,
      single: async () => ({ data: { brand_name: 'Fernhill' }, error: null })
    }
    const db = {
      from: () => chain,
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args })
        return {
          data: name === 'record_site_tokens' ? true : null,
          error: null
        }
      })
    } as unknown as Parameters<typeof readBrandSite>[0]
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const run = await readBrandSite(
      db,
      {
        id: 'job-1',
        tenant_id: 'tenant-1',
        lease_token: 'lease-1',
        kind: 'brand.read_site',
        input: { domain: 'fernhill.example' }
      } as unknown as Parameters<typeof readBrandSite>[1],
      { fetcher: sampleSiteFetcher, askFor: () => sampleAsk }
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(calls.map((c) => c.name)).toEqual([
      'record_site_tokens',
      'record_site_findings'
    ])
    expect(calls[0]!.args).toEqual({
      job: 'job-1',
      lease: 'lease-1',
      tokens: expect.objectContaining({
        'spacing.base': 8,
        'radius.button': 4,
        'button.style': 'filled',
        'type.headingCase': 'uppercase'
      })
    })
    expect(run.tokens).toBe(16)
  })
})
