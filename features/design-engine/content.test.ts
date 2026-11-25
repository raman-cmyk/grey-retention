import { describe, expect, it } from 'vitest'
import type { Blueprint, RowItem, TextPart } from './blueprint'
import { compareContent, sameFamily } from './content'
import { blueprint, section, text } from './fixtures'

const clone = (bp: Blueprint): Blueprint => structuredClone(bp)

describe('the content unchanged check', () => {
  it('finds nothing when every part says and shows the same', () => {
    expect(compareContent(blueprint(), blueprint())).toEqual(new Map())
  })

  it('finds a dropped link, a changed word and a lost bold', () => {
    const withLink = blueprint({
      sections: [
        section({
          items: [
            text({
              runs: [
                { text: 'Read ' },
                { text: 'more', href: 'https://example.com/a', weight: 700 }
              ]
            })
          ]
        })
      ]
    })
    for (const change of [
      (t: TextPart) => (t.runs[1] = { text: 'more', weight: 700 }),
      (t: TextPart) => (t.runs[0] = { text: 'Rest ' }),
      (t: TextPart) =>
        (t.runs[1] = { text: 'more', href: 'https://example.com/a' })
    ]) {
      const drawn = clone(withLink)
      change(drawn.sections[0]!.items[0] as TextPart)
      expect(compareContent(withLink, drawn).get(1)).toEqual([
        'In it, part 1: its words, links or their look differ from the original.'
      ])
    }
  })

  it('finds a wrong colour, a wrong fill, a different picture and a different button link', () => {
    const drawn = clone(blueprint())
    ;(drawn.sections[0]!.items[1] as TextPart).color = '#ff0000'
    const grid = drawn.sections[1]!.items[0] as RowItem
    grid.columns[1]!.background = '#000000'
    if (drawn.sections[0]!.items[0]!.type === 'image')
      drawn.sections[0]!.items[0]!.src = 'https://example.com/other.png'
    if (drawn.sections[0]!.items[2]!.type === 'button')
      drawn.sections[0]!.items[2]!.href = 'https://example.com/elsewhere'
    const found = compareContent(blueprint(), drawn)
    expect(found.get(1)).toEqual([
      'In it, part 1: the picture is a different one.',
      "In it, part 2: its words are #ff0000 where the original's are #333333.",
      'In it, part 3: the button links somewhere else.'
    ])
    expect(found.get(2)).toEqual([
      'In it, column 2 is filled #000000 where the original is #f6f6f6.'
    ])
  })

  it('takes the drawn font list when it starts with the original’s', () => {
    expect(
      sameFamily('Brand Sans', 'Brand Sans, Helvetica, Arial, sans-serif')
    ).toBe(true)
    expect(sameFamily('Brand Sans, Arial', 'Arial, Brand Sans')).toBe(false)
    const drawn = clone(blueprint())
    ;(drawn.sections[0]!.items[1] as TextPart).font = {
      ...(drawn.sections[0]!.items[1] as TextPart).font,
      family: 'Georgia, serif',
      weight: 400
    }
    expect(compareContent(blueprint(), drawn).get(1)).toEqual([
      'In it, part 2: the text is in Georgia, serif where the original is in Arial, Helvetica, sans-serif.',
      'In it, part 2: the text has weight 400 where the original has 700.'
    ])
  })

  it('leaves out sections built from a block, and checks the colours around the email', () => {
    const drawn = clone(blueprint())
    ;(drawn.sections[1]!.items[0] as RowItem).columns[1]!.background = null
    expect(compareContent(blueprint(), drawn, new Set([2]))).toEqual(new Map())
    expect(
      compareContent(blueprint(), { ...blueprint(), page: '#000000' }).get(0)
    ).toEqual(['The colours around the email differ from the original.'])
  })
})
