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
/** What must never be left: the person, the inbox, a token, a live tag. */
const leaks = /\b(?:sam|rivera)\b|sampleinbox|%40|TOKEN|onerror|javascript/i

/** A Klaviyo-style newsletter, with everything a subscriber's copy has. */
const klaviyo = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html><head><title>Hi Sam, spring is here</title>
<style>@media (max-width:600px){.hero{background:url('https://cdn.northwind.example/bg.png?kx=abc123')}}</style></head>
<body style="margin:0" data-email="sam@example.com" onload="track()">
<div style="display:none">Hi Sam, 20% off ends tonight</div>
<!--[if mso]><v:roundrect href="https://ctrk.klclick.example/l/TOKEN1">Shop</v:roundrect><![endif]-->
<table width="600" role="presentation"><tr><td><a href="https://northwind.example/?_kx=TOKEN2.abc"><img src="https://cdn.northwind.example/logo.png?w=140&amp;h=40" width="140" alt="Northwind"></a></td></tr>
<tr><div style="padding:24px"><h1>Hello Spring collection</h1><p>Hi Sam,</p>
<p>Dear <b>Sam Rivera</b>, our Samsonite-tough duffel is back.</p>
<a href="https://ctrk.klclick.example/l/01HXYZ_TOKEN3" style="color:#fff;background:#111" title="Sam, shop now">Shop the drop</a></td></tr>
<tr><div style="font-size:11px">This email was sent to sampleinbox+northwind@gmail.com by Northwind Outdoor. <a href="https://manage.kmail-lists.example/unsubscribe?a=X&amp;k=TOKEN4">Unsubscribe</a> | <a href="https://manage.kmail-lists.example/update?k=TOKEN5">Manage preferences</a> | <a href="mailto:help@northwind.example">help@northwind.example</a></td></tr></table>
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

/** The review's probes: each must come out clean (or be refused). */
const probes = {
  slow: [
    '<div/>'.repeat(300_000),
    '<div></x>'.repeat(50_000),
    Array.from({ length: 20_000 }, (_, i) => `<body a${i}>`).join(''),
    Array.from({ length: 20_000 }, (_, i) => `<html a${i}>`).join(''),
    `<p ${Array.from({ length: 80_000 }, (_, i) => `a${i}`).join('/')}>`,
    `<p ${Array.from({ length: 80_000 }, (_, i) => `a${i}=""`).join('')}>`,
    '<b><i><u><s>'.repeat(1_000) + '</p>'.repeat(200_000)
  ],
  hidden: [
    '<img src="https://cdn.x.example/u/sampleinbox+northwind@gmail.com/a.png">',
    '<img src="https://cdn.x.example/u/sampleinbox%2Bnorthwind%40gmail.com/a.png">',
    '<p title="for sampleinbox%40gmail.com">x</p>',
    '<p>Write to sampleinbox+northwind%40gmail.com</p>',
    `<div style="background-image:url('https://x.example/a.png?e=sampleinbox%40gmail.com&n=Sam Rivera')">x</div>`,
    '<div style="--e: sampleinbox@gmail.com">x</div>',
    `<div style="font-family:'Sam Rivera'">x</div>`,
    '<style>/* sampleinbox@gmail.com */ .a{color:red}</style>',
    '<style>@import "https://x.example/f.css?k=TOKEN";</style>',
    `<div style="background-image:image-set('https://x.example/a.png?k=TOKEN' 1x)">x</div>`,
    '<p>Write to sampleinbox<wbr>@gmail.com or <span>sam</span>@example.com</p>',
    '<p><span>sampleinbox+north</span><span>wind@gmail.com</span></p>'
  ],
  reparse: [
    '<xmp>see https://x.example </xmp<>><img src=x onerror=alert(1)></xmp>',
    '<xmp>see </xmp\u{fff9}><img src=x onerror=alert(1)></xmp>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
    '<svg><a><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</p></noscript>',
    '<style>.a{}</sty/**/le><img src=x onerror=alert(1)></style>',
    '<pre>\n\nlinen</pre>',
    `<!DOCTYPE html PUBLIC '-//X"Y//EN' "about:legacy"><p>x</p>`
  ]
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

  it('removes every address, plain, in brackets, spaced or written out', () => {
    for (const text of [
      'Write to Sam <sam.rivera@example.com> today',
      'Write to mailto:help@northwind.example?subject=TOKEN today',
      'Write to help [at] northwind [dot] example today',
      'Write to sam(at)example.com today',
      'Write to help {at} northwind.example today',
      'Write to s.a.m.p.l.e.inbox@googlemail.com today',
      'Write to postmaster@localhost today',
      'Write to sampleinbox at gmail dot com today',
      'Write to help @ northwind.example today',
      'Write to help\u{ff20}northwind.example today',
      'Write to sampleinbox+northwind%40gmail.com today'
    ])
      expect(cleanEmailText(text, me)).toBe('Write to today')
  })

  it('removes every link, also without a scheme, wrapped or with brackets', () => {
    for (const text of [
      'Shop northwind.example/r?t=TOKEN now',
      'Shop www.northwind.example?ref=TOKEN now',
      'Shop //x.example/c?t=TOKEN now',
      'Shop https://x.example/a(b)?t=TOKEN now',
      'Shop https://x.example/l?u=abc&\nt=TOKEN now'
    ])
      expect(cleanEmailText(text, me)).toBe('Shop now')
    expect(cleanEmailText('Visit northwind.example today', me)).toBe(
      'Visit northwind.example today'
    )
  })

  it("removes the inbox's own +alias and Gmail dot variants", () => {
    expect(cleanEmailText('Hi sample.inbox+northwind, welcome', me)).toBe(
      'Hi there, welcome'
    )
    expect(cleanEmailText('Your login: SampleInbox+Cedar', me)).toBe(
      'Your login:'
    )
  })

  it('turns a greeting by name into "there"', () => {
    const greets: [string, string][] = [
      ['Hi Sam,', 'Hi there,'],
      ['Hey Sam!', 'Hey there!'],
      ['Dear Sam Rivera,', 'Hi there,'],
      ['Hello, Jordan,\nNew linen.', 'Hello there,\nNew linen.'],
      ['Hi\u{a0}Sam\u{a0}!', 'Hi there!'],
      ['hi sam, ready?', 'hi there, ready?'],
      ['Thanks, Sam!', 'Thanks!'],
      ["Sam's picks", 'picks']
    ]
    for (const [text, clean] of greets)
      expect(cleanEmailText(text, me)).toBe(clean)
  })

  it('keeps greetings without a person, products and the brand', () => {
    for (const text of [
      'Hi there',
      'Hello friend',
      'Hey everyone!',
      'Hello Spring collection',
      'Hello Spring!',
      'Hello Kitty!',
      'Hey Dude',
      'Hello Halloween!',
      'Hello Paris!',
      'Hey Coffee Lovers,',
      'Dear Diary,',
      'Our new linen says hello, Jordan, to summer',
      'This message was sent to celebrate our birthday.',
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
    const text = cleanEmailText(`${'linen '.repeat(20_000)}end`, me)
    expect(text.length).toBeLessThanOrEqual(10_000)
    expect(text.endsWith('linen')).toBe(true)
    const subject = cleanEmailSubject('Hi Sam, '.repeat(40), me)
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

  it('uses stored copies when given, and empties any other remote image', () => {
    const images = [
      {
        ref: 'https://cdn.northwind.example/logo.png?w=140&amp;h=40',
        path: 'img/abc.png'
      }
    ]
    const out = cleanEmailHtml(
      `${klaviyo}<img src="https://cdn.x.example/o/eyTOKEN/a.png" width="600">`,
      me,
      { images }
    )
    expect(out).toContain('<img src="img/abc.png" width="140"')
    expect(out).toContain('<img src="" width="600">')
  })

  it('drops open pixels and keeps spacers and divider lines', () => {
    const out = cleanEmailHtml(
      `<img src="https://cdn.x.example/open.gif"><img src="https://x.example/a.gif" width="0" height="0"><img src="https://x.example/b.gif" style="width:1px;height:1px"><img src="https://beacon.x.example/b.png" width="600"><img src="//trk.x.example/o?u=TOKEN"><img src="https://x.example/spacer.gif" width="1" height="20"><img src="https://x.example/line.png" width="100%" height="1"><img src="javascript:track()" width="600">`,
      me
    )!
    expect(out).toBe(
      '<html><head></head><body><img src="https://x.example/spacer.gif" width="1" height="20"><img src="https://x.example/line.png" width="100%" height="1"><img src="" width="600"></body></html>'
    )
  })

  it('cleans image addresses, srcsets and CSS of tokens', () => {
    const out = cleanEmailHtml(
      `<img src="//cdn.x.example/a.png?t=TOKEN" srcset="https://x.example/a,b.png?t=TOKEN 1x, https://x.example/c.png 2x"><div style="background:url(https://x.example/bg.png?t=TOKEN) #fff">x</div>`,
      me
    )!
    expect(out).toContain(
      '<img src="//cdn.x.example/a.png" srcset="https://x.example/a,b.png 1x, https://x.example/c.png 2x">'
    )
    expect(out).toContain(
      'style="background:url(https://x.example/bg.png) #fff"'
    )
  })

  it('removes the person from links, styles and words split by tags', () => {
    for (const probe of [
      ...probes.hidden,
      '<meta name="x" content="https://x.example/?t=TOKEN">',
      '<p title="see https://x.example/a(b)?t=TOKEN">x</p>'
    ]) {
      const out = cleanEmailHtml(probe, me)
      expect(out, probe).not.toBeNull()
      expect(out, probe).not.toMatch(leaks)
    }
  })

  it('never lets a greeting carry over into the next block', () => {
    for (const [html, kept] of [
      ['<p>Say hello</p><span>Linen</span>', '<span>Linen</span>'],
      ['<p>Hello</p><span>Linen,</span>', '<span>Linen,</span>']
    ])
      expect(cleanEmailHtml(html!, me)).toContain(kept)
    expect(
      cleanEmailHtml('<header>Hello</header><main>Linen,</main>', me)
    ).toContain('<main>Linen,</main>')
  })

  it('writes HTML that reads back as itself', () => {
    for (const probe of [...probes.reparse, ...probes.hidden, klaviyo]) {
      const out = cleanEmailHtml(probe, me)
      if (out === null) continue
      expect(out, probe).not.toMatch(/<img[^>]*onerror|<set|<svg|<math/i)
      expect(cleanEmailHtml(out, me), probe).toBe(out)
    }
    // Raw text is written escaped in a <pre>; a style can never close early.
    const body = (html: string) =>
      cleanEmailHtml(html, me)!.replace(/^.*<body>|<\/body>.*$/gs, '')
    expect(body(probes.reparse[0]!)).toBe(
      '<pre>see &lt;/xmp&gt;&lt;img src=x onerror=alert(1)&gt;</pre>'
    )
    expect(cleanEmailHtml(probes.reparse[5]!, me)).toContain(
      '<style>.a{}/style>img src=x onerror=alert(1)></style>'
    )
    expect(body(probes.reparse[6]!)).toBe('<pre>\n\nlinen</pre>')
  })
})

describe('cleanEmail', () => {
  it('cleans all four parts, and cleaning twice changes nothing', () => {
    for (const email of [shopify, { ...shopify, html: klaviyo }]) {
      const { changed, ...parts } = cleanEmail(email, me)
      expect(changed).toBe(true)
      expect(cleanEmail(parts, me)).toEqual({ ...parts, changed: false })
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
      '\u{a0}',
      'Hi ',
      'Hi Al, ',
      'sent to ',
      'sam [at] ',
      'a at ',
      'url(https://',
      'x.example/',
      '/*'
    ]) {
      // The address makes the tidying run over the whole run too.
      const text = `${run.repeat(40_000 / run.length)}x sam@example.com,`
      cleanEmailText(text, me)
      cleanEmailHtml(`<p style="${text}" alt="${text}">${text}</p>`, me)
      cleanEmailHtml(`<style>${text}</style>`, me)
    }
    // Huge: half a megabyte of newsletters at once.
    expect(cleanEmailHtml(klaviyo.repeat(250), me)).not.toMatch(person)
    expect(
      cleanEmail({ ...shopify, text: shopify.text.repeat(1_500) }, me).text
    ).not.toMatch(person)
    expect(Date.now() - started).toBeLessThan(3_000)
  })

  it('refuses HTML the parser would be slow on, and reads real nesting', () => {
    for (const probe of [
      ...probes.slow,
      '<div>'.repeat(100_000),
      `<p ${'a1 '.repeat(5_000)}>`
    ]) {
      const started = Date.now()
      expect(cleanEmailHtml(probe, me)).toBeNull()
      expect(Date.now() - started, probe.slice(0, 30)).toBeLessThan(1_500)
    }
    const deep = cleanEmailHtml(`${'<table><tr><td>'.repeat(60)}Hi Sam,`, me)
    expect(deep).toContain('<td>Hi there,</td>')
  })
})

describe('inboxIdentity', () => {
  it('is the inbox address and the subscriber names from the settings', () => {
    expect(
      inboxIdentity(
        inboxConfig({ INBOX_SUBSCRIBER_NAMES: ' Sam  Rivera , ,S ' })
      )
    ).toEqual({ addresses: ['capture@inbox.example'], names: ['Sam Rivera'] })
    // The Gmail address counts while the inbox cannot be read yet.
    expect(
      inboxIdentity(
        inboxConfig({
          INBOX_TRANSPORT: 'gmail_imap',
          INBOX_IMAP_USER: 'SampleInbox@gmail.com'
        })
      )
    ).toEqual({ addresses: ['sampleinbox@gmail.com'], names: [] })
  })
})
