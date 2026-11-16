// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'
import { BlockRenderError } from '@/features/blocks/render'
import { sampleBrand } from '@/features/blocks/samples'
import { letterHtmlProblems, letterProblems, replyToProblem } from './checks'
import { letterSchema, wordCount, type Letter } from './letter'
import { footerGrey, plainFooterTags, renderLetter } from './render'

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
    // Outlook on Windows: a font it has; the footer's grey reads on white.
    expect(html).toContain(
      "<!--[if mso]><style>body,div,p{font-family:'Segoe UI',Arial,sans-serif !important}</style><![endif]-->"
    )
    expect(html).toContain(`color:${footerGrey}`)
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
      `-- \n${klaviyoFooterTags.organization}, ${klaviyoFooterTags.address}\nUnsubscribe: ${plainFooterTags.unsubscribe}\nPreferences: ${plainFooterTags.preferences}\n`
    )
    expect(text).not.toMatch(/<[a-z]|&amp;|&#/i)
    // Our own preview never shows a raw tag.
    const preview = renderLetter(letter(), { brand, mode: 'preview' }).text
    expect(preview).not.toMatch(/\{\{|\{%/)
    expect(preview).toContain('Cedar Lane, your store address')
    expect(renderLetter(letter(), { brand, mode: 'preview' }).html).not.toMatch(
      /\{\{|\{%/
    )
  })

  it('draws links only in the paragraphs and the P.S., and never on empty words', () => {
    const odd = letter({
      greeting: 'Hi [there](1),',
      body: [`${words(80)} [ ](1) and [the candle](1).`]
    })
    const { html, text } = renderLetter(odd, { brand, mode: 'klaviyo' })
    expect(html).toContain('<p style="margin:0 0 16px">Hi [there](1),</p>')
    expect(html.match(/<a href="https:\/\/cedar/g)).toHaveLength(1)
    expect(text).toMatch(/^Hi \[there\]\(1\),\n/)
    expect(text).toContain(
      'and the candle (https://cedar-lane.example/products/cedar-candle).'
    )
    expect(text).not.toContain('  (https')
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
    expect(
      renderLetter(letter({ ps: 'P.P.S. And one more.' }), {
        brand,
        mode: 'klaviyo'
      }).text
    ).toContain('\n\nP.S. And one more.\n')
    const own = (ps: string) =>
      renderLetter(letter({ ps }), { brand, mode: 'klaviyo' })
    expect(own('Ps and qs matter.').text).toContain(
      '\n\nP.S. Ps and qs matter.\n'
    )
    expect(own('PS: a note.').text).toContain('\n\nP.S. a note.\n')
    expect(own('P.S.').text).not.toContain('P.S.')
    expect(own('P.S.').html).not.toContain('P.S.')
    // A tab is a space in both parts.
    expect(
      renderLetter(letter({ body: [`Tab\there. ${words(80)}`] }), {
        brand,
        mode: 'klaviyo'
      }).text
    ).toContain('Tab here.')
    // Klaviyo mode sends only pictures uploaded to Klaviyo.
    expect(() =>
      renderLetter(letter(), {
        brand: { ...brand, logo: 'data:image/png;base64,iVBORw0KGgo=' },
        mode: 'klaviyo',
        logo: true
      })
    ).toThrow(BlockRenderError)
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
      expect(reasons({ body: [`${words(80)} ${text}`] })[0], text).toMatch(
        /” is a web or email address: never write one, put a link on a few words, as \[the words\]\(1\)\.$/
      )
    expect(reasons({ greeting: 'Hi {{ first_name }},' })).toEqual([
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
    expect(
      reasons({
        subject: 'A note \u202e about LOVE',
        preheader: 'Why we made it <b>, and how.'
      })
    ).toEqual([
      'Write the subject in plain words, without { } < > signs or hidden characters.',
      'Write the subject normally: no word in capitals, at most one exclamation mark.',
      'Write the preview line in plain words, without { } < > signs or hidden characters.'
    ])
  })

  it('names a link mark that is broken or outside the paragraphs, and a link on no words', () => {
    const rules = (over: Partial<Letter>) =>
      letterProblems(letter(over)).map((p) => p.rule)
    for (const broken of [
      '[the candle](1 )',
      '[a] (1)',
      '[a [b] c](1)',
      '[the\ncandle](1)',
      '[a](123)',
      `[${'x'.repeat(121)}](1)`,
      '\\[a\\](1)'
    ])
      expect(rules({ body: [`${words(80)} ${broken}`] }), broken).toEqual([
        'broken_link'
      ])
    expect(rules({ greeting: 'Hi [there](1),' })).toEqual([
      'link_outside_letter'
    ])
    expect(rules({ signoff: 'See [you](2)' })).toEqual(['link_outside_letter'])
    expect(rules({ body: [`${words(80)} [ ](1)`] })).toEqual(['empty_link'])
    expect(rules({ body: [`${words(80)} [0](0)`] })).toEqual(['unknown_link'])
    // Prose with brackets is prose.
    expect(rules({ body: [`${words(80)} The [sic] (really) word.`] })).toEqual(
      []
    )
    // No link at all is fine: a quick question asks only for a reply.
    expect(rules({ body: [words(90)] })).toEqual([])
    expect(
      letterProblems(
        letter({ body: [`${words(80)} [here](3) and [here](3)`] })
      ).map((p) => p.reason)
    ).toEqual(['“here” points to a link that does not exist: use (1).'])
  })

  it('checks the name that signs like every other part, unless it is the store’s', () => {
    const rules = (over: Partial<Letter>, own: string[] = []) =>
      letterProblems(letter(over), own).map((p) => p.rule)
    expect(rules({ signature: '[Maya](1)' })).toEqual(['link_outside_letter'])
    expect(rules({ signature: 'Maya {{ first_name }}' })).toEqual([
      'template_marks'
    ])
    expect(rules({ role: 'Founder, hello@cedar-lane.example' })).toEqual([
      'address_in_text'
    ])
    expect(rules({ role: 'Founder, act now' })).toEqual(['spam_words'])
    expect(rules({ signature: 'Maya \u202e' })).toEqual(['hidden_characters'])
    // A Windows line ending is a line ending.
    expect(rules({ body: [`${words(80)}\r\nNext line.`] })).toEqual([])
    // The store's own founder, as the caller gives it.
    expect(
      rules({ role: 'Founder, Ritual.co' }, ['Founder, Ritual.co'])
    ).toEqual([])
    // A P.S. that is only its mark.
    expect(rules({ ps: 'P.S.' })).toEqual(['empty_ps'])
  })

  it('never asks the writer to change the store’s own words', () => {
    const own = ['Ritual.co', 'Winner Candles']
    const fine = letter({
      role: 'Founder, Ritual.co',
      body: [`${words(80)} The Winner Candles range is back.`]
    })
    expect(letterProblems(fine, own)).toEqual([])
    // Without them, and no role that names it: the address and the spam
    // word are the writer's.
    expect(
      letterProblems({
        ...fine,
        role: undefined,
        body: [`${words(80)} Ritual.co and Winner Candles.`]
      }).map((p) => p.rule)
    ).toEqual(['address_in_text', 'spam_words'])
    for (const site of ['cedarlane.ca', 'cedarlane.nz', 'cedarlane.de'])
      expect(
        letterProblems(letter({ body: [`${words(80)} See ${site}.`] })).map(
          (p) => p.rule
        ),
        site
      ).toEqual(['address_in_text'])
    // Prose that only looks like an address.
    expect(
      letterProblems(
        letter({
          body: [
            `${words(80)} Cedar Lane Co. and its co-founder, e.g. in the U.K., at 9 a.m., version 2.0.`
          ]
        })
      )
    ).toEqual([])
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
    for (const nobody of [
      'store-noreply@cedar-lane.example',
      'orders-no-reply@cedar-lane.example',
      'noreply1@cedar-lane.example',
      'noreplies@cedar-lane.example',
      'donotrespond@cedar-lane.example',
      'dont-reply@cedar-lane.example',
      'maya@noreply.cedar-lane.example'
    ])
      expect(replyToProblem(nobody), nobody).toMatch(/which nobody reads/)
    for (const odd of [
      '<maya@cedar-lane.example>',
      'maya@cedar-lane.example,',
      'a@b..c',
      'a@.b.c',
      '.maya@cedar-lane.example'
    ])
      expect(replyToProblem(odd), odd).toMatch(/is not an email address/)
    // A real name that starts like one is still a real inbox, and a brand
    // called Bounce is a brand.
    for (const real of [
      'norepair@cedar-lane.example',
      "o'neill@cedar-lane.example",
      'maya@bounce.example',
      'info@postmaster.example',
      'bounce.house@cedar-lane.example'
    ])
      expect(replyToProblem(real), real).toBeNull()
    for (const system of [
      'postmaster@cedar-lane.example',
      'mailer-daemon@cedar-lane.example'
    ])
      expect(replyToProblem(system), system).toMatch(/which nobody reads/)
  })
})
