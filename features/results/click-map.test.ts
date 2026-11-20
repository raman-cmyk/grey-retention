// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { designHash, htmlHash, withImages } from '@/features/klaviyo-push/html'
import { changedBefore, ownHtml, variationMap } from './click-map'

const designA =
  '<table><tr data-block="hero_product"><td><img src="https://cdn.example/a.png"><a href="https://shop.example/p/1">A</a></td></tr></table>'
const designB =
  '<table><tr data-block="product_grid"><td><a href="https://shop.example/p/1">B</a></td></tr></table>'
const edited =
  '<table><tr data-block="text_block"><td><a href="https://shop.example/p/1">New</a></td></tr></table>'
const images = {
  'https://cdn.example/a.png': 'https://d3k81ch9hvuctc.cloudfront.net/a.png'
}
const fp = (html: string) => htmlHash(html).slice(0, 16)

describe('our own HTML of each variation', () => {
  it('is the design whose fingerprint, pictures moved, is that variation’s template', () => {
    const own = ownHtml(
      [
        { variation: 'VarA01', hash: designHash(withImages(designA, images)) },
        { variation: 'VarB01', hash: designHash(designB) },
        { variation: 'VarOld', hash: designHash(designB), deleted: true },
        { variation: null, hash: designHash(designB) }
      ],
      [designB, designA],
      images,
      null
    )
    expect([...own]).toEqual([
      ['VarA01', designA],
      ['VarB01', designB]
    ])
  })

  it('is none when no design matches (never the other design)', () => {
    const own = ownHtml(
      [{ variation: 'VarB01', hash: 'f'.repeat(64) }],
      [designA],
      {},
      null
    )
    expect(own.size).toBe(0)
  })

  it('matches a text email’s template with its plain text', () => {
    const own = ownHtml(
      [{ variation: 'VarA01', hash: designHash(designA, 'Hello {{ x }}') }],
      [designA],
      {},
      'Hello {{ x }}'
    )
    expect(own.get('VarA01')).toBe(designA)
  })
})

describe('one variation’s map', () => {
  const variation = { id: 'VarB01', templateId: 'TplCopy1' }
  const shown = { template: 'TplCopy1', html: fp(designB), writing: false }
  const base = {
    variation,
    design: 'B' as const,
    own: designB,
    shown,
    read: { html: designB, text: null },
    before: false
  }

  it('is our own HTML while its template shows what was pushed', () => {
    expect(variationMap(base)).toMatchObject({
      from: 'build',
      changed: false,
      sections: [{ block: 'product_grid' }]
    })
  })

  it('is its template as read now when we kept none of ours', () => {
    expect(variationMap({ ...base, own: undefined })).toMatchObject({
      from: 'klaviyo',
      changed: false,
      sections: [{ block: 'product_grid' }]
    })
  })

  it('is its template as it is now once changed in Klaviyo, and says so', () => {
    expect(
      variationMap({ ...base, read: { html: edited, text: null } })
    ).toMatchObject({
      from: 'klaviyo',
      changed: true,
      sections: [{ block: 'text_block' }]
    })
  })

  it('sees another template put on it, but not while the push was putting one on', () => {
    const other = { ...variation, templateId: 'TplCopy9' }
    expect(
      variationMap({
        ...base,
        variation: other,
        read: { html: edited, text: null }
      })
    ).toMatchObject({ changed: true, from: 'klaviyo' })
    expect(
      variationMap({
        ...base,
        variation: other,
        shown: { ...shown, writing: true }
      })
    ).toMatchObject({ changed: false, from: 'build' })
  })

  it('keeps our own HTML when its template cannot be read, unless it was seen changed', () => {
    expect(variationMap({ ...base, read: null })).toMatchObject({
      from: 'build',
      changed: false
    })
    // Seen changed at an earlier read: it stays so, and never our old HTML.
    expect(variationMap({ ...base, read: null, before: true })).toEqual({
      variation: 'VarB01',
      design: 'B',
      sections: null,
      from: null,
      changed: true
    })
  })

  it('is unknown with neither, or with HTML that holds no section', () => {
    expect(
      variationMap({ ...base, own: undefined, read: null, shown: undefined })
    ).toMatchObject({ sections: null, from: null, changed: false })
    expect(
      variationMap({
        ...base,
        own: undefined,
        read: {
          html: '<p><a href="https://shop.example/p/1">x</a></p>',
          text: null
        }
      })
    ).toMatchObject({ sections: null, from: null })
  })

  it('takes a text email’s template with its plain text as unchanged', () => {
    const text = 'Hello'
    expect(
      variationMap({
        ...base,
        shown: { ...shown, html: designHash(designB, text).slice(0, 16) },
        read: { html: designB, text }
      })
    ).toMatchObject({ changed: false, from: 'build' })
  })
})

describe('variations seen changed before', () => {
  it('are read from the earlier read’s context', () => {
    expect([
      ...changedBefore({
        sections: [
          { variation: 'VarA01', changed: false },
          { variation: 'VarB01', changed: true }
        ]
      })
    ]).toEqual(['VarB01'])
    expect(changedBefore(null).size).toBe(0)
    expect(changedBefore({ sections: 'x' }).size).toBe(0)
  })
})
