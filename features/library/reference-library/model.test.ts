// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { domainShape, trackedDomainOf } from '../inspirations/domain'
import {
  classifyFormat,
  filterLibrary,
  referenceHref,
  tabCounts,
  type LibraryItem
} from './model'

const item = (over: Partial<LibraryItem>): LibraryItem => ({
  id: 'x',
  tab: 'competitors',
  source: 'competitor',
  format: 'text',
  title: 'Spring launch',
  domain: 'northwind.example',
  from: 'Northwind Outdoor',
  at: '2026-11-01T10:00:00Z',
  preview: null,
  text: 'New jackets for the season',
  sample: true,
  ...over
})

describe('reference library model', () => {
  it('tells Email Design from Email Text by images per word', () => {
    const words = (n: number) =>
      Array.from({ length: n }, () => 'word').join(' ')
    expect(classifyFormat(null, 'Hello')).toBe('text')
    expect(classifyFormat('<p>Hello</p>', 'Hello')).toBe('text')
    // An image-rich email the old app tagged TEXT.
    expect(
      classifyFormat('<img src="a"><img src="b"><img src="c">', words(90))
    ).toBe('design')
    expect(classifyFormat('<IMG src="a">', words(61))).toBe('text')
    expect(classifyFormat('<img src="a">', '')).toBe('design')
  })

  it('filters one tab by format, domain and search, newest first', () => {
    const items = [
      item({ id: 'a', at: '2026-11-01T10:00:00Z', format: 'design' }),
      item({
        id: 'b',
        at: '2026-11-03T10:00:00Z',
        domain: 'cedar.example',
        title: 'Café week',
        text: 'Hot drinks'
      }),
      item({ id: 'c', tab: 'yours', source: 'import', domain: null })
    ]
    const query = {
      tab: 'competitors' as const,
      show: 'all' as const,
      search: '',
      domains: []
    }
    expect(filterLibrary(items, query).map((i) => i.id)).toEqual(['b', 'a'])
    expect(
      filterLibrary(items, { ...query, show: 'design' }).map((i) => i.id)
    ).toEqual(['a'])
    expect(
      filterLibrary(items, { ...query, domains: ['cedar.example'] }).map(
        (i) => i.id
      )
    ).toEqual(['b'])
    // Search ignores case and accents and matches every word.
    expect(
      filterLibrary(items, { ...query, search: 'CAFE drinks' }).map((i) => i.id)
    ).toEqual(['b'])
    expect(filterLibrary(items, { ...query, search: 'cafe jackets' })).toEqual(
      []
    )
    expect(
      filterLibrary(items, { ...query, tab: 'yours' }).map((i) => i.id)
    ).toEqual(['c'])
  })

  it('counts every tab, including empty ones', () => {
    expect(
      tabCounts([item({}), item({ id: 'y', tab: 'yours', source: 'import' })])
    ).toEqual({ competitors: 1, yours: 1, best: 0 })
  })

  it('starts a draft from a competitor email or an upload', () => {
    expect(referenceHref({ id: 'e1', source: 'competitor' })).toBe(
      '/first-draft?reference=e1'
    )
    expect(referenceHref({ id: 'i1', source: 'import' })).toBe(
      '/first-draft?imported=i1'
    )
    expect(referenceHref({ id: 't1', source: 'template' })).toBe(
      '/email-library'
    )
  })

  it('reads a domain the way people type it', () => {
    expect(trackedDomainOf(' https://www.Northwind.example/shop?x=1 ')).toBe(
      'northwind.example'
    )
    expect(trackedDomainOf('brand.com.')).toBe('brand.com')
    expect(domainShape.test('brand.com')).toBe(true)
    expect(domainShape.test('owner@brand.com')).toBe(false)
    expect(domainShape.test('brand')).toBe(false)
    expect(domainShape.test('-brand.com')).toBe(false)
  })
})
