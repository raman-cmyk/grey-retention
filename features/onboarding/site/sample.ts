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

/**
 * PICK-006: the sample site's look, so the design tokens can be read end
 * to end without the network. One of two fixed looks, chosen by the
 * brand's name (the sum of its letters' codes, odd or even): two sample
 * brands can differ, and one brand always reads the same.
 * - **Calm**: an 8 px unit, 16 px body at 1.6, headings 36/26/20 in
 *   capitals, 4 px corners on buttons (filled, 14 × 28 px, capitals, 600),
 *   6 px on cards and pictures.
 * - **Soft**: a 6 px unit, 17 px body at 1.5, headings 40/28/21 as
 *   written, pill buttons (outline, 12 × 30 px, 500), 16 px cards, 12 px
 *   pictures.
 */
export const sampleLooks = {
  calm:
    ':root{--spacing-unit:8px;--page-gutter:32px}' +
    'body{font-size:16px;line-height:1.6;margin:0}' +
    'h1,.h1{font-size:36px;text-transform:uppercase}h2,.h2{font-size:26px;text-transform:uppercase}h3,.h3{font-size:20px}' +
    '.section{padding:48px 32px;margin:0 0 24px}.grid{gap:16px}.stack{margin-bottom:8px}' +
    '.button{background:#1f2a24;color:#fff;border:0;border-radius:4px;padding:14px 28px;text-transform:uppercase;font-weight:600}' +
    '.button--secondary{background:transparent;border:1px solid #1f2a24}' +
    '.card{border-radius:6px;padding:16px}img{border-radius:6px}' +
    '@media (max-width:749px){h1,.h1{font-size:28px}.section{padding:24px 16px}}',
  soft:
    'body{font-size:17px;line-height:1.5;margin:0}' +
    'h1,.h1{font-size:40px}h2,.h2{font-size:28px}h3,.h3{font-size:21px}' +
    '.section{padding:36px 24px;margin:0 0 18px}.grid{gap:12px}.stack{margin-bottom:6px}.note{padding:12px 18px}' +
    '.button{background:transparent;color:#2b2140;border:2px solid #2b2140;border-radius:999px;padding:12px 30px;font-weight:500}' +
    '.card{border-radius:16px;padding:24px}.card__media{border-radius:12px}' +
    '@media (max-width:749px){h1,.h1{font-size:30px}}'
} as const

/** Which look a sample brand's site has (`sampleLooks`). */
export function sampleLookOf(domain: string): keyof typeof sampleLooks {
  const name = domain
    .trim()
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.')[0]!
  let sum = 0
  for (const c of name) sum += c.charCodeAt(0)
  return sum % 2 === 0 ? 'calm' : 'soft'
}

const samplePageHtml = (title: string, body: string, lang = 'en', look = '') =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title>` +
  `<meta name="description" content="Everyday layers made to last. A fictional brand for testing.">` +
  `<style>.hidden{display:none}${look}</style><script>window.track=1</script></head><body>` +
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
  const look = sampleLooks[sampleLookOf(host)]
  const page = (title: string, body: string) =>
    samplePageHtml(title, body, 'en', look)
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
