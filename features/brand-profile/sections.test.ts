// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contentSchema,
  fieldText,
  readSectionForm,
  savedBrandDefaults,
  sectionSpec,
  sections
} from './sections'
import { SampleBrandProfileWriter, brandProfileWriter } from './writer'
import { brandMismatches, nameWords, siteName } from './mismatch'

const sql = readFileSync(
  join(
    import.meta.dirname,
    '../../supabase/migrations/20260914090018_brand_profile_sections.sql'
  ),
  'utf8'
)

describe('section fields', () => {
  it('match the database field list exactly (keys, kinds and limits)', () => {
    const fromSql = [
      ...sql.matchAll(/\('(\w+)','(\w+)','(text|list|terms)',(\d+)\)/g)
    ].map(
      ([, section, field, kind, max]) => `${section}.${field}:${kind}:${max}`
    )
    const fromTs = sections.flatMap((s) =>
      s.fields.map(
        (f) =>
          `${s.key}.${f.key}:${f.kind === 'long' ? 'text' : f.kind}:${f.max}`
      )
    )
    expect(fromTs.sort()).toEqual(fromSql.sort())
  })
})

function form(values: Record<string, string | string[]>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values))
    for (const v of Array.isArray(value) ? value : [value]) data.append(key, v)
  return data
}

describe('readSectionForm', () => {
  it('reads text, one item per line, and term lines', () => {
    const { content, locked } = readSectionForm(
      'vocabulary',
      form({
        preferred: ' layers \r\n\r\nweekend ',
        terms: 'Field cut — our relaxed fit\nQuiet - no logos\nPlain term',
        signature_phrases: 'Hi {{ first_name }},',
        lock: ['preferred', 'nope', 'preferred']
      })
    )
    expect(content).toEqual({
      preferred: ['layers', 'weekend'],
      terms: [
        { term: 'Field cut', definition: 'our relaxed fit' },
        { term: 'Quiet', definition: 'no logos' },
        { term: 'Plain term', definition: '' }
      ],
      signature_phrases: ['Hi {{ first_name }},']
    })
    expect(locked).toEqual(['preferred'])
  })

  it('round-trips through the edit boxes', () => {
    const spec = sectionSpec('vocabulary')!
    const terms = spec.fields.find((f) => f.key === 'terms')!
    const text = fieldText(terms, [
      { term: 'Field cut', definition: 'our relaxed fit' },
      { term: 'Plain', definition: '' }
    ])
    expect(text).toBe('Field cut — our relaxed fit\nPlain')
    expect(
      readSectionForm('vocabulary', form({ terms: text })).content.terms
    ).toEqual([
      { term: 'Field cut', definition: 'our relaxed fit' },
      { term: 'Plain', definition: '' }
    ])
  })
})

describe('contentSchema', () => {
  it('refuses unknown fields, long text, long lists and long items', () => {
    const identity = contentSchema('identity')
    expect(identity.safeParse({ niche: 'Layers' }).success).toBe(true)
    expect(identity.safeParse({ made_up: 'x' }).success).toBe(false)
    expect(identity.safeParse({ niche: 'x'.repeat(201) }).success).toBe(false)
    const tone = contentSchema('tone')
    expect(tone.safeParse({ do: Array(15).fill('ok') }).success).toBe(true)
    expect(tone.safeParse({ do: Array(16).fill('ok') }).success).toBe(false)
    expect(tone.safeParse({ do: ['x'.repeat(301)] }).success).toBe(false)
    expect(
      contentSchema('vocabulary').safeParse({
        terms: [{ term: 'a', definition: 'b', extra: 1 }]
      }).success
    ).toBe(false)
  })
})

describe('SampleBrandProfileWriter', () => {
  const facts = {
    brandName: 'Cedar Lane',
    website: 'cedar-lane.example',
    positioning: 'Everyday layers for quiet weekends.',
    voice: 'Calm and practical.\nSpecific about materials.',
    prohibitions: 'No invented proof.',
    products: [
      { title: 'Field overshirt', url: 'https://cedar-lane.example/p/1' },
      { title: 'Canvas cap', url: 'https://cedar-lane.example/p/2' }
    ]
  }
  const writer = new SampleBrandProfileWriter()

  it('writes valid content for every section', async () => {
    for (const section of sections) {
      const suggestion = await writer.suggest(section.key, facts)
      expect(
        contentSchema(section.key).safeParse(suggestion).success,
        section.key
      ).toBe(true)
    }
  })

  it('reuses saved facts and never invents a story, claim or audience', async () => {
    const identity = await writer.suggest('identity', facts)
    expect(identity.brand_name).toBe('Cedar Lane')
    expect(identity.positioning).toBe('Everyday layers for quiet weekends.')
    expect(identity.website).toBe('cedar-lane.example')
    for (const key of ['origin_story', 'target_audience', 'geographic_market'])
      expect(identity[key]).toMatch(/^Sample: add /)
    const tone = await writer.suggest('tone', facts)
    expect(tone.do).toEqual(['Calm and practical', 'Specific about materials'])
    expect(tone.dont).toEqual(['No invented proof'])
    const audience = await writer.suggest('audience', facts)
    expect(JSON.stringify(audience)).not.toMatch(/\d{2}-\d{2}/)
    const products = await writer.suggest('products', facts)
    expect(products.hero_product_url).toBe('https://cedar-lane.example/p/1')
  })

  it('stays within the database limits for huge saved values', async () => {
    const huge = {
      ...facts,
      brandName: 'B'.repeat(500),
      positioning: 'P'.repeat(9000),
      voice: Array(40).fill('line').join('\n'),
      products: Array(30).fill({ title: 'T'.repeat(400), url: 'u'.repeat(900) })
    }
    for (const section of sections)
      expect(
        contentSchema(section.key).safeParse(
          await writer.suggest(section.key, huge)
        ).success,
        section.key
      ).toBe(true)
  })

  it('keeps {{ placeholders }} verbatim', async () => {
    const copy = await writer.suggest('sample_copy', facts)
    expect(copy.opening_lines).toContain('Hi {{ first_name }},')
  })

  it('is only available with the fake AI provider', () => {
    expect(brandProfileWriter('fake')).toBeInstanceOf(SampleBrandProfileWriter)
    expect(brandProfileWriter(undefined)).toBeInstanceOf(
      SampleBrandProfileWriter
    )
    expect(brandProfileWriter('openai')).toBeNull()
  })
})

describe('brand-mismatch guard', () => {
  it('reads names and sites', () => {
    expect([...nameWords('The Cedar Lane Co. — synthetic demo')]).toEqual([
      'cedar',
      'lane'
    ])
    expect(siteName('https://www.cedar-lane.example/shop')).toBe('cedar-lane')
    expect(siteName('cedar-lane.myshopify.com')).toBe('cedar-lane')
  })

  it('stays quiet when the accounts match the profile', () => {
    expect(
      brandMismatches({
        brandName: 'Cedar Lane',
        website: 'cedar-lane.example',
        klaviyoAccount: 'Cedar Lane — synthetic demo',
        shopDomain: 'cedarlane.myshopify.com'
      })
    ).toEqual([])
  })

  it('warns when Klaviyo or Shopify belong to another brand', () => {
    const found = brandMismatches({
      brandName: 'Cedar Lane',
      website: 'cedar-lane.example',
      klaviyoAccount: 'Juniper Supply',
      shopDomain: 'juniper-supply.myshopify.com'
    })
    expect(found.map((m) => m.source)).toEqual(['klaviyo', 'shopify'])
    expect(found[0]!.message).toContain('“Juniper Supply”')
    expect(found[1]!.message).toContain('juniper-supply.myshopify.com')
  })

  it('needs something to compare', () => {
    expect(
      brandMismatches({
        brandName: '',
        website: '',
        klaviyoAccount: 'X Co',
        shopDomain: null
      })
    ).toEqual([])
    expect(
      brandMismatches({
        brandName: 'Cedar Lane',
        website: '',
        klaviyoAccount: null,
        shopDomain: null
      })
    ).toEqual([])
  })
})

describe('savedBrandDefaults', () => {
  it('shows the details the AI already reads, so editing never blanks them', () => {
    const defaults = savedBrandDefaults({
      brand_name: 'Cedar Lane',
      domain: 'cedar-lane.example',
      positioning: 'Everyday layers.',
      voice: 'Calm, practical and specific.\nNo jargon.',
      prohibitions: 'No invented proof.'
    })
    expect(defaults.identity).toEqual({
      brand_name: 'Cedar Lane',
      positioning: 'Everyday layers.',
      website: 'cedar-lane.example'
    })
    expect(defaults.tone).toEqual({
      do: ['Calm, practical and specific.', 'No jargon.'],
      dont: ['No invented proof.']
    })
  })

  it('splits long saved rules into sentences that fit the list limits', () => {
    const long = Array(30).fill('A sentence about the voice.').join(' ')
    const defaults = savedBrandDefaults({
      brand_name: 'Cedar Lane',
      domain: '',
      positioning: '',
      voice: long,
      prohibitions: ''
    })
    expect(contentSchema('tone').safeParse(defaults.tone).success).toBe(true)
  })
})
