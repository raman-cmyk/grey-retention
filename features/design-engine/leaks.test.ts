// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'
import {
  hiddenMarks,
  klaviyoCode,
  leaksOf,
  readEmail,
  withoutOwnTags
} from './leaks'

/**
 * DES-ENGINE-002b2: Klaviyo's own footer tags are code, not words; any
 * other template code in a copy is a leak (it could print anything).
 */
const source =
  '<table><tr><td><p>Acme Deals: the summer edit is here</p></td></tr></table>'
const vocabulary = [
  'Fernhill Tea',
  'Tea picked this spring',
  'Unsubscribe',
  'Preferences',
  'View in browser'
]
const leaks = (html: string) =>
  leaksOf({
    sourceHtml: source,
    html,
    sourceNames: ['Acme Deals', 'acme.com'],
    vocabulary
  })

describe('Klaviyo tags in the leak check (DES-ENGINE-002b2)', () => {
  it('reads only the labels of the engine’s own footer tags', () => {
    const footer = Object.values(klaviyoFooterTags).join(' ')
    expect(withoutOwnTags(footer)).not.toMatch(/\{\{|\{%/)
    expect(readEmail(`<p>${footer}</p>`).texts.join(' ')).toContain(
      'View in browser'
    )
    expect(readEmail(`<p>${footer}</p>`).texts.join(' ')).not.toContain(
      'organization'
    )
    expect(klaviyoCode(`<p>${footer}</p>`)).toEqual([])
    expect(leaks(`<p>Tea picked this spring</p><p>${footer}</p>`)).toEqual([])
  })

  it('reads the library blocks’ own arrow as a sign, never a word', () => {
    expect(leaks('<p>Tea picked this spring &rarr; &amp; &nbsp;</p>')).toEqual(
      []
    )
  })

  it.each([
    '<p>{{ "Acme Deals" }}</p>',
    '<p>{% with x="Acme Deals" %}{{ x }}{% endwith %}</p>',
    `<img src="{{ 'https://acme.com/a.jpg' }}" alt="Tea picked this spring">`,
    '<p>{{ first_name|default:"Acme friend" }}</p>',
    '<p>{% unsubscribe "Acme Deals" %}</p>',
    '<p>{{organization.name}}</p>'
  ])('any other template code is a leak: %s', (html) => {
    expect(
      leaks(html).some((l) => l.kind === 'word' && /\{[{%]/.test(l.value))
    ).toBe(true)
  })
})

describe('hidden marks in a copy (DES-ENGINE-003)', () => {
  it.each([
    ['an unknown named character inside a word', '<p>Ac&zz;me</p>', '&zz;'],
    [
      'a named character the engine never writes',
      '<p>Tea &hearts;</p>',
      '&hearts;'
    ],
    ['a zero-width space', '<p>Ac\u200Bme</p>', 'U+200B'],
    ['a zero-width non-joiner', '<p>Ac\u200Cme</p>', 'U+200C'],
    ['a zero-width joiner', '<p>Ac\u200Dme</p>', 'U+200D'],
    ['a word joiner', '<p>Ac\u2060me</p>', 'U+2060'],
    ['a byte-order mark', '<p>Ac\uFEFFme</p>', 'U+FEFF'],
    ['a soft hyphen', '<p>Ac\u00ADme</p>', 'U+00AD'],
    ['a soft hyphen by name', '<p>Ac&shy;me</p>', 'U+00AD'],
    ['a zero-width joiner by name', '<p>Ac&zwj;me</p>', 'U+200D'],
    ['a zero-width non-joiner by name', '<p>Ac&zwnj;me</p>', 'U+200C'],
    ['a zero-width space by number', '<p>Ac&#8203;me</p>', 'U+200B'],
    ['a soft hyphen by hex number', '<p>Ac&#xAD;me</p>', 'U+00AD'],
    ['a byte-order mark by hex number', '<p>Ac&#xfeff;me</p>', 'U+FEFF'],
    ['a number with leading zeros', '<p>Ac&#00008203;me</p>', 'U+200B'],
    ['a hex number with leading zeros', '<p>Ac&#x000200B;me</p>', 'U+200B'],
    ['a number without its semicolon', '<p>Ac&#8203me</p>', 'U+200B'],
    [
      'a soft hyphen by name without its semicolon',
      '<p>Ac&shyme</p>',
      'U+00AD'
    ],
    ['a direction mark', '<p>Ac\u200Eme</p>', 'U+200E'],
    ['a combining grapheme joiner', '<p>Ac\u034Fme</p>', 'U+034F'],
    ['an object’s own name', '<p>Ac&constructor;me</p>', '&constructor;'],
    [
      'one in an alt text',
      '<img alt="Ac\u200Bme" src="https://fernhill.example/a.png">',
      'U+200B'
    ]
  ])('flags %s', (_, html, mark) => {
    expect(hiddenMarks(html)).toContain(mark)
    expect(leaks(`<p>Tea picked this spring</p>${html}`)).toContainEqual({
      kind: 'hidden',
      value: mark
    })
  })

  it('reads a word an invisible character splits whole, in the copy and the source', () => {
    // The word check sees "acme" (not "ac" and "me") as well.
    expect(leaks('<p>Tea picked this spring Ac\u200Bme</p>')).toContainEqual({
      kind: 'word',
      value: 'acme'
    })
    expect(
      leaksOf({
        sourceHtml: '<p>Ac&shy;me Deals: new</p>',
        html: '<p>Acme Deals</p>',
        sourceNames: ['Acme Deals'],
        vocabulary: ['Acme Deals']
      })
    ).toContainEqual({ kind: 'name', value: 'Acme Deals' })
  })

  it('never flags an emoji’s own joiner, nor the brand’s own word with a soft hyphen', () => {
    expect(
      hiddenMarks('<p>Pride week 🏳️\u200D🌈 and 👩\u200D👩\u200D👧</p>')
    ).toEqual([])
    const brandWord = 'Sommer\u00ADschluss'
    expect(
      leaksOf({
        sourceHtml: source,
        html: `<p>Tea picked this spring ${brandWord}</p>`,
        sourceNames: ['Acme Deals'],
        vocabulary: [...vocabulary, brandWord]
      })
    ).toEqual([])
  })

  it('reads an object’s own name as a space, never as its code', () => {
    expect(readEmail('<p>Ac&constructor;me</p>').texts.join(' ')).not.toMatch(
      /function|native/
    )
  })

  it.each([
    ['a text variation selector', '<p>Fern\uFE0Ehill Deals</p>', 'U+FE0E'],
    [
      'a supplementary variation selector',
      '<p>Fern\u{E0100}hill</p>',
      'U+E0100'
    ],
    ['a Mongolian free variation selector', '<p>Fern\u180Bhill</p>', 'U+180B'],
    ['a zero-width space by name', '<p>Ac&zwsp;me</p>', 'U+200B'],
    ['a word joiner by name', '<p>Ac&nobreak;me</p>', 'U+2060'],
    ['a direction mark by name', '<p>Ac&lrm;me</p>', 'U+200E']
  ])('flags %s that splits a word', (_, html, mark) => {
    expect(hiddenMarks(html)).toEqual([mark])
  })

  it('catches a name split by a variation selector', () => {
    expect(
      leaksOf({
        sourceHtml: '<p>Fernhill Deals: new</p>',
        html: '<p>Tea picked this spring Fern\uFE0Ehill Deals</p>',
        sourceNames: ['Fernhill Deals'],
        vocabulary
      })
    ).toContainEqual({ kind: 'name', value: 'Fernhill Deals' })
  })

  it('judges the invisible ones by name as the characters: the brand’s own word passes', () => {
    expect(
      hiddenMarks('<p>Sommer&shy;schluss</p>', new Set(['sommerschluss']))
    ).toEqual([])
    expect(hiddenMarks('<p>Sommer&shy;schluss</p>')).toEqual(['U+00AD'])
    // An apostrophe is part of the word, as in the word check.
    expect(
      hiddenMarks("<p>Ma\u00ADry's shop</p>", new Set(["mary's"]))
    ).toEqual([])
  })

  it('lets the blocks’ own preheader padding through', () => {
    expect(
      hiddenMarks(
        `<div>New this week${'&#847;&zwnj;&nbsp;'.repeat(40)}</div><p>Hello</p>`
      )
    ).toEqual([])
  })

  it('lets the characters the engine writes through', () => {
    const footer = Object.values(klaviyoFooterTags).join(' ')
    expect(
      hiddenMarks(
        `<p>Tea &amp; cakes &lt;3&gt; &quot;hi&quot; &nbsp;&middot;&rarr; &copy; &#169; &#x2014; ${footer}</p>`
      )
    ).toEqual([])
  })
})
