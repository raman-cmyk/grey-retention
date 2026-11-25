import { describe, expect, it } from 'vitest'
import {
  blueprintHeight,
  depthOf,
  parseBlueprint,
  partsOf,
  placedBoxes,
  textOf,
  type Item
} from './blueprint'
import { blueprint, gridSection, image, section, text } from './fixtures'

describe('blueprint', () => {
  it('accepts a whole email map', () => {
    const parsed = parseBlueprint(blueprint())
    expect(parsed.ok).toBe(true)
  })

  it('refuses a colour that is not six-digit hex, an unsafe link and a picture that is not https', () => {
    expect(parseBlueprint(blueprint({ page: 'red' })).ok).toBe(false)
    const badLink = blueprint({
      sections: [section({ items: [image({ href: 'javascript:alert(1)' })] })]
    })
    expect(parseBlueprint(badLink).ok).toBe(false)
    const badPicture = blueprint({
      sections: [
        section({ items: [image({ src: 'http://example.com/a.png' })] })
      ]
    })
    expect(parseBlueprint(badPicture).ok).toBe(false)
    const svg = blueprint({
      sections: [
        section({
          items: [image({ src: 'data:image/svg+xml;base64,PHN2Zz4=' })]
        })
      ]
    })
    expect(parseBlueprint(svg).ok).toBe(false)
  })

  it('refuses font names with anything but names in them', () => {
    const bad = blueprint({
      sections: [
        section({
          items: [text({ font: { ...text().font, family: 'Arial;color:red' } })]
        })
      ]
    })
    expect(parseBlueprint(bad).ok).toBe(false)
  })

  it('needs sections numbered in order', () => {
    const parsed = parseBlueprint(
      blueprint({ sections: [section({ ordinal: 2 })] })
    )
    expect(parsed).toMatchObject({ ok: false })
  })

  it('keeps rows nested at most four deep', () => {
    let items: Item[] = [text()]
    for (let i = 0; i < 5; i++)
      items = [
        {
          type: 'row',
          gapBefore: 0,
          height: 50,
          keepOnPhone: false,
          columns: [
            {
              x: 0,
              y: 0,
              width: 100,
              height: 50,
              background: null,
              radius: 0,
              border: null,
              items,
              bottom: 0
            }
          ]
        }
      ]
    expect(depthOf(items)).toBe(5)
    expect(
      parseBlueprint(blueprint({ sections: [section({ items })] })).ok
    ).toBe(false)
  })

  it('lists parts top to bottom and lays out boxes the way the drawing code does', () => {
    const bp = blueprint()
    expect(partsOf(bp.sections[1]!.items).map((p) => p.type)).toEqual([
      'image',
      'text',
      'image',
      'text'
    ])
    expect(textOf(text())).toBe('Some words for the test')
    const boxes = placedBoxes(bp)
    // The hero picture at the top, the headline 20 px under it.
    expect(boxes[0]).toMatchObject({
      kind: 'image',
      x: 0,
      y: 0,
      width: 600,
      height: 300
    })
    expect(boxes[1]).toMatchObject({ kind: 'text', x: 40, y: 320 })
    // The grid's second column has a fill, then its picture inside it.
    const grid = boxes.filter((b) => b.section === 2)
    expect(grid[0]).toMatchObject({ kind: 'image', x: 30, y: 460 + 20 })
    expect(grid.find((b) => b.kind === 'fill')).toMatchObject({
      x: 310,
      y: 480,
      width: 260,
      height: 300
    })
    expect(blueprintHeight(bp)).toBe(460 + 340)
    expect(gridSection(3).ordinal).toBe(3)
  })
})
