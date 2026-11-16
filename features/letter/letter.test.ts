// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { sampleBrand } from '@/features/blocks/samples'
import { klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'
import { letterHtmlProblems, letterProblems, replyToProblem } from './checks'
import { letterSchema, wordCount, type Letter } from './letter'
import { plainFooterTags, renderLetter } from './render'

/** TXT-001 (D26): a text email is a short personal letter. */
const words = (n: number) =>
  Array.from({ length: n }, (_, i) => (i % 7 === 6 ? 'evening.' : 'quiet'))
    .join(' ')
    .replace(/^q/, 'Q')
const letter = (over: Partial<Letter> = {}): Letter =>
  letterSchema.parse({
    subject: 'A note about the cedar candle',
    preheader: 'Why we made it, and what it smells like at home.',
    greeting: 'Hi there,',
    body: [
      'We poured the first cedar candle in our kitchen, two winters ago, for the long dark evenings.',
      `It burns slow and clean. ${words(60)}`,
      'If you want one for this week, [the candle is here](1).'
    ],
    signoff: 'Warmly,',
    signature: 'Maya',
    role: 'Founder, Cedar Lane',
    ps: 'Reply and tell me what your evenings smell like. I read every one.',
    links: [{ url: 'https://cedar-lane.example/products/cedar-candle' }],
    ...over
  })
const brand = { ...sampleBrand, name: 'Cedar Lane' }

describe('a text email drawn as a letter (TXT-001)', () => {
  it('draws a person’s email: system font at 16 px, left aligned, no pictures, links in the words, Klaviyo’s footer', () => {
    const { html } = renderLetter(letter(), { brand, mode: 'klaviyo' })
    expect(html).toContain('font-size:16px')
    expect(html).toContain('text-align:left')
    expect(html).toContain(
      "font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI'"
    )
    expect(html).not.toMatch(/<img\b|background|<table/i)
    expect(html).toContain(
      'If you want one for this week, <a href="https://cedar-lane.example/products/cedar-candle">the candle is here</a>.'
    )
    expect(html).toContain(
      '<p style="margin:24px 0 0">Warmly,<br>Maya<br>Founder, Cedar Lane</p>'
    )
    expect(html).toContain('P.S. Reply and tell me')
    for (const tag of Object.values(klaviyoFooterTags))
      expect(html).toContain(tag)
    expect(letterHtmlProblems(html, { logo: false })).toEqual([])
  })

  it('writes a real plain-text part, each link after its words', () => {
    const { text } = renderLetter(letter(), { brand, mode: 'klaviyo' })
    expect(text).toMatch(/^Hi there,\n\nWe poured the first cedar candle/)
    expect(text).toContain(
      'If you want one for this week, the candle is here (https://cedar-lane.example/products/cedar-candle).'
    )
    expect(text).toContain('Warmly,\nMaya\nFounder, Cedar Lane\n\nP.S. Reply')
    expect(text).toContain(
      `--\n${klaviyoFooterTags.organization}, ${klaviyoFooterTags.address}\nUnsubscribe: ${plainFooterTags.unsubscribe}\nPreferences: ${plainFooterTags.preferences}\n`
    )
    expect(text).not.toMatch(/<[a-z]|&amp;|&#/i)
    // Our own preview never shows a raw tag.
    const preview = renderLetter(letter(), { brand }).text
    expect(preview).not.toMatch(/\{\{|\{%/)
    expect(preview).toContain('Cedar Lane, your store address')
  })

  it('keeps the writer’s words words: escaped, never a Klaviyo tag, never a link it was not given', () => {
    const odd = letter({
      body: [
        `<b>Bold</b> & {{ person.email }} {% unsubscribe %}, [a link](1), [no link](3). ${words(80)}`
      ],
      links: [{ url: 'javascript:alert(1)' }]
    })
    const { html, text } = renderLetter(odd, { brand, mode: 'klaviyo' })
    expect(html).toContain(
      '&lt;b&gt;Bold&lt;/b&gt; &amp; &#123;&#123; person.email &#125;&#125;'
    )
    expect(html).toContain(', a link, no link.')
    expect(html).not.toContain('javascript')
    expect(text).toContain(
      '<b>Bold</b> & (( person.email )) (% unsubscribe %), a link, no link.'
    )
    // A store link with a tag in it is sent written out, never read as one.
    const tagged = renderLetter(
      letter({
        links: [{ url: 'https://cedar-lane.example/p?x={{ person.email }}' }]
      }),
      { brand, mode: 'klaviyo' }
    ).text
    expect(tagged).not.toContain('{{ person')
    expect(tagged).toContain('x=%7B%7B')
  })

  it('shows the brand’s small logo only when asked, and a P.S. once', () => {
    const logo = 'https://cdn.cedar-lane.example/logo.png'
    const withLogo = renderLetter(letter({ ps: 'P.S. One more thing.' }), {
      brand: { ...brand, logo },
      mode: 'klaviyo',
      logo: true
    }).html
    expect(withLogo).toContain(
      `<img src="${logo}" alt="Cedar Lane" height="32"`
    )
    expect(withLogo.match(/<img\b/g)).toHaveLength(1)
    expect(withLogo).toContain('P.S. One more thing.')
    expect(withLogo).not.toContain('P.S. P.S.')
    expect(letterHtmlProblems(withLogo, { logo: true })).toEqual([])
    expect(letterHtmlProblems(withLogo, { logo: false })).toEqual([
      'A text email has no pictures: only its small logo at the top.'
    ])
    expect(
      renderLetter(letter(), { brand: { ...brand, logo }, mode: 'klaviyo' })
        .html
    ).not.toContain('<img')
  })
})

describe('the text checks (TXT-001)', () => {
  it('passes a letter of one idea, 80 to 250 words, one or two links', () => {
    const fine = letter()
    const n = [...fine.body, fine.ps!].reduce((s, t) => s + wordCount(t), 0)
    expect(n).toBeGreaterThanOrEqual(80)
    expect(n).toBeLessThanOrEqual(250)
    expect(letterProblems(fine)).toEqual([])
    expect(wordCount('[the candle is here](1), and — more')).toBe(6)
  })

  it('names what is wrong, in plain words', () => {
    const reasons = (over: Partial<Letter>) =>
      letterProblems(letter(over)).map((p) => p.reason)
    expect(reasons({ body: ['Too short.'], ps: undefined })).toEqual([
      'The letter is 2 words; write 80 to 250, about one idea.'
    ])
    expect(reasons({ body: [words(130), words(130)] })).toEqual([
      'The letter is 273 words; write 80 to 250, about one idea.'
    ])
    expect(
      reasons({
        body: [`${words(80)} [one](1), [two](2) and [three](1).`],
        links: [{ url: 'https://a.example/1' }, { url: 'https://a.example/2' }]
      })
    ).toEqual(['The letter has 3 links; use one or two.'])
    expect(reasons({ body: [`${words(80)} [here](2).`] })).toEqual([
      '“here” points to a link that does not exist: use (1).'
    ])
    expect(reasons({ body: [`${words(80)} [here](1).`], links: [] })).toEqual([
      'There is no link to point to: write “here” without one.'
    ])
    for (const text of [
      'Visit cedar-lane.com today.',
      'See https://cedar-lane.example.',
      'Write to maya@cedar-lane.example.',
      'Go to www.cedar-lane.example.'
    ])
      expect(reasons({ body: [`${words(80)} ${text}`] }), text).toEqual([
        'Write no web or email address: put a link on a few words, as [the words](1).'
      ])
    expect(reasons({ signature: 'Maya {{ first_name }}' })).toEqual([
      'Write no { or }: Klaviyo reads them as its own.'
    ])
    expect(
      reasons({ subject: 'Act now', ps: 'Click here, it is urgent.' })
    ).toEqual([
      'Leave out “act now”, “click here”, “urgent”: they read as spam.'
    ])
    expect(
      reasons({ subject: 'x'.repeat(61), preheader: 'Too short' })
    ).toEqual([
      'The subject is 61 characters; at most 60.',
      'The preview line is 9 characters; write 20 to 140.'
    ])
  })

  it('asks for a reply-to inbox someone reads', () => {
    expect(replyToProblem('maya@cedar-lane.example')).toBeNull()
    expect(replyToProblem('hello+news@cedar-lane.example')).toBeNull()
    expect(replyToProblem(null)).toBe(
      'Set an inbox someone reads as the reply-to address: a text email asks people to reply.'
    )
    for (const nobody of [
      'noreply@cedar-lane.example',
      'no-reply@cedar-lane.example',
      'do_not_reply@cedar-lane.example',
      'DoNotReply@cedar-lane.example',
      'bounces+123@cedar-lane.example'
    ])
      expect(replyToProblem(nobody), nobody).toBe(
        `Replies go to ${nobody}, which nobody reads: set an inbox someone reads as the reply-to address.`
      )
    expect(replyToProblem('maya at cedar')).toBe(
      '“maya at cedar” is not an email address: set an inbox someone reads as the reply-to address.'
    )
    // A real name that starts like one is still a real inbox.
    expect(replyToProblem('norepair@cedar-lane.example')).toBeNull()
  })
})
