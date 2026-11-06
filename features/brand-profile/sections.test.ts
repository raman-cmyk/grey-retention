// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  contentFields,
  contentSchema,
  factsSchema,
  fieldText,
  hasSampleText,
  readSectionForm,
  sectionSpec,
  sections
} from './sections'
import { SampleBrandProfileWriter, brandProfileWriter } from './writer'
import { brandMismatches, nameWords, sameName, siteName } from './mismatch'
import { lastUpdated, profileViews, updatedAgo, type SectionRow } from './view'

// The newest migration that defines the field list is the one in force.
const migrations = join(import.meta.dirname, '../../supabase/migrations')
const sql = readdirSync(migrations)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join(migrations, file), 'utf8'))
  .filter((text) => text.includes('function private.brand_section_fields('))
  .at(-1)!

describe('section fields', () => {
  it('match the database field list exactly (keys, kinds and limits)', () => {
    const fromSql = [
      ...sql.matchAll(/\('(\w+)',\s*'(\w+)',\s*'(text|list|terms)',\s*(\d+)\)/g)
    ].map(
      ([, section, field, kind, max]) => `${section}.${field}:${kind}:${max}`
    )
    const fromTs = sections.flatMap((s) =>
      contentFields(s.key).map(
        (f) =>
          `${s.key}.${f.key}:${f.kind === 'long' ? 'text' : f.kind}:${f.max}`
      )
    )
    expect(fromSql.length).toBeGreaterThan(20)
    expect(fromTs.sort()).toEqual(fromSql.sort())
  })

  it('keeps brand facts out of section content, with brand_profiles limits', () => {
    const facts = sections.flatMap((s) =>
      s.fields.filter((f) => f.fact).map((f) => `${f.fact}:${f.max}`)
    )
    expect(facts.sort()).toEqual([
      'brand_name:120',
      'domain:300',
      'positioning:5000',
      'prohibitions:5000',
      'voice:5000'
    ])
    expect(
      contentSchema('identity').safeParse({ positioning: 'x' }).success
    ).toBe(false)
    expect(contentSchema('tone').safeParse({ do: 'x' }).success).toBe(false)
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
    const { content, facts, locked } = readSectionForm(
      'vocabulary',
      form({
        preferred: ' layers \r\n\r\nweekend ',
        terms:
          'Field cut — our relaxed fit\nQuiet -- no logos\nCrew-neck - plain\nPlain term',
        signature_phrases: 'Hi {{ first_name }},',
        lock: ['preferred', 'nope', 'preferred']
      })
    )
    expect(content).toEqual({
      preferred: ['layers', 'weekend'],
      terms: [
        { term: 'Field cut', definition: 'our relaxed fit' },
        { term: 'Quiet', definition: 'no logos' },
        { term: 'Crew-neck - plain', definition: '' },
        { term: 'Plain term', definition: '' }
      ],
      signature_phrases: ['Hi {{ first_name }},']
    })
    expect(facts).toBeNull()
    expect(locked).toEqual(['preferred'])
  })

  it('returns brand facts separately and never locks them', () => {
    const { content, facts, locked } = readSectionForm(
      'tone',
      form({
        formality: 'Casual',
        do: 'Use U.S. spelling. Write like Dr. Bronner’s label.\r\nBe brief',
        dont: '',
        lock: ['formality', 'do']
      })
    )
    expect(content).toEqual({ formality: 'Casual' })
    expect(facts).toEqual({
      voice: 'Use U.S. spelling. Write like Dr. Bronner’s label.\nBe brief',
      prohibitions: ''
    })
    expect(locked).toEqual(['formality'])
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

describe('schemas', () => {
  it('refuse unknown fields, long text, long lists and long items', () => {
    const identity = contentSchema('identity')
    expect(identity.safeParse({ niche: 'Layers' }).success).toBe(true)
    expect(identity.safeParse({ made_up: 'x' }).success).toBe(false)
    expect(identity.safeParse({ niche: 'x'.repeat(201) }).success).toBe(false)
    const vocabulary = contentSchema('vocabulary')
    expect(vocabulary.safeParse({ avoid: Array(15).fill('ok') }).success).toBe(
      true
    )
    expect(vocabulary.safeParse({ avoid: Array(16).fill('ok') }).success).toBe(
      false
    )
    expect(vocabulary.safeParse({ avoid: ['x'.repeat(301)] }).success).toBe(
      false
    )
    expect(
      vocabulary.safeParse({
        terms: [{ term: 'a', definition: 'b', extra: 1 }]
      }).success
    ).toBe(false)
  })

  it('need a real brand name and allow long positioning and rules', () => {
    const identity = factsSchema('identity')
    expect(
      identity.safeParse({ brand_name: 'C' }).error?.issues[0]?.message
    ).toBe('Brand name: at least 2 characters.')
    expect(identity.safeParse({ brand_name: '' }).success).toBe(false)
    expect(
      identity.safeParse({
        brand_name: 'Cedar Lane',
        positioning: 'p'.repeat(5000)
      }).success
    ).toBe(true)
    expect(identity.safeParse({ positioning: 'p'.repeat(5001) }).success).toBe(
      false
    )
    expect(identity.safeParse({ voice: 'x' }).success).toBe(false)
    const tone = factsSchema('tone')
    expect(
      tone.safeParse({
        voice: Array(40).fill('A rule of the voice.').join('\n')
      }).success
    ).toBe(true)
  })

  it('spots sample text the owner has not replaced', () => {
    expect(hasSampleText({ niche: 'Layers', avoid: ['Act now'] })).toBe(false)
    expect(hasSampleText({ avoid: ['Sample: words you never use'] })).toBe(true)
    expect(
      hasSampleText({ terms: [{ term: 'Cap', definition: 'Sample: say it.' }] })
    ).toBe(true)
  })
})

describe('SampleBrandProfileWriter', () => {
  const facts = {
    brandName: 'Cedar Lane',
    products: [
      { title: 'Field overshirt', url: 'https://cedar-lane.example/p/1' },
      { title: 'Canvas cap', url: 'https://cedar-lane.example/p/2' }
    ]
  }
  const writer = new SampleBrandProfileWriter()
  const suggest = (
    section: (typeof sections)[number]['key'],
    current = {},
    locked: string[] = []
  ) => writer.suggest({ section, facts, current, locked })

  it('writes valid content for every section, all marked as sample', async () => {
    for (const section of sections) {
      const suggestion = await suggest(section.key)
      expect(
        contentSchema(section.key).safeParse(suggestion).success,
        section.key
      ).toBe(true)
      for (const value of Object.values(suggestion))
        expect(hasSampleText({ value }), section.key).toBe(true)
    }
  })

  it('only fills empty fields: the owner’s words are never replaced', async () => {
    const identity = await suggest('identity', {
      niche: 'Outdoor layers',
      origin_story: ''
    })
    expect(identity).toEqual({
      geographic_market: 'Sample: add the country or region you sell to here.',
      origin_story:
        'Sample: add how the brand started, in your own words here.',
      target_audience: 'Sample: add who buys from you here.'
    })
    expect(
      await suggest('identity', {
        niche: 'x',
        geographic_market: 'x',
        origin_story: 'x',
        target_audience: 'x'
      })
    ).toEqual({})
  })

  it('skips locked fields and never guesses tone or a hero product', async () => {
    expect(
      await suggest('identity', {}, ['niche', 'origin_story'])
    ).not.toHaveProperty('niche')
    expect(await suggest('tone')).toEqual({})
    const products = await suggest('products')
    expect(products).not.toHaveProperty('hero_product_url')
    expect(products.summary).toBe(
      'Sample: your product list includes Field overshirt, Canvas cap. Add what makes them special here.'
    )
  })

  it('never suggests brand facts', async () => {
    for (const section of sections) {
      const suggestion = await suggest(section.key)
      for (const field of section.fields.filter((f) => f.fact))
        expect(suggestion).not.toHaveProperty(field.key)
    }
  })

  it('stays within the database limits for huge saved values', async () => {
    const huge = {
      brandName: 'B'.repeat(500),
      products: Array(30).fill({ title: 'T'.repeat(400), url: 'u'.repeat(900) })
    }
    for (const section of sections)
      expect(
        contentSchema(section.key).safeParse(
          await writer.suggest({
            section: section.key,
            facts: huge,
            current: {},
            locked: []
          })
        ).success,
        section.key
      ).toBe(true)
  })

  it('keeps {{ placeholders }} verbatim', async () => {
    const copy = await suggest('sample_copy')
    expect(copy.opening_lines).toContain('Sample: Hi {{ first_name }},')
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
    expect([...nameWords('OK')]).toEqual(['ok'])
    expect([...nameWords('株式会社 さくら')]).toEqual(['株式会社', 'さくら'])
    expect(siteName('https://www.cedar-lane.example/shop')).toBe('cedar-lane')
    expect(siteName('shop.cedarlane.co.uk')).toBe('cedarlane')
    expect(siteName('cedar-lane.myshopify.com')).toBe('cedar-lane')
  })

  it('matches the same name written differently', () => {
    const cedar = nameWords('Cedar Lane')
    expect(sameName(cedar, nameWords('cedarlane'))).toBe(true)
    expect(sameName(cedar, nameWords('Cedar Lane Outfitters'))).toBe(true)
    expect(sameName(cedar, nameWords('cl-outfitters'))).toBe(true)
    expect(sameName(cedar, nameWords('cedarlanegoods'))).toBe(false)
    expect(
      sameName(nameWords('Northwind Coffee'), nameWords('Southside Coffee'))
    ).toBe(false)
    expect(
      sameName(nameWords('Pure Glow Skincare'), nameWords('Pure Skin Co'))
    ).toBe(false)
    expect(sameName(nameWords('Bella Skin'), nameWords('Ella'))).toBe(false)
  })

  it('stays quiet when the accounts match the profile', () => {
    expect(
      brandMismatches({
        brandName: 'Cedar Lane',
        website: 'shop.cedarlane.com',
        klaviyoAccount: 'Cedar Lane — synthetic demo',
        shopDomain: 'cedarlane.myshopify.com'
      })
    ).toEqual([])
    expect(
      brandMismatches({
        brandName: 'Northwind',
        website: 'northwindroasters.com',
        klaviyoAccount: 'northwind.com',
        shopDomain: 'northwind-roasters.myshopify.com'
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

  it('does not let a correct website hide a wrong brand name', () => {
    expect(
      brandMismatches({
        brandName: 'Juniper Supply',
        website: 'cedar-lane.example',
        klaviyoAccount: 'Cedar Lane',
        shopDomain: null
      }).map((m) => m.source)
    ).toEqual(['klaviyo'])
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

describe('profileViews', () => {
  const brand = {
    brand_name: 'Cedar Lane',
    domain: 'cedar-lane.example',
    positioning: 'Everyday layers.',
    voice: 'Calm.\nSpecific.',
    prohibitions: 'No hype.',
    revision: 7
  }
  const now = Date.parse('2026-11-06T12:00:00Z')

  it('always shows brand facts from the saved brand, never a stale copy', () => {
    const views = profileViews(
      brand,
      [
        {
          section: 'identity',
          content: { niche: 'Layers' },
          locked: ['niche'],
          revision: 3,
          updatedAt: '2026-11-05T08:00:00Z'
        }
      ],
      now
    )
    expect(views.map((v) => v.section)).toEqual(sections.map((s) => s.key))
    expect(views[0]).toEqual({
      section: 'identity',
      content: { niche: 'Layers' },
      facts: {
        brand_name: 'Cedar Lane',
        domain: 'cedar-lane.example',
        positioning: 'Everyday layers.'
      },
      locked: ['niche'],
      revision: 3,
      brandRevision: 7,
      updated: 'yesterday',
      sample: false
    })
    const tone = views.find((v) => v.section === 'tone')!
    expect(tone).toMatchObject({
      revision: 0,
      facts: { voice: 'Calm.\nSpecific.', prohibitions: 'No hype.' },
      updated: null
    })
    expect(views.find((v) => v.section === 'audience')!.facts).toBeNull()
  })

  it('works before any brand exists', () => {
    const [identity] = profileViews(null, [], now)
    expect(identity).toMatchObject({
      brandRevision: 0,
      revision: 0,
      facts: { brand_name: '', domain: '', positioning: '' }
    })
  })

  it('marks sample text and says when the profile last changed', () => {
    const rows: SectionRow[] = [
      {
        section: 'audience',
        content: { age_range: 'Sample: add an age range here.' },
        locked: [],
        revision: 1,
        updatedAt: '2026-08-02T08:00:00Z'
      },
      {
        section: 'vocabulary',
        content: {},
        locked: [],
        revision: 1,
        updatedAt: '2026-11-06T08:00:00Z'
      }
    ]
    expect(
      profileViews(brand, rows, now).find((v) => v.section === 'audience')!
        .sample
    ).toBe(true)
    expect(lastUpdated(rows, now)).toBe('today')
    expect(updatedAgo('2026-08-02T08:00:00Z', now)).toBe('96 days ago')
    expect(updatedAgo(null, now)).toBeNull()
  })
})
