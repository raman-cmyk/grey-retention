import { describe, expect, it } from 'vitest'
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
})
