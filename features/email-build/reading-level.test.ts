import { describe, expect, it } from 'vitest'
import type { Draft } from '@/features/assembly/assemble'
import { industries } from '@/features/intelligence/taxonomy'
import {
  gradeSlack,
  letterReading,
  minGradeWords,
  readingFindings,
  readingGrade,
  readingRule,
  readingTarget,
  readingTargets,
  syllables
} from './reading-level'

/** DST-PIC #28: length and reading level per industry. */
const plain =
  'We made a new candle for the cold nights. It smells of wood and smoke. Light it when you get home and let the room go warm and still. It burns for a long time and is made by hand in our shop. Try it this week and tell us what you think of it.'
const hard =
  'Our meticulously formulated aromatic composition harmonizes complementary botanical constituents, and it delivers an extraordinarily sophisticated olfactory experience for the discerning individual. Additionally, our environmentally conscious manufacturing methodology prioritizes responsibly harvested ingredients, and it demonstrates an uncompromising dedication to the sustainability of the planet.'
const blocks = (...texts: string[]): Pick<Draft, 'blocks'> => ({
  blocks: texts.map((t) => ({
    type: 'text',
    content: { paras: [t], align: 'left' }
  })) as Draft['blocks']
})

describe('length and reading level per industry (DST-PIC #28)', () => {
  it('has a target for every industry, and one for an unknown one', () => {
    for (const industry of industries) {
      const t = readingTargets[industry]
      expect(t.grade).toBeGreaterThanOrEqual(6)
      expect(t.grade).toBeLessThanOrEqual(9)
      expect(t.sectionWords).toBeGreaterThanOrEqual(50)
    }
    expect(readingTarget('electronics')).toEqual({
      grade: 9,
      sectionWords: 80
    })
    expect(readingTarget('crystals')).toEqual(readingTargets.other)
    expect(readingTarget(null)).toEqual(readingTargets.other)
    expect(readingTarget('toString')).toEqual(readingTargets.other)
    expect(readingRule('apparel')).toBe(
      'Write for a reader of school grade 7 or below: short sentences and plain, everyday words. Keep each section to 50 words at most.'
    )
  })

  it('reads English plain words low and long words high', () => {
    expect(syllables('candle')).toBe(2)
    expect(syllables('the')).toBe(1)
    expect(syllables('sophisticated')).toBeGreaterThanOrEqual(4)
    expect(readingGrade(plain)).toBeLessThan(6)
    expect(readingGrade(hard)).toBeGreaterThan(14)
  })

  it('judges no reading level from a few words, or from another language', () => {
    expect(readingGrade('Meticulously formulated aromatic composition.')).toBe(
      null
    )
    const german =
      'Unsere neue Kerze für die kalten Nächte riecht nach Holz und Rauch. Zünde sie an, wenn du nach Hause kommst, und lass den Raum warm und still werden. Sie brennt sehr lange und wird in unserem Laden von Hand gegossen. Probiere sie diese Woche aus und sag uns, wie sie dir gefällt.'
    expect(german.split(/\s+/).length).toBeGreaterThan(minGradeWords)
    expect(readingGrade(german)).toBeNull()
  })

  it('sends back a section over its words and words over their grade, with the reasons', () => {
    const long = Array.from({ length: 13 }, () => 'We made it for you.').join(
      ' '
    )
    expect(readingFindings(blocks(long), 'apparel')).toEqual([
      {
        by: 'code',
        rule: 'section_words',
        field: '1-text',
        reason:
          'This section has 65 words; keep it to 50 at most: say less, in short sentences.'
      }
    ])
    expect(readingFindings(blocks(hard), 'electronics')).toEqual([
      expect.objectContaining({
        rule: 'reading_level',
        field: 'email',
        reason: expect.stringMatching(
          /^The words read at school grade \d+; write for grade 9: shorter sentences and plainer words\.$/
        )
      })
    ])
    // The same 65 words fit a store that explains more.
    expect(readingFindings(blocks(long), 'electronics')).toEqual([])
    expect(readingFindings(blocks(plain), 'home')).toEqual([])
  })

  it('never judges the store’s own words, nor sections the system places', () => {
    const title =
      'Hand-Poured Sustainably Sourced Aromatherapeutic Botanical Composition'
    expect(
      readingFindings(blocks(`${title} ${title} ${title}.`), 'home', [title])
    ).toEqual([])
    const placed = {
      blocks: [
        {
          type: 'founder_note',
          content: { paras: [hard, hard], signoff: 'Maya' }
        }
      ]
    } as Pick<Draft, 'blocks'>
    expect(readingFindings(placed, 'home')).toEqual([])
  })

  it('passes a draft within its slack, and a letter over it goes back', () => {
    expect(gradeSlack).toBe(2)
    expect(letterReading([plain], 'home')).toEqual([])
    expect(letterReading([hard, plain], 'home')).toEqual([
      {
        rule: 'reading_level',
        reason: expect.stringMatching(
          /^The letter reads at school grade \d+; write for grade 7/
        )
      }
    ])
  })
})
