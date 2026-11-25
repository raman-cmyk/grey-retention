// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  copiedLines,
  copyInput,
  copyInputSchema,
  copyPhotoPath,
  copyRecord,
  libraryCopyOn,
  photosFor,
  wordsFromDraft
} from './library-copy'
import { sampleStoreFrom } from './ports'

const tenantId = '00000000-0000-4000-8000-000000000101'
const store = () => sampleStoreFrom('2026-03-02').read(tenantId)
const draft = (over: object = {}) =>
  ({
    subject: 'S',
    preheader: 'P',
    blocks: [
      {
        type: 'hero_product',
        content: {
          headline: 'Our cedar candle',
          sub: 'Hand poured.',
          cta: 'Shop now',
          picture: 'https://cdn.shopify.com/x.jpg'
        }
      },
      { type: 'text', content: { paras: ['One.', 'Two.'] } }
    ],
    productIds: ['p-cedar-candle', 'p-gone'],
    code: 'CANDLE10',
    ...over
  }) as never

describe('the library copy’s input (DES-ENGINE-002b2)', () => {
  it('is off unless the owner turns it on', () => {
    expect(libraryCopyOn({})).toBe(false)
    expect(libraryCopyOn({ DESIGN_LIBRARY_COPY: 'off' })).toBe(false)
    expect(libraryCopyOn({ DESIGN_LIBRARY_COPY: 'on' })).toBe(true)
  })

  it('takes the Copywriter’s words by role, never a link', () => {
    expect(wordsFromDraft(draft())).toMatchObject({
      headline: ['Our cedar candle'],
      body: ['Hand poured.', 'One.', 'Two.'],
      button: ['Shop now']
    })
  })

  it('holds the brand’s own content and money rules, and never where photos may come from', async () => {
    const s = await store()
    const input = copyInput({
      store: s,
      draft: draft(),
      rules: {
        maxDiscountPercent: 20,
        codes: [
          { code: 'candle10', percent: 10 },
          { code: 'OTHER50', percent: 50 }
        ]
      },
      sourceNames: ['Pine & Co', 'pine.example'],
      mode: 'klaviyo'
    })
    expect(copyInputSchema.safeParse(input).success).toBe(true)
    expect(Object.keys(input).sort()).toEqual([
      'brand',
      'mode',
      'products',
      'rules',
      'sourceNames',
      'vocabulary',
      'words'
    ])
    // Only the draft's products the store still has, in order.
    expect(input.products.map((p) => p.id)).toEqual(['p-cedar-candle'])
    // Only the email's own code, at its own percent.
    expect(input.rules.offer).toEqual({ code: 'candle10', percent: 10 })
    expect(input.rules.maxDiscountPercent).toBe(20)
    expect(input.vocabulary).toContain(s.brand.name)
    expect(input.vocabulary).not.toContain('OTHER50')
    expect(input.brand.name).toBe(s.brand.name)
    expect(photosFor(input)).toBeLessThanOrEqual(24)
  })

  it('shows an old price only for a confirmed sale', async () => {
    const s = await store()
    const id = s.products[0]!.id
    const sale = (compareAtIsSale: boolean) =>
      copyInput({
        store: {
          ...s,
          products: s.products.map((p) =>
            p.id === id ? { ...p, compareAt: '$99.00', compareAtIsSale } : p
          )
        },
        draft: draft({ productIds: [id], code: null }),
        rules: { maxDiscountPercent: 0, codes: [] },
        sourceNames: [],
        mode: 'preview'
      }).products[0]!.compareAt
    expect(sale(true)).toBe('$99.00')
    expect(sale(false)).toBeNull()
  })

  it('keeps each cut photo in the workspace’s own folder, under its claim', () => {
    expect(copyPhotoPath('t1', 'b1', 'l1', 3)).toBe('t1/b1/l1/3.jpg')
  })

  it('refuses a record with too many photos or no sections', () => {
    const ok = {
      html: '<p>x</p>',
      sections: [{ ordinal: 1, kind: 'hero', result: 'copied', reason: null }],
      pass: true,
      leaks: [],
      footerAdded: false,
      photos: [0, 1]
    }
    expect(copyRecord.safeParse(ok).success).toBe(true)
    expect(copyRecord.safeParse({ ...ok, sections: [] }).success).toBe(false)
    expect(copyRecord.safeParse({ ...ok, photos: [24] }).success).toBe(false)
  })

  it('says on the email’s page which sections were built from a library block and why', () => {
    expect(
      copiedLines({
        sections: [
          { ordinal: 1, kind: 'header', result: 'copied', reason: null },
          {
            ordinal: 3,
            kind: 'offer',
            result: 'library',
            reason:
              'Section 3 (offer) has a countdown timer, so it was built from the library’s Offer banner block.'
          }
        ]
      })
    ).toEqual([
      'The design was copied from the email you chose in Inspiration, with your brand’s colours, fonts, logo, words and photos. Some sections were built differently:',
      'Section 3 (offer) has a countdown timer, so it was built from the library’s Offer banner block.'
    ])
    expect(
      copiedLines({
        sections: [
          { ordinal: 1, kind: 'header', result: 'copied', reason: null }
        ]
      })
    ).toEqual([
      'Every section was copied from the email you chose in Inspiration, with your brand’s colours, fonts, logo, words and photos.'
    ])
  })
})
