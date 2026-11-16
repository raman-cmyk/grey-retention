// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { memoryFallbackLog } from '@/features/fallback/log'
import { buildEmail, type PlannedEmail } from './build'
import { sampleOffers, sampleStoreSource } from './ports'
import { previewRepeat } from './preview-pair'

/** DST-PIC #27: the preview text pairs with the subject, never repeats it. */
const brand = 'Cedar Lane'
const repeats = (subject: string, preview: string) =>
  previewRepeat(subject, preview, brand)

describe('preview text that adds something (DST-PIC #27)', () => {
  it('passes a preview that says what the subject does not', () => {
    expect(
      repeats(
        'A note about our cedar candle',
        'Why we made it, and how it fills a room at night.'
      )
    ).toBeNull()
    expect(
      repeats(
        'Cedar candle restock on Friday',
        'It sold out in May, so we poured twice as many.'
      )
    ).toBeNull()
    // Two of the subject's three words is pairing, not repeating.
    expect(
      repeats('New: the linen throw', 'The linen throw, now in three colours.')
    ).toBeNull()
  })

  it('the same words, whatever the capitals and punctuation', () => {
    expect(repeats('Our winter sale', 'Our winter sale')).toMatch(
      /repeats the subject/
    )
    expect(repeats('Our winter sale', 'our WINTER sale!')).toMatch(
      /repeats the subject/
    )
  })

  it('the whole subject inside the preview, or the preview inside the subject', () => {
    expect(
      repeats(
        'The cedar candle is back',
        'The cedar candle is back, in small batches.'
      )
    ).toMatch(/repeats the whole subject/)
    expect(
      repeats('Cedar candle', 'Cedar candle: sixty hours of slow, quiet burn.')
    ).toMatch(/repeats the whole subject/)
    expect(
      repeats(
        'The linen throw is back in three new colours',
        'The linen throw is back'
      )
    ).toMatch(/only repeats part of the subject/)
    // Words that say nothing alone are not a repeat ("for you").
    expect(repeats('For you', 'Something made for you, by hand.')).toBeNull()
  })

  it('three of every four of the subject’s words, a plural as its word', () => {
    expect(
      repeats(
        'Cedar candle, now in linen white',
        'Linen white cedar candles for long evenings.'
      )
    ).toMatch(/says the subject again \(4 of its 4 words\).*one of them only/)
    expect(
      repeats(
        'Fresh cedar candles this Friday',
        'Fresh cedar candle for your Friday evenings.'
      )
    ).toMatch(/4 of its 4 words/)
    expect(
      repeats(
        'Fresh cedar candles this Friday morning',
        'Fresh cedar candle for your evenings.'
      )
    ).toBeNull()
  })

  it('the brand’s name in both lines repeats nothing: it is the sender', () => {
    expect(
      repeats('A note from Cedar Lane', 'Cedar Lane’s winter candles are here.')
    ).toBeNull()
    expect(
      repeats('Cedar Lane', 'Cedar Lane, written to you directly.')
    ).toBeNull()
    expect(previewRepeat('Cedar Lane', 'Cedar Lane')).toMatch(
      /repeats the subject/
    )
  })

  it('the fixed lines of the plain copy and the plain letter pass', () => {
    const preview = `A short note from ${brand}.`
    for (const subject of [
      `Cedar candle from ${brand}`,
      'Cedar candle',
      `More from ${brand}`,
      `A note from ${brand}`,
      `This week at ${brand}`,
      `Inside ${brand}`,
      `From the ${brand} shop`,
      `${brand} this Tuesday`,
      `A Tuesday note from ${brand}`,
      `${brand}: Cedar candle`
    ])
      expect(repeats(subject, preview), subject).toBeNull()
    const letter = `Written to you directly, from all of us at ${brand}.`
    for (const subject of [
      'A short note about the Cedar candle',
      `A short note from ${brand}`,
      `A note from all of us at ${brand}`,
      'A short note from us',
      'Something we wanted to share'
    ])
      expect(repeats(subject, letter), subject).toBeNull()
  })

  it('reads the brand’s name as words: never inside a word, a possessive, any spacing', () => {
    // A short name is never cut out of other words ("an" in "and").
    expect(
      previewRepeat(
        'Candles and lanterns',
        'Lanterns and candles for the long winter nights',
        'An'
      )
    ).toBeNull()
    expect(
      repeats('Cedar Lane’s cosy throws', 'Cedar Lane’s throws, in cosy wool')
    ).toBeNull()
    expect(
      previewRepeat(
        'News from Blue Ridge\u00a0Candle Co',
        'A short note from Blue Ridge Candle Co.',
        'Blue Ridge\u00a0Candle Co'
      )
    ).toBeNull()
    // A name the builder cut at its limit, mid-word.
    const long =
      'The Very Long Name of the Old Cedar Lane Candle and Soap Company'
    expect(
      previewRepeat(
        `News from ${long}`,
        `A short note from ${long.slice(0, 60)}.`,
        long
      )
    ).toBeNull()
  })

  it('reads a word with its marks, and one apostrophe as the other', () => {
    expect(
      previewRepeat(
        'नई मोमबत्ती',
        'सर्दियों के लिए हाथ से बनी मोमबत्ती तैयार है'
      )
    ).toBeNull()
    expect(
      previewRepeat(
        "Don't miss the candles",
        'Don’t miss the candles: three new scents'
      )
    ).toMatch(/repeats the whole subject/)
    // A subject that is only the name, and the same again with a full stop.
    expect(
      previewRepeat(
        'Cedar Lane Candle Company',
        'Cedar Lane Candle Company.',
        'Cedar Lane Candle Company'
      )
    ).toMatch(/repeats the subject/)
  })
})

/** The builders' own lines, for names a store can have (DST-PIC #27). */
const tenantId = '00000000-0000-4000-8000-000000000101'
const inDays = (n: number) => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const planned: PlannedEmail = {
  date: inDays(2),
  time: '10:00',
  emailType: 'launch',
  angle: 'Meet the linen throw',
  products: [{ id: 'p-linen-throw', title: 'Linen throw' }],
  offer: null,
  audience: { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
}
const oddNames = [
  'Blue Ridge\u00a0Candle Co',
  'Night & Day  Tea Co.',
  'Old Cedar\tLane Candles',
  'Old\u200bCedar Lane Candle',
  'The Very Long Name of the Old Cedar Lane Candle and Soap Company Limited',
  'Old Cedar  Lane Candle Soap Works',
  'An',
  'Cedar Lane’s'
]

describe('the plain copy and the plain letter pass, whatever the name (DST-PIC #27)', () => {
  it.each(oddNames)(
    '%j: every subject the plain copy and the plain letter can use',
    async (name) => {
      const read = await sampleStoreSource.read(tenantId)
      const store = { ...read, brand: { ...read.brand, name } }
      for (const slot of [
        ...(['launch', 'story', 'bestseller'] as const).map((emailType) => ({
          ...planned,
          emailType
        })),
        { ...planned, format: 'text' as const }
      ]) {
        // Each subject taken in turn, until none is left: never a copy failure.
        const taken: string[] = []
        for (;;) {
          const fallbacks = memoryFallbackLog()
          const made = await buildEmail(
            { planned: slot, store, offers: sampleOffers, taken },
            { tenantId, callerKey: 'email-build:b1', fallbacks }
          )
          if (!made.ok) {
            expect(made.code, `${slot.emailType} ${slot.format ?? ''}`).toBe(
              'subject_taken'
            )
            break
          }
          expect(
            previewRepeat(made.email.subject, made.email.preheader, name)
          ).toBeNull()
          taken.push(made.email.subject)
          expect(taken.length).toBeLessThan(20)
        }
        expect(taken.length).toBeGreaterThan(0)
      }
    }
  )
})
