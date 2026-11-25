// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { klaviyoFooterTags } from '@/features/blocks/klaviyo-tags'
import { klaviyoCode, leaksOf, readEmail, withoutOwnTags } from './leaks'

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

  it('reads a named character it has no table entry for as a sign, never a word', () => {
    expect(leaks('<p>Tea picked this spring &rarr; &hearts;</p>')).toEqual([])
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
