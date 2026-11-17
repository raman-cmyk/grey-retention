import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { brandFonts, studioFaces } from './brand-fonts'
import type { FontFile, SiteFont } from './site/fonts'

const tenantId = '00000000-0000-4000-8000-000000000101'
const latin = 'U+0000-00FF, U+0131, U+0152-0153'
const extended = 'U+0100-02BA, U+02BD-02C5, U+1E00-1E9F'
const file = (name: string, extra: Partial<FontFile> = {}): FontFile => ({
  url: `https://cedarlane.com/cdn/fonts/${name}.woff2`,
  format: 'woff2',
  weight: 400,
  italic: false,
  unicodeRange: latin,
  ...extra
})
const serif: SiteFont = {
  family: 'Cedar Serif',
  roles: ['heading'],
  kind: 'self-hosted',
  files: [
    file('700', { weight: 700 }),
    file('700-ext', { weight: 700, unicodeRange: extended }),
    file('400'),
    file('400-woff', { format: 'woff' }),
    // A style with only its Latin Extended face: no file the studio can use.
    file('300-ext', { weight: 300, unicodeRange: extended }),
    file('400-italic', { italic: true, unicodeRange: null })
  ]
}

describe('studioFaces (FONT-b)', () => {
  it('gives each weight and style its first Latin file, in the reader’s order', () => {
    expect(studioFaces(serif)).toEqual([
      {
        family: 'Cedar Serif',
        url: serif.files[0]!.url,
        weight: 700,
        italic: false
      },
      {
        family: 'Cedar Serif',
        url: serif.files[2]!.url,
        weight: 400,
        italic: false
      },
      // No range: every character, Latin too.
      {
        family: 'Cedar Serif',
        url: serif.files[5]!.url,
        weight: 400,
        italic: true
      }
    ])
    expect(studioFaces({ ...serif, files: [] })).toEqual([])
    // A variable range without 400 or 700 is given at its lowest weight.
    const light = file('light', { weight: 200, maxWeight: 300 })
    expect(studioFaces({ ...serif, files: [light] })).toEqual([
      { family: 'Cedar Serif', url: light.url, weight: 200, italic: false }
    ])
  })
})

/** A database with the workspace's website and its kept fonts. */
function database(
  domain: string | null,
  kept: { domain: string; fonts: unknown } | null,
  error: unknown = null,
  failing = 'brand_fonts'
) {
  const rows: Record<string, unknown> = {
    brand_profiles: domain === null ? null : { domain },
    brand_fonts: kept
  }
  const asked: string[] = []
  return {
    asked,
    db: {
      from: (table: string) => {
        const chain = {
          select: () => chain,
          eq: (column: string, value: string) => (
            asked.push(`${table}.${column}=${value}`),
            chain
          ),
          maybeSingle: async () => ({
            data: rows[table],
            error: table === failing ? error : null
          })
        }
        return chain
      }
    } as unknown as Parameters<typeof brandFonts>[0]
  }
}

describe('brandFonts (FONT-b)', () => {
  const sans: SiteFont = {
    family: 'Dawn Sans',
    roles: ['body'],
    kind: 'google',
    files: [
      {
        url: 'https://fonts.gstatic.com/s/dawnsans/v1/a.woff2',
        format: 'woff2',
        weight: 100,
        maxWeight: 900,
        italic: false,
        unicodeRange: latin
      }
    ]
  }

  it('gives the workspace’s kept fonts, heading first, each with its faces', async () => {
    const { db, asked } = database('WWW.CedarLane.com', {
      domain: 'cedarlane.com',
      fonts: [serif, sans]
    })
    expect(await brandFonts(db, tenantId)).toEqual([
      {
        family: 'Cedar Serif',
        roles: ['heading'],
        kind: 'self-hosted',
        faces: studioFaces(serif)
      },
      {
        family: 'Dawn Sans',
        roles: ['body'],
        kind: 'google',
        // A variable font: one file, as regular and bold.
        faces: [400, 700].map((weight) => ({
          family: 'Dawn Sans',
          url: sans.files[0]!.url,
          weight,
          italic: false
        }))
      }
    ])
    expect(asked).toEqual([
      `brand_profiles.tenant_id=${tenantId}`,
      `brand_fonts.tenant_id=${tenantId}`
    ])
  })

  it('gives none from another website, without a website or without a live read', async () => {
    for (const [domain, kept] of [
      ['newbrand.com', { domain: 'cedarlane.com', fonts: [serif] }],
      ['', { domain: 'cedarlane.com', fonts: [serif] }],
      [null, { domain: 'cedarlane.com', fonts: [serif] }],
      ['cedarlane.com', null]
    ] as const)
      expect(await brandFonts(database(domain, kept).db, tenantId)).toEqual([])
  })

  it('throws when the fonts or the website cannot be read', async () => {
    for (const table of ['brand_fonts', 'brand_profiles']) {
      const kept = { domain: 'cedarlane.com', fonts: [serif] }
      const failed = database('cedarlane.com', kept, { code: '42501' }, table)
      await expect(brandFonts(failed.db, tenantId), table).rejects.toEqual({
        code: '42501'
      })
    }
  })
})
