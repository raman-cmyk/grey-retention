// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { inboxConfig } from './config'
import {
  cleanEmail,
  cleanEmailHtml,
  cleanEmailPreview,
  cleanEmailSubject,
  cleanEmailText,
  inboxIdentity,
  type InboxIdentity
} from './privacy'

// Made up: a Gmail research inbox that subscribed as "Sam Rivera".
const me: InboxIdentity = {
  addresses: ['sampleinbox@gmail.com'],
  names: ['Sam Rivera']
}
const address = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+/u
const person = /\b(?:sam|rivera)\b/i

/** A Klaviyo-style newsletter, with everything a subscriber's copy has. */
const klaviyo = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html><head><title>Hi Sam, spring is here</title>
<style>@media (max-width:600px){.hero{background:url('https://cdn.northwind.example/bg.png?kx=abc123')}}</style></head>
<body style="margin:0" data-email="sam@example.com" onload="track()">
<div style="display:none">Hi Sam, 20% off ends tonight</div>
<!--[if mso]><v:roundrect href="https://ctrk.klclick.example/l/TOKEN1">Shop</v:roundrect><![endif]-->
<table width="600" role="presentation"><tr><td><a href="https://northwind.example/?_kx=TOKEN2.abc"><img src="https://cdn.northwind.example/logo.png?w=140&amp;h=40" width="140" alt="Northwind"></a></td></tr>
<tr><td style="padding:24px"><h1>Hello Spring collection</h1><p>Hi Sam,</p>
<p>Dear <b>Sam Rivera</b>, our Samsonite-tough duffel is back.</p>
<a href="https://ctrk.klclick.example/l/01HXYZ_TOKEN3" style="color:#fff;background:#111" title="Sam, shop now">Shop the drop</a></td></tr>
<tr><td style="font-size:11px">This email was sent to sampleinbox+northwind@gmail.com by Northwind Outdoor. <a href="https://manage.kmail-lists.example/unsubscribe?a=X&amp;k=TOKEN4">Unsubscribe</a> | <a href="https://manage.kmail-lists.example/update?k=TOKEN5">Manage preferences</a> | <a href="mailto:help@northwind.example">help@northwind.example</a></td></tr></table>
<form action="https://northwind.example/survey?e=TOKEN6"><input type="hidden" name="email" value="sam@example.com"><p>Rate us</p></form>
<img src="https://trk.klclick.example/open?k=TOKEN7" width="1" height="1" alt="">
</body></html>`

/** A Shopify Email-style text part, preview line and subject. */
const shopify = {
  subject: 'Sam, your Sampler Pack is back',
  preview: 'Hi Sam Rivera, the Spring Edit is here',
  text: `Hey Sam!

Our Sampler Pack is back, and the Spring Edit has landed.
Shop now (https://northwind.example/spring?utm_source=shopify_email&_kx=TOKEN8)
Track it: https://email.shopify.example/c/r/TOKEN9

Questions? Write to help [at] northwind [dot] example or reply.

This email was sent to sample.inbox+northwind@googlemail.com because you signed up.
Unsubscribe <https://northwind.example/unsubscribe?email=sam%40example.com>
Northwind Outdoor, 1 Sample Street`,
  html: null
}

describe('cleanEmailText', () => {
  it('cleans a Shopify-style newsletter of the person and their links', () => {
    expect(cleanEmailText(shopify.text, me)).toBe(`Hey there!

Our Sampler Pack is back, and the Spring Edit has landed.
Shop now
Track it:

Questions? Write to or reply.

Unsubscribe
Northwind Outdoor, 1 Sample Street`)
    expect(cleanEmailSubject(shopify.subject, me)).toBe(
      'your Sampler Pack is back'
    )
    expect(cleanEmailPreview(shopify.preview, me)).toBe(
      'Hi there, the Spring Edit is here'
    )
  })

  it('removes every address, plain, in brackets or written out', () => {
    for (const text of [
      'Write to Sam <sam.rivera@example.com> today',
      'Write to mailto:help@northwind.example today',
      'Write to help [at] northwind [dot] example today',
      'Write to sam(at)example.com today',
      'Write to help {at} northwind.example today',
      'Write to s.a.m.p.l.e.inbox@googlemail.com today',
      'Write to postmaster@localhost today'
    ])
      expect(cleanEmailText(text, me)).toBe('Write to today')
  })

  it("removes the inbox's own +alias and Gmail dot variants", () => {
    expect(cleanEmailText('Hi sample.inbox+northwind, welcome', me)).toBe(
      'Hi there, welcome'
    )
    expect(cleanEmailText('Your login: SampleInbox+Cedar', me)).toBe(
      'Your login:'
    )
  })

  it('turns a greeting by name into "there", whatever the name', () => {
    const greets: [string, string][] = [
      ['Hi Sam,', 'Hi there,'],
      ['Hey Sam!', 'Hey there!'],
      ['Dear Sam Rivera,', 'Hi there,'],
      ['Hello, Jordan.', 'Hello there.'],
      ['Hi\u00a0Sam\u00a0!', 'Hi there!'],
      ['hi sam, ready?', 'hi there, ready?'],
      ['Thanks, Sam!', 'Thanks!'],
      ["Sam's picks", 'picks']
    ]
    for (const [text, clean] of greets)
      expect(cleanEmailText(text, me)).toBe(clean)
  })

  it('keeps greetings without a name, products and the brand', () => {
    for (const text of [
      'Hi there',
      'Hello friend',
      'Hey everyone!',
      'Hello Spring collection',
      'Hello Spring!',
      'Our Samsonite duffel and the Sampler Pack',
      'Follow @northwind or save 20% @ checkout',
      'Dear valued customer,'
    ])
      expect(cleanEmailText(text, me)).toBe(text)
    // The brand's own name is never a person's, even if it has one in it.
    const keep = { keep: ['Northwind', 'Rivera Goods'] }
    expect(cleanEmailText('Hello Northwind!', me, keep)).toBe(
      'Hello Northwind!'
    )
    expect(
      cleanEmailText('New at Rivera Goods: linen. Thanks, Rivera!', me, keep)
    ).toBe('New at Rivera Goods: linen. Thanks!')
  })

  it('cuts on a whole word and stays within the limits', () => {
    const long = `${'linen '.repeat(2_000)}end`
    const text = cleanEmailText(long, me)
    expect(text.length).toBeLessThanOrEqual(10_000)
    expect(text.endsWith('linen')).toBe(true)
    const subject = cleanEmailSubject('Hi Al, '.repeat(40), me)
    expect(subject.length).toBeLessThanOrEqual(200)
    expect(subject.endsWith('Hi there,')).toBe(true)
  })
})

describe('cleanEmailHtml', () => {
  const html = cleanEmailHtml(klaviyo, me)!

  it('removes the person, every link target, comments, forms and pixels', () => {
    expect(html).not.toMatch(person)
    expect(html).not.toMatch(address)
    expect(html).not.toMatch(
      /TOKEN|_kx|klclick|kmail|mailto|<!--|roundrect|<form|<input|data-email|onload|sent to|\?w=|kx=/
    )
    expect(html.match(/href="[^"]+"/g)).toBeNull()
  })

  it('keeps the look: doctype, structure, styles, images and words', () => {
    expect(html).toMatch(/^<!DOCTYPE html PUBLIC "-\/\/W3C\/\/DTD XHTML 1\.0/)
    for (const kept of [
      '<title>Hi there, spring is here</title>',
      "url('https://cdn.northwind.example/bg.png')}}",
      '<div style="display:none">Hi there, 20% off ends tonight</div>',
      '<img src="https://cdn.northwind.example/logo.png" width="140" alt="Northwind">',
      '<h1>Hello Spring collection</h1><p>Hi there,</p>',
      '<p>Hi <b>there</b>, our Samsonite-tough duffel is back.</p>',
      '<a href="" style="color:#fff;background:#111" title="shop now">Shop the drop</a>',
      '<a href="">Unsubscribe</a> | <a href="">Manage preferences</a>',
      '<div><p>Rate us</p></div>'
    ])
      expect(html).toContain(kept)
  })

  it('uses the stored copy of an image when it is given', () => {
    const images = [
      {
        ref: 'https://cdn.northwind.example/logo.png?w=140&amp;h=40',
        path: 'img/abc.png'
      }
    ]
    expect(cleanEmailHtml(klaviyo, me, { images })).toContain(
      '<img src="img/abc.png" width="140"'
    )
  })

  it('drops open pixels and keeps spacers', () => {
    const out = cleanEmailHtml(
      `<img src="https://cdn.x.example/open.gif"><img src="https://x.example/a.gif" width="0" height="0"><img src="https://x.example/b.gif" style="width:1px;height:1px"><img src="https://beacon.x.example/b.png" width="600"><img src="https://x.example/spacer.gif" width="1" height="20"><img src="javascript:track()" width="600">`,
      me
    )!
    expect(out.match(/<img/g)).toHaveLength(2)
    expect(out).toContain('spacer.gif')
    expect(out).toContain('<img src="" width="600">')
  })
})

describe('cleanEmail', () => {
  it('cleans all four parts, and cleaning twice changes nothing', () => {
    for (const email of [shopify, { ...shopify, html: klaviyo }]) {
      const once = cleanEmail(email, me)
      expect(once.changed).toBe(true)
      const { changed, ...parts } = once
      expect(changed).toBe(true)
      const twice = cleanEmail(parts, me)
      expect(twice).toEqual({ ...parts, changed: false })
      expect(JSON.stringify(parts)).not.toMatch(person)
    }
  })

  it('stays fast on hostile input', () => {
    const started = Date.now()
    // Long runs: a pattern that rescans a run takes many seconds on these.
    for (const run of [
      'a',
      '@',
      'a@',
      'a.',
      ' ',
      '\u00a0',
      'Hi ',
      'sent to ',
      'sam [at] ',
      'url(https://'
    ]) {
      // The address makes the tidying run over the whole run too.
      const text = `${run.repeat(40_000 / run.length)}x sam@example.com,`
      cleanEmailText(text, me)
      cleanEmailHtml(`<p style="${text}" alt="${text}">${text}</p>`, me)
    }
    // Huge: half a megabyte of newsletters at once.
    expect(cleanEmailHtml(klaviyo.repeat(250), me)).not.toMatch(person)
    expect(
      cleanEmail({ ...shopify, text: shopify.text.repeat(1_500) }, me).text
    ).not.toMatch(person)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('refuses HTML the parser would be slow on, and reads deep tables', () => {
    const started = Date.now()
    expect(cleanEmailHtml('<div>'.repeat(100_000), me)).toBeNull()
    expect(cleanEmailHtml(`<p ${'a1 '.repeat(5_000)}>`, me)).toBeNull()
    const deep = cleanEmailHtml(`${'<table><tr><td>'.repeat(3_000)}Hi Sam,`, me)
    expect(deep).toContain('<td>Hi there,</td>')
    expect(Date.now() - started).toBeLessThan(3_000)
  })
})

describe('inboxIdentity', () => {
  it('is the inbox address and the subscriber names from the settings', () => {
    expect(
      inboxIdentity(
        inboxConfig({ INBOX_SUBSCRIBER_NAMES: ' Sam  Rivera , ,S ' })
      )
    ).toEqual({ addresses: ['capture@inbox.example'], names: ['Sam Rivera'] })
    expect(
      inboxIdentity(inboxConfig({ INBOX_TRANSPORT: 'gmail_imap' }))
    ).toEqual({ addresses: [], names: [] })
  })
})
