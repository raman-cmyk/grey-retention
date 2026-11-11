/**
 * A sample website for the synthetic brands (`*.example` domains only), so
 * the Site reader can be tried end to end without the network. A real
 * domain gets nothing here: the sample reader never invents facts about a
 * real brand.
 */

const titleCase = (label: string) =>
  label
    .split('-')
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ')

const page = (title: string, body: string, lang = 'en') =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title>` +
  `<meta name="description" content="Everyday layers made to last. A fictional brand for testing.">` +
  `<style>.hidden{display:none}</style><script>window.track=1</script></head><body>` +
  `<header><nav><a href="/">Home</a> <a href="/collections/all">Shop</a> <a href="/pages/about">Our story</a> ` +
  `<a href="/pages/faq">Help</a></nav>` +
  `<div style="display:none">Hidden preview text that is never shown</div></header>` +
  `<main>${body}</main>` +
  `<footer><p>Free shipping on orders over $75.</p><p><a href="/pages/shipping">Shipping</a> · ` +
  `<a href="/pages/returns">Returns</a> · <a href="mailto:hello@example.com">Contact</a> · ` +
  `<a href="https://social.example/brand">Follow us</a></p></footer></body></html>`

export function samplePage(domain: string, path: string): string | null {
  const host = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
  if (!host.endsWith('.example')) return null
  const name = titleCase(host.split('.')[0]!)
  switch (path.replace(/\/+$/, '') || '/') {
    case '/':
      return page(
        `${name} — Everyday layers`,
        `<h1>Everyday layers for quiet weekends</h1>` +
          `<p>${name} makes soft, hard-wearing clothes for slow days at home and outside.</p>` +
          `<h2>Bestsellers</h2><ul><li><a href="/products/field-overshirt">Field Overshirt — $89.00</a></li>` +
          `<li><a href="/products/weekend-knit">Weekend Knit — $120.00</a></li></ul>`
      )
    case '/products/field-overshirt':
      return page(
        `Field Overshirt — ${name}`,
        `<h1>Field Overshirt</h1><p class="price">$89.00</p>` +
          `<p>Made from 100% organic cotton twill, garment washed for a soft feel from day one.</p>` +
          `<p>The most comfortable overshirt you will ever wear.</p>` +
          `<p>Ships in 1–2 business days.</p>`
      )
    case '/products/weekend-knit':
      return page(
        `Weekend Knit — ${name}`,
        `<h1>Weekend Knit</h1><p class="price">$120.00</p><p>A heavy knit in undyed wool.</p>`
      )
    case '/pages/about':
      return page(
        `Our story — ${name}`,
        `<h1>Our story</h1><p>${name} started in a small workshop in 2016.</p>` +
          `<p>We design for people who would rather buy one good layer than five quick ones.</p>`
      )
    case '/pages/shipping':
      return page(
        `Shipping — ${name}`,
        `<h1>Shipping</h1><p>Orders ship within 1–2 business days.</p>` +
          `<p>Delivery takes 3–5 business days in the United States.</p>` +
          `<p>Free shipping on orders over $75.</p>`
      )
    case '/pages/returns':
      return page(
        `Returns — ${name}`,
        `<h1>Returns</h1><p>Return any unworn item within 30 days for a full refund.</p>`
      )
    case '/pages/faq':
      return page(
        `Help — ${name}`,
        `<h1>Questions</h1><h3>Is there a guarantee?</h3>` +
          `<p>Every piece is covered by our 1-year guarantee against defects.</p>` +
          `<h3>Which currency do you charge in?</h3><p>All prices are in US dollars.</p>`
      )
    default:
      return null
  }
}
