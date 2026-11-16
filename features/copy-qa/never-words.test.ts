import { describe, expect, it } from 'vitest'
import {
  learnNeverWords,
  maxNeverWords,
  removedPhrases,
  type OwnerEdit
} from './never-words'

const keep = ['Cedar Goods', 'Linen Overshirt']

const edit = (
  messageId: string,
  drafted: string[],
  sent: string[]
): OwnerEdit => ({ messageId, drafted, sent })

describe('the words the owner took out of one email (PIC-29)', () => {
  it('finds a word taken out, or swapped, with the words around it kept', () => {
    expect(
      removedPhrases(
        {
          drafted: [
            'Our amazing new shirts are here',
            'Every shirt is a total game-changer for your mornings.',
            'Hi [first name], we made something special.'
          ],
          sent: [
            'Our new shirts are here',
            'Every shirt is a joy for your mornings.',
            'Hi [first name], we made something special.'
          ]
        },
        keep
      )
    ).toEqual([
      { phrase: 'amazing', instead: '' },
      { phrase: 'total game-changer', instead: 'joy' }
    ])
  })

  it('learns nothing from a sentence rewritten, dropped or kept', () => {
    expect(
      removedPhrases({
        drafted: [
          'Discover the ultimate comfort of linen this season.',
          'Hurry, stocks are flying off the shelves!',
          'We sew every shirt by hand.'
        ],
        sent: [
          'Linen, made slowly, for warm days.',
          'We sew every shirt by hand.'
        ]
      })
    ).toEqual([])
  })

  it('never learns a number, the store’s own words or filler alone', () => {
    expect(
      removedPhrases(
        {
          drafted: [
            'Save 20% on the oak tray today.',
            'The Linen Overshirt is back from Cedar Goods in navy.',
            'It is the very best shirt we make.'
          ],
          sent: [
            'Save 15% on the oak tray today.',
            'The is back in navy.',
            'It is the best shirt we make.'
          ]
        },
        keep
      )
    ).toEqual([])
  })

  it('reads a subject and a preview line as sentences too', () => {
    expect(
      removedPhrases({
        drafted: ['Unmissable: the linen edit', 'Shop the epic new colours'],
        sent: ['The linen edit', 'Shop the new colours']
      })
    ).toEqual([
      { phrase: 'unmissable', instead: '' },
      { phrase: 'epic', instead: '' }
    ])
  })
})

describe('the words this brand never uses (PIC-29)', () => {
  const drafted = (word: string) => [
    `Our ${word} linen shirts are here.`,
    'We sew every shirt by hand.'
  ]
  const sent = ['Our linen shirts are here.', 'We sew every shirt by hand.']

  it('never uses a word taken out of two emails, and watches one taken out once', () => {
    const learned = learnNeverWords([
      edit('M1', drafted('amazing'), sent),
      edit('M2', drafted('amazing'), sent),
      edit('M3', drafted('epic'), sent),
      // The same email again counts once.
      edit('M3', drafted('epic'), sent)
    ])
    expect(learned.never).toEqual([
      { phrase: 'amazing', removed: 2, kept: 0, instead: [] }
    ])
    expect(learned.watched).toEqual([
      { phrase: 'epic', removed: 1, kept: 0, instead: [] }
    ])
  })

  it('watches a word he took out as often as he left it in', () => {
    const learned = learnNeverWords([
      edit('M1', drafted('cozy'), sent),
      edit('M2', drafted('cozy'), sent),
      edit('M3', drafted('cozy'), drafted('cozy')),
      edit('M4', drafted('cozy'), drafted('cozy'))
    ])
    expect(learned.never).toEqual([])
    expect(learned.watched).toEqual([
      { phrase: 'cozy', removed: 2, kept: 2, instead: [] }
    ])
  })

  it('keeps what he wrote instead, and stays bounded on bad or huge input', () => {
    const swapped = (i: number) =>
      edit(
        `S${i}`,
        ['A truly luxurious feel, every day.'],
        [`A ${['soft', 'warm', 'calm', 'light'][i]} feel, every day.`]
      )
    const learned = learnNeverWords([0, 1, 2, 3].map(swapped))
    expect(learned.never[0]).toEqual({
      phrase: 'truly luxurious',
      removed: 4,
      kept: 0,
      instead: ['warm', 'calm', 'light']
    })
    const bad = learnNeverWords([
      null as never,
      { messageId: 'X', drafted: 'text' as never, sent: [] },
      edit('Y', [42 as never], ['ok'])
    ])
    expect(bad).toEqual({ never: [], watched: [] })
    // Words of letters only (a number is never learned).
    const words = Array.from(
      { length: 300 },
      (_, i) =>
        `zz${[...i.toString(26)].map((c) => String.fromCharCode(97 + parseInt(c, 26))).join('')}`
    )
    const many = words.flatMap((w, i) => [
      edit(`A${i}`, [`Our ${w} shirts are here.`], ['Our shirts are here.']),
      edit(`B${i}`, [`Our ${w} shirts are here.`], ['Our shirts are here.'])
    ])
    const huge = ['Linen '.repeat(20_000)]
    const start = performance.now()
    const capped = learnNeverWords([...many, edit('H', huge, huge)])
    expect(performance.now() - start).toBeLessThan(3_000)
    expect(capped.never).toHaveLength(maxNeverWords)
  })
})
