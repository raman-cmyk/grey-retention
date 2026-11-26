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
    ['a soft hyphen by name', '<p>Ac&shy;me</p>', '&shy;'],
    ['a zero-width joiner by name', '<p>Ac&zwj;me</p>', '&zwj;'],
    ['a zero-width non-joiner by name', '<p>Ac&zwnj;me</p>', '&zwnj;'],
    ['a zero-width space by number', '<p>Ac&#8203;me</p>', '&#8203;'],
    ['a soft hyphen by hex number', '<p>Ac&#xAD;me</p>', '&#xAD;'],
    ['a byte-order mark by hex number', '<p>Ac&#xfeff;me</p>', '&#xfeff;'],
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

  it('lets the characters the engine writes through', () => {
    const footer = Object.values(klaviyoFooterTags).join(' ')
    expect(
      hiddenMarks(
        `<p>Tea &amp; cakes &lt;3&gt; &quot;hi&quot; &nbsp;&middot;&rarr; &copy; &#169; &#x2014; ${footer}</p>`
      )
    ).toEqual([])
  })
})
