import { describe, expect, it } from 'vitest'
import { blueprint, section, text } from './fixtures'
import {
  checkStored,
  failureOf,
  forStorage,
  isBare,
  webAddress
} from './stored'
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

  it('blanks a web address in words as the table would refuse it, and only that', () => {
    const words = (t: string) =>
      blueprint({
        sections: [section({ items: [text({ runs: [{ text: t }] })] })]
      })
    const kept = (t: string) => {
      const bp = forStorage(words(t))
      const part = bp.sections[0]!.items[0]!
      return part.type === 'text' ? part.runs[0]!.text : ''
    }
    expect(kept('Curl (8 oz) and/or 1/2')).toBe('Curl (8 oz) and/or 1/2')
    expect(kept('see url(a.png)')).toBe('see xxx_a.png)')
    expect(kept('Visit https://rival.example now')).toBe(
      'Visit xxxxx___xxxxx_xxxxxxx now'
    )
    // Capitals stay capitals: an all-capitals line is still read as one.
    const caps = kept('SHOP AT HTTPS://RIVAL.EXAMPLE')
    expect(caps).toBe(caps.toUpperCase())
    expect(caps).not.toMatch(/\/\/|url\(/i)
    expect('Curl (8 oz)'.match(webAddress)).toBe(null)
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
  const sourceHtml = `<html><head><title>Rival spring edit</title></head><body><!-- built by Rival studio --><p>Some words for the test</p><img src="https://cdn.rival.example/img/spring-hero.png?w=600" alt="Rival hero" title="Rival flowers"><td background="https://cdn.rival.example/bg/paper-texture.jpg"></td><div style="background:url('https://cdn.rival.example/bg/dots-pattern.png')"></div><p>Now $48.00 or 40% off with RIVAL1234, 1.234 sold</p></body></html>`
  const vocabulary = [
    'Fernhill Tea',
    'Brew a better cup',
    'Shop',
    '$14.00',
    'Email'
  ]
  const clean =
    '<html><head><title>Email</title></head><body><p>Brew a better cup</p><a href="https://fernhill.example/">Shop</a></body></html>'
  const kinds = (
    html: string,
    extra: Partial<Parameters<typeof leaksOf>[0]> = {}
  ) =>
    leaksOf({
      source,
      sourceHtml,
      html,
      sourceNames: ['Rival Store'],
      vocabulary,
      ...extra
    }).map((l) => l.kind)
  it('passes the brand’s own words', () => {
    expect(kinds(clean)).toEqual([])
  })
  it('refuses to run without the original’s HTML', () => {
    expect(() =>
      leaksOf({
        source,
        sourceHtml: '',
        html: clean,
        sourceNames: [],
        vocabulary
      })
    ).toThrow(/needs the original email’s own HTML/)
  })
  it('reads every place an address or a word can hide', () => {
    // The same picture with another query string, or another host.
    expect(
      kinds(
        `${clean}<img src="https://cdn.rival.example/img/spring-hero.png?w=300">`
      )
    ).toContain('picture')
    expect(
      kinds(`${clean}<img src="https://a.klaviyo.example/up/spring-hero.png">`)
    ).toContain('picture')
    expect(
      kinds(
        `${clean}<table background='https://cdn.rival.example/bg/paper-texture.jpg'>`
      )
    ).toContain('picture')
    expect(
      kinds(
        `${clean}<div style="background-image:url(https://cdn.rival.example/bg/dots-pattern.png)">`
      )
    ).toContain('picture')
    expect(
      kinds(`${clean}<img src=https://cdn.rival.example/img/spring-hero.png>`)
    ).toContain('picture')
    expect(
      kinds(clean.replace('<title>Email', '<title>Rival spring edit'))
    ).toContain('phrase')
    expect(kinds(`${clean}<!-- Rival spring edit -->`)).toContain('phrase')
    expect(
      kinds(
        `${clean}<a title="Rival flowers" href="https://fernhill.example/">Shop</a>`
      )
    ).toContain('word')
    expect(kinds(clean, { subject: 'Rival spring edit' })).toContain('phrase')
    expect(kinds(`${clean}<p>Shop $48.00</p>`)).toContain('number')
    expect(kinds(`${clean}<p>Shop 40%</p>`)).toContain('number')
    expect(kinds(`${clean}<p>Shop $14.00</p>`)).toEqual([])
    // Numbers by value: "$48", "48.00" and "48" are the original's $48.00.
    expect(kinds(`${clean}<p>Shop $48</p>`)).toContain('number')
    expect(kinds(`${clean}<p>Shop 48</p>`)).toContain('number')
    expect(kinds(`${clean}<p>Shop 1,234</p>`)).toContain('number')
    // Any page on the original brand's own domain is its link.
    expect(
      leaksOf({
        source,
        sourceHtml,
        html: `${clean}<a href="https://www.rival.example/other">Shop</a>`,
        sourceNames: ['Rival Store', 'rival.example'],
        vocabulary
      }).map((l) => l.kind)
    ).toContain('link')
    // The brand's own page on a network the original also linked to is fine.
    const social = `${sourceHtml}<a href="https://social.example/rival">x</a>`
    expect(
      leaksOf({
        source,
        sourceHtml: social,
        html: `${clean}<a href="https://social.example/fernhill">Shop</a>`,
        sourceNames: ['Rival Store', 'rival.example'],
        vocabulary
      })
    ).toEqual([])
    // <header> is part of the body, never taken for <head>.
    expect(kinds(`${clean}<header>Rival</header>`)).toContain('word')
    expect(kinds(`${clean}<p>Brew&nbsp;a&nbsp;better cup&hellip;</p>`)).toEqual(
      []
    )
  })
  it('finds a source picture, link, name, phrase or word', () => {
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
