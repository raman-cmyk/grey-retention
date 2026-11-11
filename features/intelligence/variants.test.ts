// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { blockTypes } from '@/features/blocks/catalog'
import { renderBlock } from '@/features/blocks/render'
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import { skeletonOf } from './skeleton'
import {
  fingerprintOf,
  normalSpec,
  seedVariants,
  variantProblems,
  variantSpecSchema,
  type VariantSpec
} from './variants'

const spec: VariantSpec = {
  rows: [
    {
      columns: [
        {
          width: 0.5,
          slots: [
            { kind: 'image', role: 'product', aspect: '1:1', bleed: false }
          ]
        },
        {
          width: 0.5,
          slots: [
            { kind: 'heading', size: 'm' },
            { kind: 'text', lines: 3 },
            { kind: 'price' },
            { kind: 'button', style: 'solid' }
          ]
        }
      ]
    }
  ],
  align: 'left',
  background: 'none',
  padding: 'm'
}

describe('block variants', () => {
  it('give the 20 families one seed variant each, all drawable and all different', () => {
    const seeds = seedVariants()
    expect(seeds.map((s) => s.family)).toEqual(blockTypes)
    for (const seed of seeds)
      expect(variantProblems(seed.family, seed.spec), seed.family).toEqual([])
    expect(new Set(seeds.map((s) => s.fingerprint)).size).toBe(20)
  })

  it('keep the same fingerprint for a pixel, a line or a word of difference, and a new one for a new structure', () => {
    const near: VariantSpec = {
      ...spec,
      rows: [
        {
          columns: [
            { ...spec.rows[0]!.columns[0]!, width: 0.52 },
            {
              width: 0.48,
              slots: spec.rows[0]!.columns[1]!.slots.map((s) =>
                s.kind === 'text' ? { kind: 'text', lines: 4 } : s
              )
            }
          ]
        }
      ]
    }
    expect(fingerprintOf('product_feature', near)).toBe(
      fingerprintOf('product_feature', spec)
    )
    const flipped: VariantSpec = {
      ...spec,
      rows: [{ columns: [...spec.rows[0]!.columns].reverse() }]
    }
    expect(fingerprintOf('product_feature', flipped)).not.toBe(
      fingerprintOf('product_feature', spec)
    )
    // The same structure in another family is another variant.
    expect(fingerprintOf('image_text', spec)).not.toBe(
      fingerprintOf('product_feature', spec)
    )
  })

  it('say in words what makes a structure undrawable', () => {
    expect(
      variantProblems('product_feature', {
        ...spec,
        rows: [{ columns: [{ ...spec.rows[0]!.columns[1]!, width: 0.7 }] }]
      })
    ).toEqual([
      'row 1: the columns add up to 0.70',
      'a product_feature needs a image'
    ])
    expect(variantSpecSchema.safeParse({ ...spec, rows: [] }).success).toBe(
      false
    )
    expect(
      variantSpecSchema.safeParse({
        ...spec,
        rows: [{ columns: [{ width: 1, slots: [{ kind: 'video' }] }] }]
      }).success
    ).toBe(false)
  })

  it('store no words, links or colours: only kinds of things and their place', () => {
    const stored = JSON.stringify(normalSpec(spec))
    expect(stored).not.toMatch(/https?:|#[0-9a-f]{3}|[A-Z][a-z]+ [a-z]+/)
  })
})

describe('skeletonOf', () => {
  it('reads every seed block back from its own HTML as a drawable structure of its family', () => {
    for (const family of blockTypes) {
      const html = renderBlock(sampleBlocks[family], sampleBrand)
      const read = skeletonOf(html)
      expect(read, family).not.toBeNull()
      expect(variantSpecSchema.safeParse(read).success, family).toBe(true)
      const total = (row: VariantSpec['rows'][number]) =>
        row.columns.reduce((sum, c) => sum + c.width, 0)
      for (const row of read!.rows)
        expect(Math.abs(total(row) - 1), family).toBeLessThan(0.02)
    }
  })

  it('finds the columns, pictures, heading, price and button of a product card, never its words', () => {
    const read = skeletonOf(
      '<table><tr>' +
        '<td width="50%"><img src="https://shop.example/a.jpg" width="280" height="280" alt="Linen shirt"></td>' +
        '<td width="50%" style="text-align:left"><h3 style="font-size:20px">Linen shirt</h3><p>Soft, breathable and made to last for years.</p><p>$48.00</p>' +
        '<table><tr><td bgcolor="#222222"><a href="https://shop.example/a">Shop now</a></td></tr></table></td>' +
        '</tr></table>'
    )
    expect(read!.rows).toHaveLength(1)
    const [left, right] = read!.rows[0]!.columns
    expect(left).toMatchObject({
      width: 0.5,
      slots: [{ kind: 'image', role: 'product', aspect: '1:1' }]
    })
    expect(right!.slots.map((s) => s.kind)).toEqual([
      'heading',
      'text',
      'price',
      'button'
    ])
    expect(JSON.stringify(read)).not.toMatch(/Linen|shop\.example|222222/)
  })

  it('ignores spacer cells and tracking pixels, and keeps every column at least a tenth wide', () => {
    const product = (n: string) =>
      `<td width="180"><img src="${n}.jpg" width="180" height="180"><p>Shirt</p><p>$20</p></td>`
    const gap =
      '<td width="20"><img src="spacer.gif" width="20" height="1"></td>'
    const spaced = skeletonOf(
      `<table><tr>${product('a')}${gap}${product('b')}${gap}${product('c')}</tr></table>`
    )
    expect(spaced!.rows[0]!.columns.map((c) => c.width)).toEqual([
      0.34, 0.33, 0.33
    ])
    const pixels = skeletonOf(
      '<table><tr>' +
        '<td width="1"><img src="x.gif" width="1" height="1"></td>'.repeat(3) +
        '<td width="600"><h2>Hello there</h2><p>Body text here</p></td></tr></table>'
    )
    expect(pixels!.rows[0]!.columns).toHaveLength(1)
    const icon = skeletonOf(
      '<table><tr><td width="30"><img src="i.png" width="30" height="30"></td>' +
        '<td width="570"><p>Free shipping on every order over fifty</p></td></tr></table>'
    )
    expect(icon!.rows[0]!.columns.map((c) => c.width)).toEqual([0.1, 0.9])
  })

  it('always gives a structure the library can store, whatever the columns', () => {
    // Every mix of up to four cells of these widths, with or without content.
    const widths = [
      '',
      '1',
      '20',
      '45',
      '90',
      '200',
      '300',
      '590',
      '10%',
      '80%'
    ]
    const cells = widths.flatMap((w) => [
      `<td width="${w}"><img src="p.jpg" width="${w || 100}" height="100"><p>$9</p></td>`,
      `<td width="${w}"><p>Words in a column</p><a style="background:#000">Go</a></td>`,
      `<td width="${w}">&nbsp;</td>`
    ])
    let seed = 7
    const next = () => (seed = (seed * 48_271) % 2_147_483_647)
    for (let n = 0; n < 400; n++) {
      const row = Array.from(
        { length: 1 + (next() % 4) },
        () => cells[next() % cells.length]
      ).join('')
      const read = skeletonOf(`<table><tr>${row}</tr></table><hr>`)
      if (read) {
        expect(variantSpecSchema.safeParse(read).success, row).toBe(true)
        for (const r of read.rows)
          expect(
            Math.abs(r.columns.reduce((a, c) => a + c.width, 0) - 1),
            row
          ).toBeLessThanOrEqual(0.02)
      }
    }
  })

  it('reads a hidden preview line and a coloured footer link as nothing special', () => {
    const read = skeletonOf(
      '<div style="max-height:0;overflow:hidden">A hidden preview line for inboxes</div>' +
        '<table><tr><td style="color:#999999"><a href="https://x.test/u">Unsubscribe</a> from these emails</td></tr></table>'
    )
    expect(read!.rows).toHaveLength(1)
    expect(read!.rows[0]!.columns[0]!.slots.map((s) => s.kind)).toEqual([
      'text'
    ])
  })

  it('gives nothing for an empty or oversized section', () => {
    expect(skeletonOf('<table><tr><td>&nbsp;</td></tr></table>')).toBeNull()
    expect(skeletonOf('<td>x</td>'.repeat(6_000))).toBeNull()
  })
})
