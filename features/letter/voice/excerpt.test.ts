import { describe, expect, it } from 'vitest'
import { renderBlock } from '@/features/blocks/render'
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import type { MessageBody } from '@/lib/providers/klaviyo/history'
import { maxExcerptChars, voiceExcerpt as excerptOf } from './excerpt'

/** PIC-23 part 2a: the owner's own words, safe to keep. */
const body = (over: Partial<MessageBody>): MessageBody => ({
  messageId: 'MsgA08',
  templateId: 'TplMsgA08',
  editor: 'rich_text',
  html: '',
  text: null,
  updated: null,
  truncated: false,
  ...over
})
/** The store's own words: its name is no one's name. */
const excerpt = (b: MessageBody) => excerptOf(b, ['Cedar Goods'])
const letter =
  'Hi {{ first_name|default:"friend" }},\n\nI started Cedar Goods in my garage with one sewing machine and a lot of stubbornness. Every shirt still gets checked by hand before it ships.\n\nThank you for being here. If you ever have a question, just hit reply. I read every one.\n\nWarmly,\nMaya'

describe('the owner’s words as a voice excerpt (PIC-23)', () => {
  it('keeps a letter’s words, a greeting’s tag as a placeholder, and weighs it most', () => {
    const made = excerpt(body({ text: letter }))
    expect(made).toMatchObject({ messageId: 'MsgA08', weight: 3 })
    expect(made!.text.startsWith('Hi [first name],')).toBe(true)
    expect(made!.text).toContain('I started Cedar Goods in my garage')
    expect(made!.text).not.toMatch(/[{}]/)
  })

  it('reads the HTML when there is no plain text, without the hidden preview line or the footer', () => {
    const html = `<div style="display:none;max-height:0">Secret preview line</div><p>${letter.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p><p>You are receiving this because you signed up. {% unsubscribe "Unsubscribe" %}</p><p>{{ organization.full_address }}</p>`
    const made = excerpt(body({ html, editor: 'code' }))
    expect(made!.weight).toBe(2)
    expect(made!.text).not.toContain('Secret preview line')
    expect(made!.text).not.toMatch(/unsubscribe|receiving this/i)
    expect(made!.text).toContain('Warmly,\nMaya')
  })

  it('never keeps what the owner typed about other people', () => {
    const typed = `${letter}\nWrite to jo.sample@example.com or call +1 (555) 010-2030, or see https://cedar.example/story?ref=123456789. Order 12345678.\n\n“The overshirt I wear every day.” Jordan Sample`
    const made = excerpt(body({ text: typed }))!
    expect(made.text).not.toContain('Jordan Sample')
    expect(made.text).not.toContain('example.com')
    expect(made.text).not.toContain('555')
    expect(made.text).not.toContain('123456789')
    expect(made.text).toContain('[email]')
    expect(made.text).toContain('[phone]')
    expect(made.text).toContain('[link]')
  })

  it('a designed promotion counts for little, a few words for nothing, a long one is cut on a word', () => {
    const promo = `<h1>Winter layers are here</h1><p>${'Soft wool for cold mornings and long walks. '.repeat(5)}</p><a href="https://cedar.example">Shop now</a>`
    expect(
      excerpt(body({ html: promo, editor: 'drag_and_drop' }))!.weight
    ).toBe(1)
    expect(excerpt(body({ text: 'Shop the sale now.' }))).toBeNull()
    const long = excerpt(
      body({ text: 'We make things slowly and with care. '.repeat(400) })
    )!
    expect(long.text.length).toBeLessThanOrEqual(maxExcerptChars)
    expect(long.text.endsWith('.') || /\w$/.test(long.text)).toBe(true)
  })

  it('drops a review whole, our own review section included: its quote, stars and name', () => {
    const reviews = renderBlock(
      sampleBlocks.review_strip,
      sampleBrand,
      'klaviyo'
    )
    const html = `<p>${letter.replace(/\n+/g, '</p><p>')}</p>${reviews}<blockquote>I wear it every day. Alex Moreno</blockquote>`
    const made = excerpt(body({ html, editor: 'code' }))!
    for (const review of (
      sampleBlocks.review_strip.content as {
        reviews: { author: string; quote: string }[]
      }
    ).reviews) {
      expect(made.text).not.toContain(review.author)
      expect(made.text).not.toContain(review.quote.slice(0, 20))
    }
    expect(made.text).not.toContain('Alex Moreno')
    expect(made.text).not.toMatch(/★/)
    const typed = `${letter}\n\n★★★★★\n“Love it, wear it daily.”\nPriya K.\n— Jordan Sample, Austin TX\nVerified buyer\n5 stars from Morgan Lee: so soft.`
    const text = excerpt(body({ text: typed }))!.text
    for (const name of ['Priya', 'Jordan', 'Verified', 'Morgan', 'Love it'])
      expect(text, name).not.toContain(name)
  })

  it('drops the footer this product sends, and a typed postal address', () => {
    const footer = renderBlock(sampleBlocks.footer, sampleBrand, 'klaviyo')
    const html = `<p>${letter.replace(/\n+/g, '</p><p>')}</p><p>Visit us at 742 Evergreen Terrace, Springfield, IL 62704.</p>${footer}`
    const made = excerpt(body({ html, editor: 'code' }))!
    expect(made.text).not.toMatch(
      /signed up|No longer want|Trouble viewing|Evergreen|Springfield|62704|\[store name\]/
    )
  })

  it('replaces links without https, handles, and drops comments and the other branch', () => {
    const typed = `${letter}\nRead more at cedar.example/story or instagram.com/mayasample. Photo by @jordan.sample.\n{% comment %}Internal: Priya approved{% endcomment %}{% if person.first_name %}Hello again{% else %}Hi Jordan Sample{% endif %}`
    const text = excerpt(body({ text: typed }))!.text
    expect(text).not.toMatch(/cedar\.example|instagram|jordan|Priya|Internal/i)
    expect(text).toContain('[link]')
    expect(text).toContain('[handle]')
    expect(text).toContain('Hello again')
  })

  it('keeps the owner’s own quoted words, inches and dates; drops invisible padding', () => {
    const typed = `${letter}\nWe call it the "forever shirt", and the sleeves are 32" long. It ships 2026-11-16.\nSizes 32 34 36 38 40.`
    const text = excerpt(body({ text: typed }))!.text
    expect(text).toContain('the "forever shirt"')
    expect(text).toContain('2026-11-16')
    expect(text).toContain('Sizes 32 34 36 38 40')
    const padded = `<div style="display:none"><div>Preview</div>${'&#847;&zwnj;&nbsp;'.repeat(60)}</div><p style="max-height:0;overflow:hidden">padding</p><p>${letter.replace(/\n+/g, '</p><p>')}</p>`
    const made = excerpt(body({ html: padded, editor: 'code' }))!
    expect(made.text).not.toMatch(/Preview|padding|[\u034F\u200C]/)
  })

  it('never counts placeholders as words, and reads the HTML when the text says too little', () => {
    const tags = Array.from(
      { length: 40 },
      () => '{{ event.items.0.name }}'
    ).join('\n')
    expect(excerpt(body({ text: tags }))).toBeNull()
    const made = excerpt(
      body({
        text: 'Shop now.',
        html: `<p>${letter.replace(/\n+/g, '</p><p>')}</p>`
      })
    )
    expect(made?.text).toContain('I started Cedar Goods')
  })

  it('stays fast on a hostile template', () => {
    const hostile = [
      '<div style="display:none" '.repeat(12_000),
      'a'.repeat(300_000) + '@',
      '{{ '.repeat(100_000),
      '{% comment %}'.repeat(20_000),
      '<div>'.repeat(60_000)
    ]
    for (const html of hostile) {
      const start = performance.now()
      excerpt(body({ html, text: html, editor: 'code' }))
      expect(performance.now() - start, html.slice(0, 20)).toBeLessThan(3_000)
    }
  })

  it('drops a reviewer’s name in every layout the review found (round 2)', () => {
    const html = (review: string) =>
      `<p>${letter.replace(/\n+/g, '</p><p>')}</p>${review}`
    const leaks: [string, string][] = [
      [
        '<blockquote>I wear it every day, it is so soft.</blockquote><p>Alex Moreno</p>',
        'Alex'
      ],
      ['<p><strong>Priya K.</strong> Verified buyer</p>', 'Priya'],
      ['<p>Taylor B. from Leeds: Love it, wear it daily.</p>', 'Taylor'],
      [
        '<p>Customer review: Love it, wear it daily. Taylor Brooks</p>',
        'Taylor'
      ],
      [
        '<p>★★★★★</p><p>Best overshirt I have ever owned.</p><p>Priya K.</p>',
        'Priya'
      ],
      [
        '<table><tr><td><img alt="5 star rating" src="stars.png"></td><td>Best overshirt I have ever owned.</td><td><b>Priya K.</b></td></tr></table>',
        'Priya'
      ],
      [
        '<p>“The overshirt I wear every day.”</p><cite>Alex Moreno, Leeds</cite>',
        'Alex'
      ],
      [
        '<figure><p>“The overshirt I wear every day.”</p><figcaption>Alex Moreno</figcaption></figure>',
        'Alex'
      ],
      [
        '<p>Jordan Sample</p><p>“The overshirt I wear every day.”</p>',
        'Jordan'
      ],
      ['<p>Review by Casey Lin: so soft, I bought two.</p>', 'Casey'],
      ['<p>Jordan S.: The overshirt I wear every day.</p>', 'Jordan']
    ]
    for (const [review, name] of leaks) {
      const made = excerpt(body({ html: html(review), editor: 'code' }))!
      expect(made.text, review).not.toContain(name)
      expect(made.text, review).toContain('I started Cedar Goods')
    }
  })

  it('reads an MJML email (columns at font-size 0), and keeps the owner’s road sentences', () => {
    const mjml = `<div style="font-size:0px;"><table><tr><td style="font-size:0px;padding:10px"><div style="font-family:Arial;font-size:16px">${letter.replace(/\n+/g, '<br>')}</div></td></tr></table></div>`
    expect(excerpt(body({ html: mjml, editor: 'code' }))?.text).toContain(
      'I started Cedar Goods'
    )
    const story = `${letter}\nIn 2015 I started down this road with one machine.\nWe spent 5 years on the road before the shop.\nIt takes 10 minutes to drive to the studio.\nYour order #12345 is on its way.`
    const text = excerpt(body({ text: story }))!.text
    for (const line of [
      'In 2015 I started down this road',
      'We spent 5 years on the road',
      'It takes 10 minutes to drive',
      'is on its way'
    ])
      expect(text, line).toContain(line)
    const abroad = `${letter}\nCome by 123 rue Saint-Denis, Montréal QC H2X 3K7.\nOr Hauptstraße 12, 10115 Berlin.`
    expect(excerpt(body({ text: abroad }))!.text).not.toMatch(
      /Denis|Haupt|10115/
    )
  })

  it('keeps only a choice’s first branch, a tag over two lines, and lines that only look like reviews', () => {
    const typed = `{% if a %}Hello again{% elif b %}Hi Jordan Sample{% else %}Hi there{% endif %}\nHi {{ person.first_name|default:"there"\n}}\n${letter}\n'Tis the season for a slow morning, we think.\nWe're a 5 star shop, and proud of it.\nThis email was sent to {{ email }}.`
    const text = excerpt(body({ text: typed }))!.text
    expect(text).toContain('Hello again')
    expect(text).not.toMatch(/Jordan|Hi there|person\.first_name|sent to/)
    expect(text).toContain('Hi [first name]')
    expect(text).toContain("'Tis the season")
    expect(text).toContain("We're a 5 star shop")
    const mobile = `<p class="mobile-hidden">${letter.replace(/\n+/g, ' ')}</p>`
    expect(excerpt(body({ html: mobile, editor: 'code' }))).not.toBeNull()
  })

  it('keeps a founder’s habits whole: a dash sign-off, a star, a saying, a list, a logo (round 3)', () => {
    const habits = `${letter}\n— Maya\n\nP.S. The new colours land on Friday, and I think you will love the green one most of all.\n\n⭐ The overshirt is our bestseller this year, and it still gets checked by hand.\n"Measure twice, cut once." My grandmother said it every day in her little sewing room.\n- soft cotton that lasts\n- buttons sewn on twice\nThat is all from me this week. Write back any time.`
    const text = excerpt(body({ text: habits }))!.text
    for (const line of [
      'P.S. The new colours',
      'The overshirt is our bestseller',
      'My grandmother said',
      'soft cotton that lasts',
      'That is all from me'
    ])
      expect(text, line).toContain(line)
    const promo = `<img alt="Northstar Goods" src="logo.png"><img alt="Starter kit" src="kit.png"><img alt="Celebrating ten years" src="preview.png"><p>${letter.replace(/\n+/g, '</p><p>')}</p>`
    expect(excerpt(body({ html: promo, editor: 'code' }))?.text).toContain(
      'Warmly'
    )
  })

  it('protects the store’s words as whole words only, never a customer’s name around them', () => {
    const own = ['Cedar Goods', 'Ruby', 'Jo', 'Ella', 'Lee', 'Set']
    const typed = `${letter}\nThis week Ruby Thompson, Joanne Smith, Isabella Ross, Kathleen Ward and Seth Rivers all wrote to us about the Ruby ring.`
    const text = excerptOf(body({ text: typed }), own)!.text
    expect(text).not.toMatch(/Thompson|Joanne|Isabella|Kathleen|Seth/)
    expect(text).toContain('the Ruby ring')
    // A large catalogue stays fast.
    const titles = Array.from(
      { length: 20_000 },
      (_, i) => `Product ${i} Deluxe`
    )
    const many = `${letter}\n${'Jordan Sample and Priya Kumar wrote back. '.repeat(2_000)}`
    const start = performance.now()
    excerptOf(body({ text: many }), titles)
    expect(performance.now() - start).toBeLessThan(3_000)
  })

  it('keeps the owner’s Title Case words, and finds more name shapes', () => {
    const typed = `${letter}\nHappy Thanksgiving and Merry Christmas to all of you. Thank You for this year.\nLast Tuesday we shipped early. This Friday there is Free Shipping on the whole shop.\nOur Story: how two friends started with one machine.\nPro Tip: wash it cold and hang it to dry.\nRonald McDonald, Sean O'Brien, Vincent van Gogh, J. Sample, A.J. Rivers, Mrs. Sample, Dr. Rivers, JORDAN SAMPLE and Mary-Kate Olsen came by.`
    const text = excerpt(body({ text: typed }))!.text
    for (const words of [
      'Happy Thanksgiving',
      'Merry Christmas',
      'Thank You',
      'Last Tuesday',
      'This Friday',
      'Free Shipping',
      'Our Story: how two friends',
      'Pro Tip: wash it cold'
    ])
      expect(text, words).toContain(words)
    expect(text).not.toMatch(
      /Ronald|McDonald|O'Brien|Gogh|Sample|Rivers|JORDAN|Olsen|Mary-Kate/
    )
    const loop = `{% for item in event.items %}{{ item.name }}{% empty %}Hi Jordan Sample{% endfor %}\n${letter}`
    expect(excerpt(body({ text: loop }))!.text).not.toContain('Jordan')
  })
})
