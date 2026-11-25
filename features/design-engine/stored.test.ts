import { describe, expect, it } from 'vitest'
import { blueprint } from './fixtures'
import { checkStored, failureOf, forStorage, isBare } from './stored'
import { leaksOf } from './leaks'

describe('stored blueprints', () => {
  it('drop every picture address and link, keep every box', () => {
    const bp = blueprint()
    const bare = forStorage(bp)
    expect(isBare(bp)).toBe(false)
    expect(isBare(bare)).toBe(true)
    expect(JSON.stringify(bare)).not.toMatch(/"(src|href)":"/)
    expect(bare.sections.map((s) => s.height)).toEqual(
      bp.sections.map((s) => s.height)
    )
  })

  it('only a valid blueprint is stored', () => {
    expect(checkStored({ version: 2 })).toEqual({
      ok: false,
      failure: 'not_valid',
      retry: false
    })
    const got = checkStored(blueprint())
    expect(got.ok && isBare(got.blueprint)).toBe(true)
  })

  it('a slow browser is tried again; a limit is final', () => {
    expect(
      failureOf('The email took too long to open in the browser.')
    ).toMatchObject({
      failure: 'timeout',
      retry: true
    })
    expect(
      failureOf('The email is 20000 px tall; at most 16000 can be measured.')
    ).toMatchObject({
      failure: 'too_tall',
      retry: false
    })
    expect(
      failureOf('The email has 40000 parts; at most 30000 can be measured.')
    ).toMatchObject({
      failure: 'too_many_parts',
      retry: false
    })
    expect(failureOf('The email tried to open another page.')).toMatchObject({
      failure: 'navigated'
    })
  })
})

describe('leak check', () => {
  const source = blueprint()
  const vocabulary = ['Fernhill Tea', 'Brew a better cup', 'Shop', '$14.00']
  const clean =
    '<p>Brew a better cup</p><a href="https://fernhill.example/">Shop</a>'
  it('passes the brand’s own words', () => {
    expect(
      leaksOf({ source, html: clean, sourceNames: ['Rival'], vocabulary })
    ).toEqual([])
  })
  it('finds a source picture, link, name, phrase or word', () => {
    const kinds = (html: string) =>
      leaksOf({ source, html, sourceNames: ['Rival Store'], vocabulary }).map(
        (l) => l.kind
      )
    expect(
      kinds(`${clean}<img src="https://example.com/a.png" alt="">`)
    ).toContain('picture')
    expect(
      kinds(`${clean}<a href="https://example.com/shop">Shop</a>`)
    ).toContain('link')
    expect(kinds(`${clean}<p>Rival Store</p>`)).toContain('name')
    expect(kinds(`${clean}<p>Some words for the test</p>`)).toContain('phrase')
    expect(kinds(`${clean}<p>Shop words</p>`)).toEqual(['word'])
    expect(kinds(`${clean}<img src="x" alt="A picture">`)).toContain('word')
  })
})
