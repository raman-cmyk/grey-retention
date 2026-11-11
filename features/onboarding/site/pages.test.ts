// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { maxPages, pagesToRead, readPage } from './pages'
import { samplePage } from './sample'

const home = () =>
  readPage(
    samplePage('cedar-lane.example', '/')!,
    'https://cedar-lane.example/',
    'home'
  )

describe('readPage', () => {
  it('keeps the words a visitor reads, never scripts, styles or hidden parts', () => {
    const page = home()
    expect(page).toMatchObject({
      title: 'Cedar Lane — Everyday layers',
      description:
        'Everyday layers made to last. A fictional brand for testing.',
      language: 'en'
    })
    expect(page.text.split('\n')).toEqual(
      expect.arrayContaining([
        'Everyday layers for quiet weekends',
        'Free shipping on orders over $75.'
      ])
    )
    expect(page.text).not.toMatch(/window\.track|\.hidden|Hidden preview/)
    expect(page.links.map((l) => l.href)).toContain('/pages/shipping')
  })

  it('reads the language from the page and folds what is too long', () => {
    const page = readPage(
      `<html lang="fr-FR"><body><p>${'mot '.repeat(5_000)}</p></body></html>`,
      'https://x.example/',
      'home'
    )
    expect(page.language).toBe('fr')
    expect(page.text.length).toBeLessThanOrEqual(12_000)
  })
})

describe('pagesToRead', () => {
  it("finds the shipping, returns, help, story and up to two product pages from the home page's links", () => {
    expect(pagesToRead(home(), 'cedar-lane.example')).toEqual([
      { url: 'https://cedar-lane.example/pages/shipping', kind: 'shipping' },
      { url: 'https://cedar-lane.example/pages/returns', kind: 'returns' },
      { url: 'https://cedar-lane.example/pages/faq', kind: 'faq' },
      { url: 'https://cedar-lane.example/pages/about', kind: 'about' },
      {
        url: 'https://cedar-lane.example/products/field-overshirt',
        kind: 'product'
      },
      {
        url: 'https://cedar-lane.example/products/weekend-knit',
        kind: 'product'
      }
    ])
  })

  it("only follows https links on the brand's own host, each once, and stops at the page limit", () => {
    const page = readPage(
      '<a href="http://shop.example/pages/shipping">x</a>' +
        '<a href="https://other.example/pages/returns">Returns</a>' +
        '<a href="mailto:a@shop.example">Contact</a>' +
        '<a href="https://www.shop.example/pages/faq#top">Help</a>' +
        '<a href="https://shop.example/pages/faq">Help again</a>' +
        Array.from(
          { length: 6 },
          (_, i) => `<a href="/products/p${i}">P${i}</a>`
        ).join(''),
      'https://shop.example/',
      'home'
    )
    const pages = pagesToRead(page, 'shop.example')
    expect(pages.map((p) => p.url)).toEqual([
      'https://www.shop.example/pages/faq',
      'https://shop.example/products/p0',
      'https://shop.example/products/p1'
    ])
    expect(pages.length).toBeLessThan(maxPages)
  })
})
