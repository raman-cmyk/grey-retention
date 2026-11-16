import { describe, expect, it } from 'vitest'
import { renderBlock } from '@/features/blocks/render'
import { sampleBlocks, sampleBrand } from '@/features/blocks/samples'
import type { MessageBody } from '@/lib/providers/klaviyo/history'
import { maxExcerptChars, voiceExcerpt } from './excerpt'

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
const letter =
  'Hi {{ first_name|default:"friend" }},\n\nI started Cedar Goods in my garage with one sewing machine and a lot of stubbornness. Every shirt still gets checked by hand before it ships.\n\nThank you for being here. If you ever have a question, just hit reply. I read every one.\n\nWarmly,\nMaya'

describe('the owner’s words as a voice excerpt (PIC-23)', () => {
  it('keeps a letter’s words, a greeting’s tag as a placeholder, and weighs it most', () => {
    const made = voiceExcerpt(body({ text: letter }))
    expect(made).toMatchObject({ messageId: 'MsgA08', weight: 3 })
    expect(made!.text.startsWith('Hi [first name],')).toBe(true)
    expect(made!.text).toContain('I started Cedar Goods in my garage')
    expect(made!.text).not.toMatch(/[{}]/)
  })

  it('reads the HTML when there is no plain text, without the hidden preview line or the footer', () => {
    const html = `<div style="display:none;max-height:0">Secret preview line</div><p>${letter.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p><p>You are receiving this because you signed up. {% unsubscribe "Unsubscribe" %}</p><p>{{ organization.full_address }}</p>`
    const made = voiceExcerpt(body({ html, editor: 'code' }))
    expect(made!.weight).toBe(2)
    expect(made!.text).not.toContain('Secret preview line')
    expect(made!.text).not.toMatch(/unsubscribe|receiving this/i)
    expect(made!.text).toContain('Warmly,\nMaya')
  })

  it('never keeps what the owner typed about other people', () => {
    const typed = `${letter}\n\n“The overshirt I wear every day.” Jordan Sample\nWrite to jo.sample@example.com or call +1 (555) 010-2030, or see https://cedar.example/story?ref=123456789. Order 12345678.`
    const made = voiceExcerpt(body({ text: typed }))!
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
      voiceExcerpt(body({ html: promo, editor: 'drag_and_drop' }))!.weight
    ).toBe(1)
    expect(voiceExcerpt(body({ text: 'Shop the sale now.' }))).toBeNull()
    const long = voiceExcerpt(
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
    const made = voiceExcerpt(body({ html, editor: 'code' }))!
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
    const text = voiceExcerpt(body({ text: typed }))!.text
    for (const name of ['Priya', 'Jordan', 'Verified', 'Morgan', 'Love it'])
      expect(text, name).not.toContain(name)
  })

  it('drops the footer this product sends, and a typed postal address', () => {
    const footer = renderBlock(sampleBlocks.footer, sampleBrand, 'klaviyo')
    const html = `<p>${letter.replace(/\n+/g, '</p><p>')}</p><p>Visit us at 742 Evergreen Terrace, Springfield, IL 62704.</p>${footer}`
    const made = voiceExcerpt(body({ html, editor: 'code' }))!
    expect(made.text).not.toMatch(
      /signed up|No longer want|Trouble viewing|Evergreen|Springfield|62704|\[store name\]/
    )
  })

  it('replaces links without https, handles, and drops comments and the other branch', () => {
    const typed = `${letter}\nRead more at cedar.example/story or instagram.com/mayasample. Photo by @jordan.sample.\n{% comment %}Internal: Priya approved{% endcomment %}{% if person.first_name %}Hello again{% else %}Hi Jordan Sample{% endif %}`
    const text = voiceExcerpt(body({ text: typed }))!.text
    expect(text).not.toMatch(/cedar\.example|instagram|jordan|Priya|Internal/i)
    expect(text).toContain('[link]')
    expect(text).toContain('[handle]')
    expect(text).toContain('Hello again')
  })

  it('keeps the owner’s own quoted words, inches and dates; drops invisible padding', () => {
    const typed = `${letter}\nWe call it the "forever shirt", and the sleeves are 32" long. It ships 2026-11-16.\nSizes 32 34 36 38 40.`
    const text = voiceExcerpt(body({ text: typed }))!.text
    expect(text).toContain('the "forever shirt"')
    expect(text).toContain('2026-11-16')
    expect(text).toContain('Sizes 32 34 36 38 40')
    const padded = `<div style="display:none"><div>Preview</div>${'&#847;&zwnj;&nbsp;'.repeat(60)}</div><p style="max-height:0;overflow:hidden">padding</p><p>${letter.replace(/\n+/g, '</p><p>')}</p>`
    const made = voiceExcerpt(body({ html: padded, editor: 'code' }))!
    expect(made.text).not.toMatch(/Preview|padding|[\u034F\u200C]/)
  })

  it('never counts placeholders as words, and reads the HTML when the text says too little', () => {
    const tags = Array.from(
      { length: 40 },
      () => '{{ event.items.0.name }}'
    ).join('\n')
    expect(voiceExcerpt(body({ text: tags }))).toBeNull()
    const made = voiceExcerpt(
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
      voiceExcerpt(body({ html, text: html, editor: 'code' }))
      expect(performance.now() - start, html.slice(0, 20)).toBeLessThan(3_000)
    }
  })
})
