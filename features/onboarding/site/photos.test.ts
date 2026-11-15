import { describe, expect, it } from 'vitest'
import { maxPhotosPerPage, sitePhotos } from './photos'

const page = 'https://cedarlane.com/products/trail-socks'
const cdn = 'https://cdn.shopify.com/s/files/1'

describe('sitePhotos (ONB-059a)', () => {
  it('finds a product page’s photos, surest first, each tagged as a product photo', () => {
    const html = `<html><head>
      <meta property="og:image" content="${cdn}/socks-share.jpg">
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Product',
            name: 'Trail socks',
            image: [
              `${cdn}/socks-front.jpg`,
              { '@type': 'ImageObject', url: `${cdn}/socks-back.png` }
            ]
          }
        ]
      })}</script></head><body>
      <main><img src="${cdn}/socks-side.jpg?v=12&width=800" alt=" Trail socks,
        side "><img src="${cdn}/socks-front_400x.jpg" alt="Front"></main></body></html>`
    expect(sitePhotos(html, page, 'product')).toEqual([
      {
        url: `${cdn}/socks-front.jpg`,
        alt: null,
        kind: 'product',
        page: 'product',
        from: 'schema'
      },
      {
        url: `${cdn}/socks-back.png`,
        alt: null,
        kind: 'product',
        page: 'product',
        from: 'schema'
      },
      {
        url: `${cdn}/socks-share.jpg`,
        alt: null,
        kind: 'product',
        page: 'product',
        from: 'share'
      },
      {
        url: `${cdn}/socks-side.jpg?v=12&width=800`,
        alt: 'Trail socks, side',
        kind: 'product',
        page: 'product',
        from: 'page'
      }
    ])
  })

  it('tags the brand’s world as lifestyle, and a picture linking to a product as a product photo', () => {
    const html = `<body><main>
      <section class="hero"><img src="/files/runners-at-dawn.jpg" alt="Runners at dawn"></section>
      <a href="/products/trail-socks"><img data-src="${cdn}/socks-card.jpg" alt="Trail socks"></a>
      <picture><source srcset="${cdn}/team-small.jpg 400w, ${cdn}/team-big.jpg 1600w"><img src="${cdn}/team-small.jpg" alt="Our team"></picture>
    </main></body>`
    expect(
      sitePhotos(html, 'https://cedarlane.com/', 'home').map((p) => [
        p.url,
        p.kind,
        p.page
      ])
    ).toEqual([
      ['https://cedarlane.com/files/runners-at-dawn.jpg', 'lifestyle', 'home'],
      [`${cdn}/socks-card.jpg`, 'product', 'home'],
      [`${cdn}/team-big.jpg`, 'lifestyle', 'home'],
      [`${cdn}/team-small.jpg`, 'lifestyle', 'home']
    ])
  })

  it('never takes a logo, an icon, a badge, another brand’s logo or a picture of the header, menu or footer', () => {
    const html = `<body>
      <header><a href="/"><img src="${cdn}/cedar-lane.png" alt="Cedar Lane"></a></header>
      <nav><img src="${cdn}/menu-shoes.jpg"></nav>
      <main>
        <img src="${cdn}/cedar-lane-logo.png" alt="Cedar Lane logo">
        <img src="${cdn}/truck-icon.png">
        <img src="${cdn}/review-stars.png" alt="5 stars">
        <img src="${cdn}/hero.jpg" width="80" height="80">
        <div class="press-logos"><img src="${cdn}/vogue.jpg" alt="Vogue"></div>
        <ul class="payment-icons"><li><img src="${cdn}/visa.png"></li></ul>
        <img src="${cdn}/keep.jpg" alt="A runner" width="1200" height="800">
      </main>
      <footer><img src="${cdn}/footer-trail.jpg"></footer></body>`
    expect(
      sitePhotos(html, 'https://cedarlane.com/', 'home', {
        brand: 'Cedar Lane'
      }).map((p) => p.url)
    ).toEqual([`${cdn}/keep.jpg`])
  })

  it('keeps only photos an email can show, once each', () => {
    const html = `<body><main>
      ${[
        `${cdn}/a.svg`,
        `${cdn}/b.webp?v=2`,
        `${cdn}/c.gif`,
        'data:image/png;base64,AAAA',
        `https://cdn.shopify.com:8443/d.jpg`,
        `https://user:pw@cdn.shopify.com/e.jpg`,
        `ftp://cdn.shopify.com/f.jpg`,
        `${cdn}/${'x'.repeat(1_000)}.jpg`,
        // http on an https page is read as https.
        'http://cdn.shopify.com/s/files/1/g.jpg',
        `${cdn}/g.jpg?width=400`
      ]
        .map((src) => `<img src="${src}">`)
        .join('')}
    </main></body>`
    expect(
      sitePhotos(html, 'https://cedarlane.com/', 'about').map((p) => p.url)
    ).toEqual([`${cdn}/g.jpg`])
  })

  it(`keeps at most ${maxPhotosPerPage} per page, and nothing from a page it cannot place`, () => {
    const html = `<body><main>${Array.from(
      { length: 50 },
      (_, i) => `<img src="${cdn}/photo-${i}.jpg">`
    ).join('')}</main></body>`
    const got = sitePhotos(html, 'https://cedarlane.com/', 'home')
    expect(got).toHaveLength(maxPhotosPerPage)
    expect(got[0]!.url).toBe(`${cdn}/photo-0.jpg`)
    expect(sitePhotos(html, 'not a page', 'home')).toEqual([])
    expect(
      sitePhotos(
        '<script type="application/ld+json">{not json</script><img src="/x.jpg">',
        'https://cedarlane.com/',
        'home'
      ).map((p) => p.url)
    ).toEqual(['https://cedarlane.com/x.jpg'])
  })
})
