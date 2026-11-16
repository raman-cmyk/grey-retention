import { describe, expect, it } from 'vitest'
import {
  learnNeverWords,
  maxNeverWords,
  removedPhrases,
  type OwnerEdit
} from './never-words'

const keep = ['Cedar Goods', 'Linen Overshirt']
const none = (drafted: string[], sent: string[]) =>
  expect(removedPhrases({ drafted, sent }, keep)).toEqual([])

const edit = (
  messageId: string,
  drafted: string[],
  sent: string[]
): OwnerEdit => ({ messageId, drafted, sent })

describe('the words the owner took out of one email (PIC-29)', () => {
  it('finds a word taken out, or a phrase swapped, gone from the email he sent', () => {
    expect(
      removedPhrases(
        {
          drafted: [
            'Unmissable linen',
            "Don't miss out on our softest shirts yet",
            'Our amazing new shirts are here.',
            'Every shirt is a total game-changer for your mornings.',
            'Hi [first name], we made something special.'
          ],
          sent: [
            'Quiet linen',
            'Take a look at our softest shirts yet',
            'Our new shirts are here.',
            'Every shirt is a joy for your mornings.',
            'Hi [first name], we made something special.'
          ]
        },
        keep
      )
    ).toEqual([
      { phrase: 'unmissable', instead: 'quiet' },
      { phrase: "don't miss out", instead: 'take a look' },
      { phrase: 'amazing', instead: '' },
      { phrase: 'total game-changer', instead: 'joy' }
    ])
  })

  it('learns nothing from a sentence rewritten, dropped or kept, even one like another he kept', () => {
    none(
      [
        'Discover the ultimate comfort of linen this season.',
        'Hurry, stocks are flying off the shelves!',
        'We sew every shirt by hand.'
      ],
      ['Linen, made slowly, for warm days.', 'We sew every shirt by hand.']
    )
    none(
      ['Our linen shirts are soft.', 'Our linen shirts are breathable.'],
      ['Our linen shirts are breathable.']
    )
  })

  it('learns nothing from a word moved, a sentence split, punctuation, a word said once, case or an apostrophe', () => {
    none(
      ['Meet our new cozy linen shirts.'],
      ['Meet our cozy new linen shirts.']
    )
    none(
      ['Our linen shirts are here and they are soft.'],
      ['Our linen shirts are here.', 'They are soft.']
    )
    none(["Shop now, it's here."], ["Shop now! It's here."])
    none(['Soft, soft linen for you.'], ['Soft linen for you.'])
    none(['Our LINEN shirts are back.'], ['Our linen shirts are back.'])
    none(['Don’t wait for winter.'], ["Don't wait for winter."])
  })

  it('never learns a number, the store’s own words, a placeholder, a short or everyday word, or another form of a word', () => {
    none(
      [
        'Save 20% on the oak tray today.',
        'The Linen Overshirt is back from Cedar Goods in navy.',
        'It is the very best shirt we make.',
        'This is not a sale.',
        'Shop the new colours today.',
        'A big hug from us.',
        "It's here: the linen edit."
      ],
      [
        'Save 15% on the oak tray today.',
        'The is back in navy.',
        'It is the best shirt we make.',
        'This is a sale.',
        'Shop the fresh colours today.',
        'A hug from us.',
        'Here: the linen edit.'
      ]
    )
    none(
      [
        'Our new candles are here for the cold evenings ahead of us all.',
        'We made every candle by hand.',
        'Hi [first name], welcome back.'
      ],
      [
        'Our new candle is here for the cold evenings ahead of us all.',
        'We make every candle by hand.',
        'Hi, welcome back.'
      ]
    )
    none(['रु २००० मा नयाँ कपडा आयो।'], ['रु १५०० मा नयाँ कपडा आयो।'])
  })

  it('reads a word with its marks whole, in any script', () => {
    expect(
      removedPhrases({
        drafted: ['यो नयाँ सुन्दर कपडा हो।'],
        sent: ['यो नयाँ कपडा हो।']
      })
    ).toEqual([{ phrase: 'सुन्दर', instead: '' }])
  })
})

describe('the subject, the preview line and whole rewrites (PIC-29, round 2)', () => {
  it('pairs the subject and the preview line by their line, never by their place among sentences', () => {
    expect(
      removedPhrases({
        drafted: [
          'Linen is back',
          'Soft shirts for warm summer days',
          'Our linen shirts are sewn slowly for warm days.'
        ],
        sent: ['Linen is back', '', 'Our linen shirts are sewn for warm days.']
      })
    ).toEqual([{ phrase: 'slowly', instead: '' }])
  })

  it('learns nothing from a sentence rewritten whole that shares only light words', () => {
    none(['The wait is over.'], ['The cedar edit is live.'])
    none(
      ['Our winter range is perfect for gifting.'],
      ['Our story is simple for once.']
    )
  })

  it('learns nothing from a pair with a long change or little kept, even a word taken out beside it', () => {
    // "amazing" out, and seven words rewritten: a rewrite.
    none(
      [
        'Our amazing linen shirts are sewn by hand in our small studio near the sea.'
      ],
      [
        'Our linen shirts are sewn by hand and checked twice before they leave us.'
      ]
    )
    // Three short changes, but only four of fifteen words kept.
    none(
      [
        'Our truly amazing soft linen shirts are finally back now for spring this whole year.'
      ],
      ['Linen shirts for spring.']
    )
    // The same word taken out of a small edit is learned.
    expect(
      removedPhrases({
        drafted: ['Our amazing linen shirts are sewn by hand.'],
        sent: ['Our linen shirts are sewn by hand.']
      })
    ).toEqual([{ phrase: 'amazing', instead: '' }])
  })

  it('never learns a phrase holding the store’s own word or a form of it', () => {
    expect(
      removedPhrases(
        {
          drafted: ['Our candles are back in the studio.'],
          sent: ['Our trays are back in the studio.']
        },
        ['Cedar Candle']
      )
    ).toEqual([])
    // The system's own words, once part 2 passes them as the store's.
    expect(
      removedPhrases(
        {
          drafted: ['Use code LINEN10 at checkout.'],
          sent: ['Enter LINEN10 at checkout.']
        },
        ['Use code']
      )
    ).toEqual([])
  })

  it('splits sentences in other scripts, and reads a dotted capital I as one letter', () => {
    expect(
      removedPhrases({
        drafted: ['यो कपडा सुन्दर छ।नयाँ कपडा आयो।'],
        sent: ['यो कपडा छ।नयाँ कपडा आयो।']
      })
    ).toEqual([{ phrase: 'सुन्दर', instead: '' }])
    expect(
      removedPhrases({
        drafted: ['Our İnanılmaz linen shirts are here.'],
        sent: ['Our linen shirts are here.']
      })
    ).toEqual([{ phrase: 'inanılmaz', instead: '' }])
  })
})

describe('the words this brand never uses (PIC-29)', () => {
  const notes = ['one', 'two', 'three', 'four']
  const draftedWith = (words: string, n: number) => [
    `Our ${words} linen shirts are here.`,
    `Note ${notes[n]}.`
  ]
  const sentWithout = (n: number) => [
    'Our linen shirts are here.',
    `Note ${notes[n]}.`
  ]

  it('never uses a phrase taken out of two emails, a single word out of three, and watches the rest', () => {
    const learned = learnNeverWords([
      edit('M1', draftedWith('truly luxurious', 0), sentWithout(0)),
      edit('M2', draftedWith('truly luxurious', 1), sentWithout(1)),
      edit('M3', draftedWith('amazing', 0), sentWithout(0)),
      edit('M4', draftedWith('amazing', 1), sentWithout(1)),
      edit('M5', draftedWith('fabulous', 1), sentWithout(1)),
      edit('M6', draftedWith('fabulous', 2), sentWithout(2)),
      edit('M7', draftedWith('fabulous', 3), sentWithout(3)),
      // The same email again, by its id or by its words, counts once.
      edit('M1', draftedWith('truly luxurious', 2), sentWithout(2)),
      edit('M9', draftedWith('amazing', 1), sentWithout(1)),
      // No id: not read.
      edit('', draftedWith('fabulous', 0), sentWithout(0))
    ])
    expect(learned.never.map((w) => [w.phrase, w.removed])).toEqual([
      ['fabulous', 3],
      ['truly luxurious', 2]
    ])
    expect(learned.watched.map((w) => [w.phrase, w.removed])).toEqual([
      ['amazing', 2]
    ])
  })

  it('watches a phrase he took out as often as he left it in', () => {
    const learned = learnNeverWords([
      edit('M1', draftedWith('super cozy', 0), sentWithout(0)),
      edit('M2', draftedWith('super cozy', 1), sentWithout(1)),
      edit('M3', draftedWith('super cozy', 2), draftedWith('super cozy', 2)),
      edit('M4', draftedWith('super cozy', 3), draftedWith('super cozy', 3))
    ])
    expect(learned.never).toEqual([])
    expect(learned.watched).toEqual([
      { phrase: 'super cozy', removed: 2, kept: 2, instead: [] }
    ])
  })

  it('keeps what he wrote instead, ignores bad input, and stays fast and bounded', () => {
    const swapped = (i: number) =>
      edit(
        `S${i}`,
        ['A truly luxurious feel, every day.'],
        [`A ${['soft', 'warm', 'calm', 'light'][i]} feel, every day.`]
      )
    const learned = learnNeverWords([0, 1, 2, 3].map(swapped), [
      42 as never,
      'Cedar Goods'
    ])
    expect(learned.never[0]).toEqual({
      phrase: 'truly luxurious',
      removed: 4,
      kept: 0,
      instead: ['warm', 'calm', 'light']
    })
    expect(
      learnNeverWords([
        null as never,
        { messageId: 'X', drafted: 'text' as never, sent: [] },
        edit('Y', [42 as never], ['ok'])
      ])
    ).toEqual({ never: [], watched: [] })
    // Two-word phrases of letters only, each taken out of two emails.
    const words = Array.from(
      { length: 300 },
      (_, i) =>
        `zz${[...i.toString(26)].map((c) => String.fromCharCode(97 + parseInt(c, 26))).join('')}`
    )
    const many = words.flatMap((w, i) => [
      edit(
        `A${i}`,
        [`Our ${w} ${w}y shirts are here.`, 'Note A.'],
        ['Our shirts are here.', 'Note A.']
      ),
      edit(
        `B${i}`,
        [`Our ${w} ${w}y shirts are here.`, 'Note B.'],
        ['Our shirts are here.', 'Note B.']
      )
    ])
    const long = Array.from(
      { length: 200 },
      (_, i) => `Line ${i} of a long letter about linen and wool.`
    )
    const year = Array.from({ length: 300 }, (_, i) =>
      edit(`Y${i}`, [...long, `Sign ${i}.`], [...long.slice(1), `Sign ${i}.`])
    )
    const oneWord = Array.from({ length: 4_800 }, (_, i) => `Word${i}.`)
    const start = performance.now()
    const capped = learnNeverWords([
      ...many,
      ...year,
      edit('H', oneWord, oneWord.slice(1))
    ])
    expect(performance.now() - start).toBeLessThan(5_000)
    expect(capped.never).toHaveLength(maxNeverWords)
  })
})
