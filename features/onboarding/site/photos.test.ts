import { describe, expect, it } from 'vitest'
import { emailPhotoUrl, maxPhotosPerPage, sitePhotos } from './photos'

const product = 'https://cedarlane.com/products/trail-socks'
const home = 'https://cedarlane.com/'
const cdn = 'https://cdn.shopify.com/s/files/1'
const urls = (
  html: string,
  page = home,
  kind: 'home' | 'product' | 'about' = 'home'
) => sitePhotos(html, page, kind, { brand: 'Cedar Lane' }).map((p) => p.url)

describe('sitePhotos (ONB-059a)', () => {
  it('finds a product page’s photos, surest first, each tagged as a product photo', () => {
    const html = `<html><head>
      <meta property="og:image" content="${cdn}/socks-share.jpg">
      <meta name="twitter:image" content="${cdn}/socks-tweet.jpg">
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'ImageObject',
            '@id': `${product}#primaryimage`,
            url: `${cdn}/socks-main.jpg`
          },
          {
            '@type': 'http://schema.org/Product',
            name: 'Trail socks',
            image: [
              [`${cdn}/socks-front.jpg`],
              {
                '@type': 'ImageObject',
                contentUrl: 7,
                url: `${cdn}/socks-back.png`
              },
              { '@id': `${product}#primaryimage` }
            ]
          }
        ]
      })}</script></head><body>
      <main><img src="${cdn}/socks-side.jpg?v=12&width=800" alt=" Trail socks,
        side "></main></body></html>`
    expect(sitePhotos(html, product, 'product')).toEqual([
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
        url: `${cdn}/socks-main.jpg`,
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
        url: `${cdn}/socks-tweet.jpg`,
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

  it('tags the brand’s world as lifestyle, and product cards and links to its products as product photos', () => {
    const html = `<body><main>
      <section class="image-banner"><img src="/files/runners-at-dawn.jpg" alt="Runners at dawn"></section>
      <a href="/products/trail-socks"><img data-src="${cdn}/socks-card.jpg" alt="Trail socks"></a>
      <div class="card-wrapper product-card-wrapper"><div class="card__media"><img src="${cdn}/cap.jpg"></div>
        <a href="/products/cap">Cap</a></div>
      <a href="https://www.instagram.com/p/ABC123/"><img src="${cdn}/trail-tile.jpg"></a>
      <a href="/?next=/products/x"><img src="${cdn}/meadow.jpg"></a>
    </main></body>`
    expect(sitePhotos(html, home, 'home').map((p) => [p.url, p.kind])).toEqual([
      ['https://cedarlane.com/files/runners-at-dawn.jpg', 'lifestyle'],
      [`${cdn}/socks-card.jpg`, 'product'],
      [`${cdn}/cap.jpg`, 'product'],
      [`${cdn}/trail-tile.jpg`, 'lifestyle'],
      [`${cdn}/meadow.jpg`, 'lifestyle']
    ])
  })

  it('takes one photo per picture element, at its largest size, and lazy pictures by their real address', () => {
    const html = `<body><main>
      <picture>
        <source type="image/webp" srcset="${cdn}/team-big.webp 1600w">
        <source srcset="${cdn}/team-400.jpg 400w, ${cdn}/team-1600.jpg 1600w">
        <img src="${cdn}/team-small.jpg" alt="Our team">
      </picture>
      <img src="${cdn}/hill.jpg" srcset="${cdn}/hill.jpg 400w, ${cdn}/hill-big.jpg 1600w">
      <img src="/assets/blank.gif" data-src="${cdn}/real.jpg">
      <img src="${cdn}/placeholder.png" data-lazy-src="${cdn}/real2.jpg">
      <img data-original="${cdn}/real3.png">
      <img data-srcset="${cdn}/real4.jpg 800w">
      <img data-src="${cdn}/photo_{width}x.jpg?v=1">
    </main></body>`
    expect(urls(html)).toEqual([
      `${cdn}/team-1600.jpg`,
      `${cdn}/hill-big.jpg`,
      `${cdn}/real.jpg`,
      `${cdn}/real2.jpg`,
      `${cdn}/real3.png`,
      `${cdn}/real4.jpg`
    ])
  })

  it('keeps the same photo once, at its largest, with any copy’s description and product tag', () => {
    const html = `<head><meta property="og:image" content="${cdn}/walk.jpg?width=100"></head><body><main>
      <a href="/products/walk-socks"><img src="${cdn}/walk.jpg?width=1600" alt="Walk socks"></a>
      <img src="${cdn}/dog_400x@2x.jpg"><img src="${cdn}/dog_400x400_crop_center.jpg"><img src="${cdn}/dog_400x.progressive.jpg"><img src="${cdn}/dog.jpg">
    </main></body>`
    expect(
      sitePhotos(html, home, 'home').map((p) => [p.url, p.alt, p.kind, p.from])
    ).toEqual([
      [`${cdn}/walk.jpg?width=1600`, 'Walk socks', 'product', 'share'],
      [`${cdn}/dog.jpg`, null, 'lifestyle', 'page']
    ])
  })

  it('never takes the brand’s logo, an icon, a badge, a seal, a press logo, a review photo or a picture of the header, menu or footer', () => {
    const html = `<head>
      <meta property="og:image" content="${cdn}/Cedar_Lane_Logo_Share.png">
      <script type="application/ld+json">${JSON.stringify({
        '@type': 'Product',
        image: [`${cdn}/brand-logo.png`, `${cdn}/placeholder.png`]
      })}</script></head><body>
      <header><a href="/"><img src="${cdn}/hero-header.jpg" alt="Cedar Lane"></a></header>
      <nav><img src="${cdn}/menu-shoes.jpg"></nav>
      <main>
        <img src="${cdn}/cedar-lane.png" alt="Cedar Lane">
        <img src="${cdn}/CedarLane_Wordmark.png">
        <img src="${cdn}/truck-icon.png">
        <img src="${cdn}/review-stars.png">
        <img src="${cdn}/bcorp-seal.png">
        <img src="${cdn}/hero.jpg" width="80" height="80">
        <img src="${cdn}/hero2.jpg" width="80px">
        <img src="https://bat.bing.com/action/0.jpg" width="0" height="0">
        <img src="${cdn}/hidden.jpg" hidden><img src="${cdn}/gone.jpg" style="display: none">
        <div class="logo-list"><img src="${cdn}/vogue.jpg" alt="Vogue"></div>
        <div class="as-featured-in"><img src="${cdn}/gq.jpg"></div>
        <ul class="payment-icons"><li><img src="${cdn}/visa.png"></li></ul>
        <div class="jdgm-review-widget"><img src="https://judgeme.imgix.net/photo.jpg"></div>
        <div class="certifications"><img src="${cdn}/usda.png"></div>
        <video poster="${cdn}/poster.jpg"><source src="${cdn}/hero.mp4"></video>
        <audio><source src="${cdn}/jingle.mp3"></audio>
        <img src="${cdn}/keep.jpg" alt="A runner, American flag tee" width="1200" height="800">
      </main>
      <footer><img src="${cdn}/footer-trail.jpg"></footer></body>`
    expect(urls(html)).toEqual([`${cdn}/keep.jpg`])
  })

  it('keeps a store’s own “featured” sections, and reads brand words as a name', () => {
    const html = `<body><main>
      <div id="shopify-section-template--123__featured_collection" class="featured-collection">
        <div class="card-wrapper product-card-wrapper"><img src="${cdn}/featured-socks.jpg"></div></div>
      <img src="${cdn}/icon-apparel-hoodie.jpg"></main></body>`
    expect(
      sitePhotos(html, 'https://iconapparel.com/', 'home', {
        brand: 'Icon Apparel'
      }).map((p) => [p.url, p.kind])
    ).toEqual([
      [`${cdn}/featured-socks.jpg`, 'product'],
      [`${cdn}/icon-apparel-hoodie.jpg`, 'lifestyle']
    ])
  })

  it('keeps only photos an email can show', () => {
    for (const url of [
      `${cdn}/a.jpg`,
      `${cdn}/b.JPEG`,
      `${cdn}/c.png?v=2`,
      `https://res.cloudinary.com/x/image/upload/f_auto,q_80/d.jpg`
    ])
      expect(emailPhotoUrl(url), url).toBe(true)
    for (const url of [
      `${cdn}/a.svg`,
      `${cdn}/b.webp`,
      `${cdn}/c.gif`,
      `${cdn}/hero.mp4`,
      `${cdn}/photo`,
      `${cdn}/d.jpg?format=webp`,
      `${cdn}/d.jpg?fm=avif`,
      'https://res.cloudinary.com/x/image/upload/f_webp,q_80/d.jpg',
      `${cdn}/photo_%7Bwidth%7Dx.jpg`,
      'https://cdn.shopify.com:8443/d.jpg',
      'https://user:pw@cdn.shopify.com/e.jpg',
      'http://cdn.shopify.com/f.jpg',
      'https://127.0.0.1/g.jpg',
      'https://10.0.0.5/g.jpg',
      'https://localhost/g.jpg',
      'https://intranet/g.jpg',
      'https://shop.internal/g.jpg',
      `${cdn}/${'x'.repeat(1_000)}.jpg`
    ])
      expect(emailPhotoUrl(url), url).toBe(false)
    // http on an https page is read as https.
    expect(
      urls(`<main><img src="http://cdn.shopify.com/s/files/1/g.jpg"></main>`)
    ).toEqual([`${cdn}/g.jpg`])
  })

  it('cuts a description to 200 characters, never inside one', () => {
    const alt = `${'a'.repeat(199)}😀😀 tail`
    const [photo] = sitePhotos(
      `<main><img src="${cdn}/x.jpg" alt="${alt}"></main>`,
      home,
      'home'
    )
    expect(Array.from(photo!.alt!)).toHaveLength(200)
    expect(photo!.alt!.endsWith('😀')).toBe(true)
  })

  it(`keeps at most ${maxPhotosPerPage} per page, and nothing from a page it cannot place`, () => {
    const html = `<body><main>${Array.from(
      { length: 50 },
      (_, i) => `<img src="${cdn}/photo-${i}.jpg">`
    ).join('')}</main></body>`
    const got = sitePhotos(html, home, 'home')
    expect(got).toHaveLength(maxPhotosPerPage)
    expect(got[0]!.url).toBe(`${cdn}/photo-0.jpg`)
    expect(sitePhotos(html, 'not a page', 'home')).toEqual([])
    expect(
      urls(
        '<script type="application/ld+json">{not json</script><main><img src="/x.jpg"></main>'
      )
    ).toEqual(['https://cedarlane.com/x.jpg'])
  })

  it('reads hostile pages without failing: huge attributes, deep nesting, huge structured data', () => {
    const big = Array.from({ length: 150_000 }, () => 'w').join(' ')
    expect(
      urls(`<main><img src="${cdn}/x.jpg" alt="${big}" class="${big}"></main>`)
    ).toEqual([`${cdn}/x.jpg`])
    const deep = `${'<div>'.repeat(6_000)}<img src="${cdn}/deep.jpg">${'</div>'.repeat(6_000)}`
    expect(urls(`<main>${deep}</main>`)).toEqual([`${cdn}/deep.jpg`])
    const json = JSON.stringify({
      '@type': 'Product',
      image: `${cdn}/big.jpg`,
      filler: 'x'.repeat(600_000)
    })
    expect(
      urls(
        `<script type="application/ld+json">${json}</script>`,
        product,
        'product'
      )
    ).toEqual([`${cdn}/big.jpg`])
  })
})
