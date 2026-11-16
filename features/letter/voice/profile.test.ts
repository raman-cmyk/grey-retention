import { describe, expect, it } from 'vitest'
import { voiceExcerpt } from './excerpt'
import { founderVoice, maxVoiceExamples, minVoiceWords } from './profile'
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
  ['Cedar Goods']
)!

describe('founderVoice (PIC-23 part 3a)', () => {
  it('reads the founder’s greeting, sign-off, "I" and sentences from their letter', () => {
    expect(founderVoice([sample(letter.text)])).toEqual({
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

  it('says nothing from designed emails or from too few words', () => {
    const designed = sample(
      'Loved by you\nOur softest overshirt is back, in four colours, for the cold mornings ahead. Shop the overshirt and the rest of the autumn layers today, before the weekend.',
      1
    )
    expect(founderVoice([designed])).toBeNull()
    expect(
      founderVoice([sample('Hi,\nWe made a new candle. Come see.\nBest,')])
    ).toBeNull()
    expect(founderVoice([])).toBeNull()
    expect(minVoiceWords).toBe(40)
  })

  it('reads a team that writes as "we", with the greeting it uses most, "!" and contractions', () => {
    const team = (greeting: string, n: number) =>
      sample(
        `${greeting}\n\nWe're so glad you're here! We've been busy in the studio all week, and we can't wait to show you what we made. It's our favourite batch yet!\n\nWe hope you love it as much as we do.\n\nTalk soon,\nThe team`,
        3,
        `Msg${n}`
      )
    const voice = founderVoice([
      team('Hey friends,', 1),
      team('Hello [first name],', 2),
      team('Hey friends,', 3)
    ])
    expect(voice).toMatchObject({
      greeting: 'Hey friends,',
      signoff: 'Talk soon,',
      writesAs: 'we',
      exclamations: 'often',
      contractions: 'often',
      from: { samples: 3 }
    })
    // The same sentence of three emails is one example.
    expect(new Set(voice!.examples).size).toBe(voice!.examples.length)
  })

  it('reads the letters first, never an example with a number or a placeholder, at most five, and ignores bad input', () => {
    const coded = sample(
      'Our autumn knits are back on the shelves, a little thicker this year.\nFree returns for 30 days on every knit we make for you.\nCome by the shop and say hello to the whole team soon.',
      2,
      'MsgC'
    )
    const long = sample(
      [
        'Hi [first name], it was lovely to see you at the market last week.',
        'The candles you liked are made from the same soy wax as always.',
        'I pour each one by hand in the studio behind our little shop.',
        'They burn slowly and smell like cedar and rain on a warm evening.',
        'I hope one of them finds a place in your home this winter.',
        'I would love to hear which scent you pick for the colder nights.',
        'Write back any time, I read every single message myself.'
      ].join(' '),
      3,
      'MsgL'
    )
    const voice = founderVoice([
      coded,
      null as never,
      { text: 42, weight: 3 } as never,
      long
    ])!
    expect(voice.from.samples).toBe(2)
    expect(voice.examples).toHaveLength(maxVoiceExamples)
    // The letter's sentences come before the coded email's.
    expect(voice.examples[0]).toBe(
      'The candles you liked are made from the same soy wax as always.'
    )
    expect(voice.examples.join(' ')).not.toMatch(/\[|\d/)
    expect(voice.writesAs).toBe('I')
  })

  it('keeps no greeting or sign-off that is a sentence, a number or a link', () => {
    const voice = founderVoice([
      sample(
        'Our new linen arrived this morning, and it is lovely.\nWe pressed every piece by hand before it went on the shelf for you.\nSee it in the shop this week, or write to us with a question about it.\nCall 555,'
      )
    ])!
    expect(voice.greeting).toBeNull()
    expect(voice.signoff).toBeNull()
  })
})
