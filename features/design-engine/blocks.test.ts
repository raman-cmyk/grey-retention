import { describe, expect, it } from 'vitest'
import { parseBlueprint, partsOf, textOf, type Section } from './blueprint'
import {
  blankWords,
  blockFacts,
  blockFingerprint,
  blockLimits,
  cutBlocks,
  dedupe,
  sectionAlone
} from './blocks'
import { isBare } from './stored'
import {
  blueprint,
  button,
  font,
  gridSection,
  image,
  section,
  text
} from './fixtures'

describe('library blocks from a blueprint (DES-ENGINE-004)', () => {
  it('blanks letters and digits, keeps spaces, line breaks, signs and capitals', () => {
    expect(blankWords('Shop the NEW range\n20% off · $24.00')).toBe(
      'Xxxx xxx XXX xxxxx\n00% xxx · $00.00'
    )
    expect(blankWords('Café Ödön')).toBe('Xxxx Xxxx')
  })

  it('cuts every section into a block: one section, words blanked, no picture or link', () => {
    const cut = cutBlocks(blueprint())
    expect(cut.skipped).toEqual([])
    expect(cut.blocks.map((b) => [b.ordinal, b.kind])).toEqual([
      [1, 'hero'],
      [2, 'product_grid']
    ])
    for (const b of cut.blocks) {
      expect(parseBlueprint(b.blueprint).ok).toBe(true)
      expect(parseBlueprint(b.check).ok).toBe(true)
      expect(isBare(b.blueprint)).toBe(true)
      expect(b.blueprint.sections).toHaveLength(1)
      expect(b.blueprint.sections[0]!.ordinal).toBe(1)
      expect(b.blueprint.sections[0]!.gapBefore).toBe(0)
      expect(b.blueprint.margin).toEqual({ top: 0, bottom: 0 })
      const words = partsOf(b.blueprint.sections[0]!.items).flatMap((p) =>
        p.type === 'text'
          ? [textOf(p)]
          : p.type === 'button'
            ? [p.label]
            : p.type === 'image'
              ? [p.alt]
              : []
      )
      for (const w of words) expect(w).toMatch(/^[xX0\s\p{P}\p{S}]*$/u)
      // The check keeps the stored words (bare), for the draw-back.
      expect(isBare(b.check)).toBe(true)
    }
    const hero = cut.blocks[0]!
    const headline = partsOf(hero.blueprint.sections[0]!.items).find(
      (p) => p.role === 'headline'
    )
    expect(headline && textOf(headline as never)).toBe(
      blankWords('Some words for the test')
    )
  })

  it('skips glue, sections the engine cannot draw and empty ones, with the reason', () => {
    const cut = cutBlocks(
      blueprint({
        sections: [
          section({ ordinal: 1 }),
          section({ ordinal: 2, kind: 'spacer', items: [], height: 30 }),
          section({ ordinal: 3, unsupported: 'It is a countdown timer.' }),
          section({ ordinal: 4, kind: 'text', items: [] }),
          section({
            ordinal: 5,
            kind: 'divider',
            items: [
              {
                type: 'divider',
                gapBefore: 0,
                x: 0,
                width: 600,
                height: 1,
                role: 'divider',
                color: '#dddddd'
              }
            ],
            height: 1
          })
        ]
      })
    )
    expect(cut.blocks.map((b) => b.ordinal)).toEqual([1])
    expect(cut.skipped).toEqual([
      { ordinal: 2, kind: 'spacer', why: 'glue' },
      { ordinal: 3, kind: 'hero', why: 'cannot_copy' },
      { ordinal: 4, kind: 'text', why: 'empty' },
      { ordinal: 5, kind: 'divider', why: 'glue' }
    ])
  })

  it('marks a section the engine does not draw safely, by its size', () => {
    const short = cutBlocks(
      blueprint({
        sections: [
          section({
            kind: 'text',
            height: blockLimits.minHeight - 1,
            items: [text({ height: 10, lines: 1 })]
          })
        ]
      })
    )
    expect(short.blocks[0]!.unsafe).toBe('too_small')
    const tall = cutBlocks(
      blueprint({
        sections: [section({ height: blockLimits.maxHeight + 1 })]
      })
    )
    expect(tall.blocks[0]!.unsafe).toBe('too_large')
    expect(cutBlocks(blueprint()).blocks[0]!.unsafe).toBeNull()
  })

  it('keeps the unsubscribe line as the footer Klaviyo needs, though its words are blanked', () => {
    const footer = section({
      kind: 'footer',
      height: 80,
      items: [
        text({
          role: 'footer_text',
          runs: [{ text: 'Unsubscribe or change your preferences' }],
          lines: 1,
          height: 20
        })
      ]
    })
    const [block] = cutBlocks(blueprint({ sections: [footer] })).blocks
    expect(block!.facts.footer).toBe(true)
    const part = partsOf(block!.blueprint.sections[0]!.items)[0]!
    expect(part.role).toBe('legal')
  })

  it('reads the facts the planner needs: photo slots, products, prices, columns', () => {
    const facts = blockFacts(gridSection(2))
    expect(facts.columns).toBe(2)
    expect(facts.products).toBe(2)
    expect(facts.prices).toBe(true)
    expect(facts.code).toBe(false)
    expect(facts.photos).toEqual([
      { role: 'product_photo', width: 260, height: 260 },
      { role: 'product_photo', width: 260, height: 260 }
    ])
    expect(facts.band).toBe(false)
    const hero = blockFacts(section())
    expect(hero.headline).toBe(true)
    expect(hero.buttons).toBe(1)
    expect(hero.photos).toEqual([
      { role: 'hero_photo', width: 600, height: 300 }
    ])
  })

  describe('the fingerprint (de-duplication)', () => {
    const base = section()
    it('is 32 hex characters and the same for the same structure', () => {
      expect(blockFingerprint(base)).toMatch(/^[0-9a-f]{32}$/)
      expect(blockFingerprint(section())).toBe(blockFingerprint(base))
    })

    it('ignores words, colours, pictures, links and a pixel here or there', () => {
      const same: Section = {
        ...base,
        height: base.height + 3,
        background: null,
        around: '#000000',
        items: [
          image({ src: null, href: null, alt: 'Other', width: 598 }),
          text({
            role: 'headline',
            font: { ...font, size: 31, lineHeight: 40, weight: 700 },
            height: 40,
            lines: 1,
            color: '#ff0000',
            runs: [{ text: 'Completely different words' }],
            gapBefore: 26
          }),
          button({ label: 'Go', background: '#00ff00', x: 230, width: 150 })
        ]
      }
      expect(blockFingerprint(same)).toBe(blockFingerprint(base))
    })

    it('reads two paragraphs of the same role as one', () => {
      const one = section({
        kind: 'text',
        items: [text({ lines: 4, height: 96 })]
      })
      const two = section({
        kind: 'text',
        items: [text({ lines: 2 }), text({ lines: 2 })]
      })
      expect(blockFingerprint(two)).toBe(blockFingerprint(one))
    })

    it('differs for another kind, another order, more columns or another shape', () => {
      const print = blockFingerprint(base)
      expect(blockFingerprint({ ...base, kind: 'image' })).not.toBe(print)
      expect(
        blockFingerprint({ ...base, items: [...base.items].reverse() })
      ).not.toBe(print)
      expect(
        blockFingerprint({
          ...base,
          items: [image({ height: 600 }), ...base.items.slice(1)]
        })
      ).not.toBe(print)
      expect(blockFingerprint({ ...base, background: '#222222' })).not.toBe(
        print
      )
      expect(blockFingerprint({ ...base, height: 900 })).not.toBe(print)
      const grid = gridSection(1)
      const three = {
        ...grid,
        items: [
          {
            ...(grid.items[0] as Extract<
              Section['items'][number],
              { type: 'row' }
            >),
            columns: [0, 1, 2].map((i) => ({
              ...(
                grid.items[0] as Extract<
                  Section['items'][number],
                  { type: 'row' }
                >
              ).columns[0]!,
              x: 20 + i * 190,
              width: 180
            }))
          }
        ]
      }
      expect(blockFingerprint(three)).not.toBe(blockFingerprint(grid))
    })

    it('makes near-identical sections one block with a count', () => {
      const cut = cutBlocks(
        blueprint({
          sections: [
            section({ ordinal: 1 }),
            gridSection(2),
            section({ ordinal: 3, height: 462 }),
            gridSection(4)
          ]
        })
      )
      const library = dedupe(cut.blocks)
      expect(library.map((l) => [l.block.ordinal, l.uses])).toEqual([
        [1, 2],
        [2, 2]
      ])
    })
  })

  it('draws a section alone at its email’s width with its email’s colours', () => {
    const bp = blueprint()
    const alone = sectionAlone(bp, bp.sections[1]!)
    expect(alone.width).toBe(600)
    expect(alone.page).toBe(bp.page)
    expect(alone.body).toBe(bp.body)
    expect(alone.sections[0]!.kind).toBe('product_grid')
  })
})
