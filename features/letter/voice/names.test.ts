import { describe, expect, it } from 'vitest'
import { hasName, ownWordsOf, withoutNames } from './names'

/** PIC-23 part 2a: people's names out of a line of the owner's words. */
const clean = (text: string, own: readonly string[] = ['Cedar Goods']) => {
  const ours = ownWordsOf(own)
  return text
    .split('\n')
    .map((line) => withoutNames(line, ours))
    .join('\n')
}

describe('people’s names out of the owner’s words (PIC-23)', () => {
  it('finds a name of two capitalised words or more, in its many shapes', () => {
    const text = clean(
      "Ronald McDonald, Sean O'Brien, Vincent van Gogh, J. Sample, A.J. Rivers, Mrs. Sample, Dr. Rivers, JORDAN SAMPLE, Mary-Kate Olsen and Иван Петров came by.\nBig thanks to Mary Jane Watson Parker for the photos.\nThanks to Jordan S and Priya K. for the photos."
    )
    expect(text).not.toMatch(
      /Ronald|McDonald|O'Brien|Gogh|Sample|Rivers|JORDAN|Olsen|Mary|Иван|Watson|Parker|Jordan|Priya/
    )
    expect(hasName('Thanks to Jordan Sample.', ownWordsOf([]))).toBe(true)
    expect(hasName('Thanks to all of you.', ownWordsOf([]))).toBe(false)
  })

  it('finds a name next to a greeting, a thanks or a heading’s words, and keeps those words', () => {
    const spotlights = [
      'Dear Jordan Sample, thank you for the lovely letter.',
      'Meet Jordan Sample, our customer of the month.',
      'Thanks Jordan Sample for the photo of your dog in the overshirt.',
      'Hi Jordan Sample, your order is ready.',
      'Happy Birthday Jordan Sample from all of us.',
      'Our Winner Jordan Sample gets a year of shirts.',
      'Shoutout To Jordan Sample for the photo.',
      'Jordan Sample And Priya Raman won the giveaway.',
      'Thank You Jordan Sample!',
      'Welcome Jordan Sample to the team.',
      'Photo By Jordan Sample',
      'Made With Love By Jordan Sample',
      'Love From Jordan Sample',
      'With Jordan Sample and the team at the mill.',
      'Team Member Spotlight: Jordan Sample',
      'Top Customer Jordan Sample bought ten shirts.',
      'Happy Mother’s Day Jordan Sample, and thank you.'
    ]
    const named = clean(spotlights.join('\n'))
    expect(named).not.toMatch(/Jordan|Sample|Priya|Raman/)
    for (const kept of [
      'Meet [name], our customer',
      'Happy Birthday [name]',
      'Happy Mother’s Day [name]',
      'Thank You [name]!'
    ])
      expect(named, kept).toContain(kept)
  })

  it('finds first names and surnames that are also words', () => {
    const named = clean(
      'Thanks to Rose Thompson, Hope Davis, Young Kim and Page Turner for the photos.\nRose Marie Sample wrote back.\nThanks to Jordan Little and Sally Field for the photos.'
    )
    expect(named).not.toMatch(
      /Thompson|Davis|Kim|Turner|Marie|Sample|Jordan|Little|Sally|Field/
    )
    expect(named).toContain('Thanks to [name] and [name] for the photos.')
  })

  it('keeps the owner’s Title Case words, headings, holidays, a P.S., a vitamin and a size', () => {
    const holidays = [
      'Anzac Day',
      'Canada Day',
      'Giving Tuesday',
      'Waitangi Day',
      'International Women’s Day',
      'World Mental Health Day',
      'Martin Luther King Jr. Day',
      'Remembrance Sunday',
      'New Year’s Eve',
      'St. Patrick’s Day',
      'Cinco de Mayo',
      'Mardi Gras',
      'Small Business Saturday'
    ].map((h) => `Our ${h} plans are ready, and the studio is busy.`)
    const owner = [
      'Happy Thanksgiving and Merry Christmas to all of you. Thank You for this year.',
      'Last Tuesday we shipped early. This Friday there is Free Shipping on the whole shop.',
      'Our Story: how two friends started with one machine.',
      'Pro Tip: wash it cold and hang it to dry.',
      'P.S. If you have a question, just hit reply and it comes to me.',
      'P.P.S. Remember the studio sale on Sunday afternoon.',
      'U.S. Shipping is free this week on every order.',
      'Take Vitamin D. Then go for a walk in your new overshirt.',
      'SOLD OUT twice, now back for good.',
      'Sneak Peek at the new colours we are testing.',
      'Our Origin Story: how it began in a garage.',
      'Founder Story: why I still sew every shirt.',
      'Self Love Sunday is our quiet day.',
      'Feel Good Friday means a new colour.',
      'Our Vitamin C serum is back in stock.',
      'Size S, Size M and Size L are back.',
      'USB Type C charging, finally.',
      'Plan B is a long walk.',
      ...holidays
    ]
    const text = clean(owner.join('\n'))
    for (const line of owner) expect(text, line).toContain(line)
  })

  it('keeps the store’s own words, spelt either way, and only as whole words', () => {
    const own = [
      'Cedar Goods',
      'Maya’s Overshirt',
      'Cedar Goods Co.',
      'Ruby',
      'Jo',
      'Ella',
      'Lee',
      'Set'
    ]
    const text = clean(
      "Maya's Overshirt is back in three new colours.\nCedar Goods Co. has been making shirts for ten years.\nThis week Ruby Thompson, Joanne Smith, Isabella Ross, Kathleen Ward and Seth Rivers all wrote to us about the Ruby ring.",
      own
    )
    expect(text).toContain("Maya's Overshirt is back")
    expect(text).toContain('Cedar Goods Co. has been')
    expect(text).not.toMatch(/Thompson|Joanne|Isabella|Kathleen|Seth/)
    expect(text).toContain('the Ruby ring')
  })

  it('stays fast: a large catalogue, a run of commas, long groups', () => {
    const start = performance.now()
    const titles = Array.from({ length: 50_000 }, (_, i) =>
      Array.from({ length: 40 }, (_, j) => `w${i}x${j}`).join(' ')
    )
    const catalogue = ownWordsOf(titles)
    expect(catalogue.runs.size).toBeLessThanOrEqual(200_000)
    const ours = ownWordsOf(
      Array.from({ length: 20_000 }, (_, i) => `Product ${i} Deluxe`)
    )
    withoutNames(
      'Jordan Sample and Priya Kumar wrote back. '.repeat(2_000),
      ours
    )
    for (const mark of [',', '.', '-', '’'])
      withoutNames(`${mark.repeat(100_000)}a Jordan Sample`, ours)
    withoutNames('Aa '.repeat(20_000), ownWordsOf(['Aa Aa']))
    expect(performance.now() - start).toBeLessThan(3_000)
  })
})
