import { describe, expect, it } from 'vitest'
import { voiceExcerpt } from './excerpt'
import {
  founderVoice,
  maxVoiceCharsRead,
  maxVoiceExamples,
  minVoiceWords
} from './profile'
import type { VoiceSample } from './samples'

const sample = (
  text: string,
  weight: VoiceSample['weight'] = 3,
  messageId = 'Msg1'
): VoiceSample => ({
  messageId,
  text,
  weight,
  words: text.split(/\s+/).length,
  sentAt: null
})

const own = ['Cedar Goods', 'Linen Overshirt']

/** The recorded account's founder letter, as the history read keeps it. */
const letter = voiceExcerpt(
  {
    messageId: 'MsgA08',
    editor: 'rich_text',
    html: '',
    text: 'Hi {{ first_name|default:"friend" }},\n\nI started Cedar Goods in my garage with one sewing machine and a lot of stubbornness. Every shirt still gets checked by hand before it ships.\n\nThank you for being here. If you ever have a question, just hit reply. I read every one.\n\nWarmly,\nMaya',
    truncated: false,
    updated: null
  } as never,
  own
)!

/** A plain letter body of about 60 words, as a founder writes. */
const body = [
  'We spent the whole summer testing new dyes for the winter shirts.',
  'The deep green took the longest, and we think it was worth it.',
  'Each piece is cut and sewn in our studio, one at a time.',
  'We hope one of them keeps you warm on the cold mornings ahead.',
  'Write back and tell us which colour you would pick.'
].join(' ')

describe('founderVoice (PIC-23 part 3a)', () => {
  it('reads the founder’s greeting, sign-off, "I" and sentences from their letter', () => {
    expect(founderVoice([sample(letter.text)], own)).toEqual({
      greeting: 'Hi,',
      signoff: 'Warmly,',
      writesAs: 'I',
      sentenceWords: 9,
      exclamations: 'never',
      contractions: 'never',
      examples: [
        'I started Cedar Goods in my garage with one sewing machine and a lot of stubbornness.',
        'Every shirt still gets checked by hand before it ships.',
        'If you ever have a question, just hit reply.'
      ],
      from: { samples: 1, words: 44 }
    })
  })

  it('says nothing from designed emails, from too few words, or from no list', () => {
    const designed = sample(`Loved by you\n${body}`, 1)
    expect(founderVoice([designed])).toBeNull()
    expect(
      founderVoice([sample('Hi,\nWe made a new candle. Come see.\nBest,')])
    ).toBeNull()
    expect(founderVoice([])).toBeNull()
    expect(founderVoice(null as never)).toBeNull()
    expect(founderVoice('text' as never)).toBeNull()
    expect(minVoiceWords).toBe(40)
  })

  it('reads a team that writes as "we", with "!" and contractions, each example once', () => {
    const team = (greeting: string, n: number) =>
      sample(
        `${greeting}\n\nWe're so glad you're here! We've been busy in the studio all week, and we can't wait to show you what we made. It's our favourite batch of the whole year!\n\nWe hope you love it as much as we do.\n\nTalk soon,\nThe team`,
        3,
        `Msg${n}`
      )
    const voice = founderVoice([
      team('Hey friends,', 1),
      team('Hello [first name],', 2),
      team('Hey friends,', 3)
    ])!
    expect(voice).toMatchObject({
      greeting: 'Hey friends,',
      signoff: 'Talk soon,',
      writesAs: 'we',
      exclamations: 'often',
      contractions: 'often',
      from: { samples: 3 }
    })
    expect(new Set(voice.examples).size).toBe(voice.examples.length)
  })

  it('keeps a greeting or sign-off used in at least half the emails, with "!" too', () => {
    const plain = (n: number) => sample(body, 3, `MsgP${n}`)
    // One coded email's line never decides for three letters.
    expect(
      founderVoice([
        plain(1),
        plain(2),
        plain(3),
        sample(`Hey there,\n${body}\nShop the sale,`, 2, 'MsgC')
      ])
    ).toMatchObject({ greeting: null, signoff: null })
    // "Hi [first name]!" and "Cheers!" are a greeting and a sign-off, never sentences.
    const cheery = founderVoice([sample(`Hi [first name]!\n${body}\nCheers!`)])!
    expect(cheery).toMatchObject({
      greeting: 'Hi!',
      signoff: 'Cheers!',
      exclamations: 'never'
    })
    // A placeholder in the middle, a dash alone, a comma line fourth from the end: none.
    expect(
      founderVoice([
        sample(
          `Hello [first name] and [last name],\n${body}\nWarmly,\nMaya\nP.S. More soon.\nBye.`
        )
      ])
    ).toMatchObject({ greeting: null, signoff: null })
    expect(
      founderVoice([sample(`Hi - [first name],\n${body}`)])!.greeting
    ).toBeNull()
    // Other scripts' commas.
    expect(
      founderVoice([sample(`Bonjour à tous，\n${body}\nÀ bientôt،`)])
    ).toMatchObject({ greeting: 'Bonjour à tous，', signoff: 'À bientôt،' })
  })

  it('never gives an example that holds a name, a quote, a code, an offer, a link or a fragment', () => {
    const risky = sample(
      [
        'Hi [first name],',
        'Use code WELCOME at checkout for a little thank you from us.',
        'Everything in the shop is half price until Sunday night.',
        'Come and see the new pieces at cedargoods.studio this week.',
        'My sister Anna sewed the first hundred bags with me last spring.',
        'I love this note from a customer: "The softest shirt I own, I wear it every single day."',
        'Sarah wrote to tell me her shirt survived a whole year of camping.',
        'Thanks to Priya and Tom for packing every order this busy week.',
        'The softest overshirt we have ever made',
        'I started this shop in my garage with one old',
        'sewing machine and a lot of patience, and it still runs well.',
        'Warmly, Maya and the whole team at the studio'
      ].join('\n'),
      3,
      'MsgR'
    )
    const voice = founderVoice([risky], own)!
    expect(voice.examples).toEqual([
      // A line wrapped inside a sentence is read as one sentence.
      'I started this shop in my garage with one old sewing machine and a lot of patience, and it still runs well.'
    ])
    expect(voice.examples.join(' ')).not.toMatch(
      /Anna|Sarah|Priya|Tom|Maya|WELCOME|half|studio\b|"/
    )
  })

  it('reads the letters first, at most five examples of 6 to 25 words, and passes over a sample too long', () => {
    const coded = sample(
      'Our autumn knits are back on the shelves and a little thicker this year.\nCome by the shop and say hello to the whole team soon.',
      2,
      'MsgC'
    )
    const long = sample(
      [
        'It was lovely to see you at the market last week.',
        'The candles you liked are made from the same soy wax as always.',
        'I pour each one by hand in the studio behind our little shop.',
        'They burn slowly and smell like cedar and rain on a warm evening.',
        'I hope one of them finds a place in your home this winter.',
        'I would love to hear which scent you pick for the colder nights.',
        'Write back any time.',
        'I read every single message myself, usually with a cup of tea in the morning before the shop opens and the phone starts ringing again.'
      ].join(' '),
      3,
      'MsgL'
    )
    const huge = sample('word '.repeat(maxVoiceCharsRead / 5 + 1), 3, 'MsgH')
    const voice = founderVoice([
      coded,
      huge,
      null as never,
      { text: 42, weight: 3 } as never,
      long
    ])!
    expect(voice.from.samples).toBe(2)
    expect(voice.examples).toHaveLength(maxVoiceExamples)
    expect(voice.examples[0]).toBe(
      'It was lovely to see you at the market last week.'
    )
    // Five words, or twenty-six: never an example.
    expect(voice.examples).not.toContain('Write back any time.')
    expect(voice.examples.join(' ')).not.toMatch(/cup of tea/)
    expect(voice.writesAs).toBe('I')
  })

  it('says nothing of "I", "we" or contractions for a store that writes another language', () => {
    const italian = sample(
      'Ciao,\nAbbiamo scelto i tessuti più morbidi per i nostri clienti di sempre. Tutti i capi sono cuciti a mano nel nostro piccolo laboratorio di città. Speriamo che i nuovi colori vi piacciano quanto piacciono a noi. Scriveteci quando volete, leggiamo tutti i messaggi con calma.\nA presto,\nIl team'
    )
    expect(founderVoice([italian])).toMatchObject({
      greeting: 'Ciao,',
      signoff: 'A presto,',
      writesAs: null,
      contractions: null
    })
    // Mixed "I" and "we": neither.
    expect(
      founderVoice([
        sample(
          'I made the first batch myself this spring. We packed every order together in the studio. I chose the colours with care for the season. We hope you like the way they turned out. We will make more of them before the end of the winter months.'
        )
      ])!.writesAs
    ).toBeNull()
  })

  it('never gives an example with an offer or a deadline in words, a name as its first word, or a quote in brackets (round 2)', () => {
    const risky = [
      'This weekend everything in the shop is twenty percent less.',
      'This week the shipping is on us for every single order.',
      'This week every order gets a second candle at no extra cost.',
      'This week it is two for one on all of our winter candles.',
      'All of the old colours are marked down until they are gone.',
      'The winter candles are now a little cheaper while they last.',
      'Every order this week comes with a little gift from us.',
      'This is the last chance to get the winter scents before they go.',
      'It ends tonight, so grab yours before we close the doors.',
      'We are clearing out the old stock to make room for spring.',
      'Will packed every single order this week with a handwritten note.',
      'May chose the colours for the winter shirts this year.',
      'Hope wrote to tell us her candle lasted the whole winter.',
      '(‘The best candle I have ever owned’) is what one reader told me.'
    ]
    for (const line of risky)
      expect(
        founderVoice(
          [
            sample(
              `${line} ${body} We will make more, and we hope you may like them.`
            )
          ],
          own
        )!.examples,
        line
      ).not.toContain(line)
  })

  it('lets the letters decide the greeting and sign-off, and keeps a sign-off written in lower case', () => {
    const letters = [1, 2, 3, 4, 5].map((n) =>
      sample(`Hi,\n${body}\nWarmly,\nMaya`, 3, `MsgL${n}`)
    )
    const coded = [1, 2, 3, 4, 5, 6].map((n) => sample(body, 2, `MsgC${n}`))
    expect(founderVoice([...coded, ...letters])).toMatchObject({
      greeting: 'Hi,',
      signoff: 'Warmly,'
    })
    const lower = founderVoice([
      sample(
        `hi there,\n${body.toLowerCase()}\nsee you soon at the shop\nwarmly,\nmaya`
      )
    ])!
    expect(lower).toMatchObject({ greeting: 'hi there,', signoff: 'warmly,' })
    expect(founderVoice([sample(body)], null as never)).not.toBeNull()
  })

  it('reads hostile text at once', () => {
    const runs = [
      'a' + '🎉'.repeat(29_000) + 'b',
      'a' + '-'.repeat(59_000) + 'b',
      `${'"'.repeat(20_000)}.${'"'.repeat(20_000)}x`,
      `${'Hi [first name] '.repeat(3_000)},`
    ]
    const start = performance.now()
    for (const text of runs) founderVoice([sample(text), sample(body, 2, 'M2')])
    expect(performance.now() - start).toBeLessThan(1_500)
  })
})
