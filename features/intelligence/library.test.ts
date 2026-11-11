// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { blockTypes } from '@/features/blocks/catalog'
import { searchBlockVariants } from './library'
import { layouts, purposes, styles } from './taxonomy'
import { seedSpecs, seedVariants } from './variants'

const migrations = path.join(process.cwd(), 'supabase/migrations')
const sql = readdirSync(migrations)
  .filter((f) => f.endsWith('_block_variants.sql'))
  .map((f) => readFileSync(path.join(migrations, f), 'utf8'))
  .join('\n')

type Db = Parameters<typeof searchBlockVariants>[0]
function database(answer: { data?: unknown; error?: { code: string } }) {
  const rpc = vi.fn(async () => ({
    data: answer.data ?? null,
    error: answer.error ?? null
  }))
  return { rpc, db: { rpc } as unknown as Db }
}
const row = (over: Record<string, unknown> = {}) => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  key: 'cta/seed',
  family: 'cta',
  layout: 'single_column',
  purpose: 'call_to_action',
  styles: ['minimal'],
  spec: seedSpecs.cta.spec,
  source: 'seed',
  evidence: 3,
  matches: 0,
  ...over
})

describe('the block library in the database', () => {
  it('holds the 20 seed blocks exactly as the code makes them', () => {
    expect(sql).not.toBe('')
    const seeds = [
      ...sql.matchAll(
        /\('([a-z0-9_]+)', '([a-z_]+)', '([a-z_]+)', array\[([^\]]*)\]::text\[\], '(\{[^']+\})', '([a-f0-9]{64})'\)/g
      )
    ].map((m) => ({
      family: m[1],
      layout: m[2],
      purpose: m[3],
      styles: m[4]!.match(/'([a-z_]+)'/g)?.map((v) => v.slice(1, -1)) ?? [],
      spec: JSON.parse(m[5]!),
      fingerprint: m[6]
    }))
    expect(seeds).toEqual(seedVariants())
  })

  it('checks the same lists as the code', () => {
    const listOf = (column: string) =>
      new RegExp(
        `  ${column} text not null check \\(${column} in \\(([^)]+)\\)`
      )
        .exec(sql)?.[1]
        ?.match(/'([a-z0-9_]+)'/g)
        ?.map((v) => v.slice(1, -1))
    expect(listOf('family')).toEqual([...blockTypes])
    expect(listOf('layout')).toEqual([...layouts])
    expect(listOf('purpose')).toEqual([...purposes])
    expect(
      /styles <@ array\[([^\]]+)\]/
        .exec(sql)?.[1]
        ?.match(/'([a-z_]+)'/g)
        ?.map((v) => v.slice(1, -1))
    ).toEqual([...styles])
  })
})

describe('searchBlockVariants', () => {
  it('passes every label to the database by its column name, one or several values', async () => {
    const { rpc, db } = database({ data: [row({ matches: 2 })] })
    expect(
      await searchBlockVariants(
        db,
        {
          family: ['cta', 'offer_banner'],
          style: 'minimal',
          industry: 'apparel',
          emailType: 'sale',
          offerType: 'percent_off',
          season: 'black_friday',
          angle: 'urgency',
          brandSize: 'small'
        },
        10
      )
    ).toEqual({
      ok: true,
      variants: [
        {
          id: 'cta/seed',
          family: 'cta',
          layout: 'single_column',
          purpose: 'call_to_action',
          styles: ['minimal'],
          spec: seedSpecs.cta.spec,
          source: 'seed',
          evidenceCount: 3,
          matches: 2,
          score: null
        }
      ]
    })
    expect(rpc).toHaveBeenCalledWith('search_block_variants', {
      filters: {
        family: ['cta', 'offer_banner'],
        style: 'minimal',
        industry: 'apparel',
        email_type: 'sale',
        offer_type: 'percent_off',
        season: 'black_friday',
        angle: 'urgency',
        brand_size: 'small'
      },
      max_results: 10
    })
  })

  it('refuses unknown labels, values outside the lists and a bad limit before asking the database', async () => {
    const { rpc, db } = database({ data: [] })
    for (const [filters, limit] of [
      [{ brand: 'x' }, 50],
      [{ family: 'countdown' }, 50],
      [{ style: [] }, 50],
      [{ season: Array(21).fill('summer') }, 50],
      [{}, 0],
      [{}, 101],
      [{}, 2.5],
      ['family=cta', 50]
    ] as const)
      expect(await searchBlockVariants(db, filters, limit)).toEqual({
        ok: false,
        code: 'invalid_filter'
      })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reports a refusal by its meaning, and skips a stored row that no longer reads as a variant', async () => {
    expect(
      await searchBlockVariants(database({ error: { code: '42501' } }).db)
    ).toEqual({ ok: false, code: 'access_denied' })
    expect(
      await searchBlockVariants(database({ error: { code: '08006' } }).db)
    ).toEqual({ ok: false, code: 'unavailable' })
    const found = await searchBlockVariants(
      database({
        data: [row(), row({ key: 'cta/0123456789abcdef', spec: { rows: [] } })]
      }).db
    )
    expect(found.ok && found.variants.map((v) => v.id)).toEqual(['cta/seed'])
  })
})
