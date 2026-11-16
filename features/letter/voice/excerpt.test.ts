import { describe, expect, it } from 'vitest'
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
    const html = `<div style="display:none;max-height:0">Secret preview line</div><p>${letter.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p><p>You are receiving this because you signed up. <a href="{% unsubscribe_link %}">Unsubscribe</a></p><p>{% organization.full_address %}</p>`
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
})
