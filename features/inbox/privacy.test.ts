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
  settle,
  type InboxIdentity
} from './privacy'

// Made up: a Gmail research inbox that subscribed as "Sam Rivera".
const me: InboxIdentity = {
  addresses: ['sampleinbox@gmail.com'],
  names: ['Sam Rivera']
}
const person = /\b(?:sam|rivera)\b/i
/** What must never be left: the person, the inbox, a token, a live tag. */
const leaks =
  /\b(?:sam|rivera)\b|sampleinbox|samplein|ail\.com|%40|TOKEN|<img[^>]*onerror|javascript|<script|<noscript|<svg|<math|<set/i
/** The words of the body only. */
const body = (html: string | null) =>
  html?.replace(/^.*<body>|<\/body>.*$/gs, '') ?? null

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
/** Its stored pictures (`inbox_message_images`). */
const images = [
  {
    ref: 'https://cdn.northwind.example/logo.png?w=140&amp;h=40',
    path: 'img/aa.png'
  },
  { ref: 'https://cdn.northwind.example/bg.png?kx=abc123', path: 'img/bb.png' }
]

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

/** The code reviews' probes: each must come out clean, or be refused. */
const probes = {
  slow: [
    '<div/>'.repeat(300_000),
    '<div></x>'.repeat(50_000),
    Array.from({ length: 20_000 }, (_, i) => `<body a${i}>`).join(''),
    Array.from({ length: 20_000 }, (_, i) => `<html a${i}>`).join(''),
    `<p ${Array.from({ length: 80_000 }, (_, i) => `a${i}`).join('/')}>`,
    `<p ${Array.from({ length: 80_000 }, (_, i) => `a${i}=""`).join('')}>`,
    '<b><i><u><s>'.repeat(1_000) + '</p>'.repeat(200_000),
    `<p${Array.from({ length: 999 }, (_, i) => ` xx${i}=""`).join('')}>`.repeat(
      665
    ),
    '<div>'.repeat(100_000),
    `<p ${'a1 '.repeat(5_000)}>`
  ],
  hidden: [
    '<img src="https://cdn.x.example/u/sampleinbox+northwind@gmail.com/a.png">',
    '<img src="https://cdn.x.example/u/sampleinbox/a.png?utm_content=sampleinbox">',
    '<img alt="Photo for sampleinbox" title="for sampleinbox%40gmail.com">',
    '<p>Write to sampleinbox+northwind%40gmail.com or sampleinbox%2540gmail.com</p>',
    `<div style="background-image:url('https://x.example/a.png?e=sampleinbox%40gmail.com&n=Sam Rivera')">x</div>`,
    '<div style="--e: sampleinbox@gmail.com">x</div>',
    `<div style="font-family:'Sam Rivera'">x</div>`,
    '<style>/* sampleinbox@gmail.com */ .sampleinbox{color:red}</style>',
    '<style>@import "https://x.example/f.css?k=TOKEN";</style>',
    `<div style="background-image:image-set('https://x.example/a.png?k=TOKEN' 1x)">x</div>`,
    '<div style="background:\\75rl(https://x.example/a.png?k=TOKEN)">x</div>',
    '<div style="background:url\\28 https://x.example/a.png?k=TOKEN\\29">x</div>',
    `<div style="background:url('https://x.example/a(b).png?k=TOKEN')">x</div>`,
    '<p>Write to sampleinbox<wbr>@gmail.com or <span>sam</span>@example.com</p>',
    '<p><span>sampleinbox+north</span><span>wind@gmail.com</span></p>',
    '<p>samplein<b>box@gm</b>ail.com</p>',
    '<p>sample<span>inbox@gmail.com</span></p>',
    '<p>You are subscribed as sampleinbox&#8203;@gmail.com.</p>',
    '<p>Update preferences for sampleinbox@&zwnj;gmail.com</p>',
    '<p>Write to sampleinbox&#8288;@gmail.com or sampleinbox&#65279;@gmail.com</p>',
    '<p>Write to sampleinbox&nbsp;@&nbsp;gmail.com</p>',
    '<p>Write to sampleinbox<br>@gmail.com</p>',
    '<p>Write to sample&shy;inbox@gmail.com</p>',
    '<p>This email was sent to <sampleinbox@gmail.com>.</p>',
    '<p>From "Sam Rivera" <sampleinbox@gmail.com></p><p>Linen</p>',
    '<p sampleinbox@gmail.com>x</p><p sam="1">y</p>',
    '<p href="#sampleinbox@gmail.com">x</p>',
    '<!DOCTYPE html SYSTEM "sampleinbox@gmail.com"><p>x</p>',
    '<template><p>Hi Sam, sampleinbox@gmail.com</p></template>',
    '<meta name="x" content="https://x.example/?t=TOKEN">',
    '<p title="see https://x.example/a(b)?t=TOKEN">x</p>',
    '<p>Thanks, \u{405}am!</p>',
    '<script>alert("sampleinbox")</script><noscript><p>x</p></noscript>',
    '<svg><a><set attributeName="href" to="javascript:alert(1)"/></a></svg>'
  ],
  reparse: [
    '<xmp>see https://x.example </xmp<>><img src=x onerror=alert(1)></xmp>',
    '<xmp>see </xmp\u{fff9}><img src=x onerror=alert(1)></xmp>',
    '<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math>',
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</p></noscript>',
    '<style>.a{}</sty/**/le><img src=x onerror=alert(1)></style>',
    '<pre>\n\nlinen</pre>',
    '<listing>\n\n\nx</listing>',
    `<!DOCTYPE html PUBLIC '-//X"Y//EN' "about:legacy"><p>x</p>`,
    // Found by fuzzing: the first cleaning reads back differently (nested
    // links from a table, a frameset email that gains a body).
    '<p><a href=x><table><a href=x>y</a></table></a></p>',
    '<frameset><col>'
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

  it('removes every address, plain, in brackets, spaced, hidden or written out', () => {
    for (const text of [
      'Write to Sam <sam.rivera@example.com> today',
      'Write to mailto:help@northwind.example?subject=TOKEN today',
      'Write to help [at] northwind [dot] example today',
      'Write to sam(at)example.com today',
      'Write to help {at} northwind.example today',
      'Write to s.a.m.p.l.e.inbox@googlemail.com today',
      'Write to postmaster@localhost today',
      'Write to sampleinbox at gmail dot com today',
      'Write to sampleinbox at gmail.com today',
      'Write to help @ northwind.example today',
      'Write to help\u{ff20}northwind.example today',
      'Write to sampleinbox+northwind%40gmail.com today',
      'Write to sampleinbox%2540gmail.com today',
      'Write to sampleinbox\u{200b}@gmail.com today',
      'Write to sample\u{ad}inbox@gmail.com today',
      'Write to sampleinbox\u{a0}@\u{a0}gmail.com today',
      'Write to sampleinbox\n@gmail.com today'
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
    for (const text of [
      'Visit northwind.example today',
      'Shop at northwind.example today'
    ])
      expect(cleanEmailText(text, me)).toBe(text)
  })

  it("removes the inbox's local part, with or without +alias or Gmail dots", () => {
    expect(cleanEmailText('Hi sample.inbox+northwind, welcome', me)).toBe(
      'Hi there, welcome'
    )
    expect(cleanEmailText('Your login: SampleInbox+Cedar', me)).toBe(
      'Your login:'
    )
    expect(cleanEmailText('A gift for sampleinbox', me)).toBe('A gift for')
    expect(cleanEmailSubject('sampleinbox, 20% off just for you', me)).toBe(
      '20% off just for you'
    )
    // A short local part may be a word: alone it stays.
    const sample = { addresses: ['capture@inbox.example'], names: [] }
    expect(cleanEmailText('Capture the moment, capture+cedar', sample)).toBe(
      'Capture the moment,'
    )
  })

  it('turns a greeting with the inbox\'s name into "there"', () => {
    const greets: [string, string][] = [
      ['Hi Sam,', 'Hi there,'],
      ['Hey Sam!', 'Hey there!'],
      ['Dear Sam Rivera,', 'Hi there,'],
      ['Hi\u{a0}Sam\u{a0}!', 'Hi there!'],
      ['hi sam, ready?', 'hi there, ready?'],
      ['Hi sampleinbox!', 'Hi there!'],
      ['Thanks, Sam!', 'Thanks!'],
      ['Thanks, \u{405}am!', 'Thanks!'],
      ["Sam's picks", 'picks']
    ]
    for (const [text, clean] of greets)
      expect(cleanEmailText(text, me)).toBe(clean)
  })

  it('keeps other greetings, products, places and the brand', () => {
    for (const text of [
      'Hi there',
      'Hello friend',
      'Hey everyone!',
      'Hello Spring collection',
      'Hello Kitty!',
      'Hello Paris,',
      'Hello Tokyo,\nNew store',
      'Hey Coffee,',
      'Hello, Jordan,',
      'Dear Diary,',
      'This message was sent to celebrate our birthday.',
      'Our Samsonite duffel and the Sampler Pack',
      'Follow @northwind or save 20% @ checkout',
      'Dear valued customer,'
    ])
      expect(cleanEmailText(text, me)).toBe(text)
    const keep = { keep: ['Rivera Goods'] }
    expect(
      cleanEmailText('New at Rivera Goods: linen. Thanks, Rivera!', me, keep)
    ).toBe('New at Rivera Goods: linen. Thanks!')
  })

  it('reads composed and decomposed letters alike (NFC)', () => {
    const zoe = { addresses: [], names: ['Zo\u{eb}'] }
    expect(cleanEmailText('Thanks, Zoe\u{308}!', zoe)).toBe('Thanks!')
  })

  it('cleans until nothing changes (a tidied address goes next pass)', () => {
    expect(cleanEmailText('Hi Sam, write help@()northwind.example', me)).toBe(
      'Hi there, write'
    )
  })

  it('reads a bounded part and cuts on a whole word', () => {
    const text = cleanEmailText(`${'linen '.repeat(20_000)}end`, me)
    expect(text.length).toBeLessThanOrEqual(10_000)
    expect(text.endsWith('linen')).toBe(true)
    const half = { limits: { readFactor: 0.5 } }
    expect(
      cleanEmailText('linen '.repeat(2_000), me, half).length
    ).toBeLessThan(5_001)
    const subject = cleanEmailSubject('Hi Sam, '.repeat(40), me)
    expect(subject.length).toBeLessThanOrEqual(200)
    expect(subject.endsWith('Hi there,')).toBe(true)
    // Never half a character, and one line.
    const emoji = cleanEmailSubject(`${'a'.repeat(199)}\u{1f600}b`, me)
    expect([emoji.length, emoji.isWellFormed()]).toEqual([199, true])
    expect(cleanEmailSubject('Spring\n\n  sale', me)).toBe('Spring sale')
    expect(cleanEmailPreview('Spring\n\n  sale', me)).toBe('Spring sale')
  })

  it('removes names written in Cyrillic or Greek, in any case', () => {
    for (const name of ['Анна', 'Дмитрий', 'Μαρία', 'Ζήνων', 'Λήδα', 'Юлия']) {
      const them = { addresses: [], names: [name] }
      expect(cleanEmailText(`Hi ${name}, thanks ${name}!`, them), name).toBe(
        'Hi there, thanks!'
      )
      expect(cleanEmailSubject(`${name}, 20% off`, them), name).toBe('20% off')
      expect(cleanEmailText(`Hi ${name.toUpperCase()},`, them), name).toBe(
        'Hi there,'
      )
    }
  })

  it('reads full-width letters and at signs as plain ones', () => {
    expect(cleanEmailText('Thanks, \u{ff33}\u{ff41}\u{ff4d}!', me)).toBe(
      'Thanks!'
    )
    expect(
      cleanEmailText('Write to help\u{fe6b}northwind.example today', me)
    ).toBe('Write to today')
  })
})

describe('cleanEmailHtml', () => {
  const html = cleanEmailHtml(klaviyo, me, { images })!

  it('removes the person, every link target, comments, forms and pixels', () => {
    expect(html).not.toMatch(leaks)
    // Only our own doctype may name a web address.
    expect(html.replace(/^<!DOCTYPE[^>]*>/, '')).not.toMatch(
      /_kx|klclick|kmail|mailto|<!--|roundrect|<form|<input|data-email|onload|sent to|https?:/
    )
    expect(html.match(/href="[^"]+"/g)).toBeNull()
  })

  it('keeps the look: doctype, structure, styles, stored pictures and words', () => {
    expect(html).toMatch(/^<!DOCTYPE html PUBLIC "-\/\/W3C\/\/DTD XHTML 1\.0/)
    for (const kept of [
      '<title>Hi there, spring is here</title>',
      '.hero{background:url("img/bb.png")}}',
      '<div style="display:none">Hi there, 20% off ends tonight</div>',
      '<img src="img/aa.png" width="140" alt="Northwind">',
      '<h1>Hello Spring collection</h1><p>Hi there,</p>',
      '<p>Hi <b>there</b>, our Samsonite-tough duffel is back.</p>',
      '<a href="" style="color:#fff;background:#111" title="shop now">Shop the drop</a>',
      '<a href="">Unsubscribe</a> | <a href="">Manage preferences</a>',
      '<div><p>Rate us</p></div>'
    ])
      expect(html).toContain(kept)
  })

  it('shows only stored pictures and small raster data images', () => {
    expect(
      body(
        cleanEmailHtml(
          '<img src="https://cdn.x.example/a.png"><img src="cid:a@b"><img src="data:image/png;base64,iVBO"><img src="data:image/svg+xml,&lt;svg&gt;"><img src="data:text/html,x"><img src="img/aa.png" srcset="img/aa.png 1x, https://x.example/a,b.png 2x">',
          me,
          { images }
        )
      )
    ).toBe(
      '<img src=""><img src=""><img src="data:image/png;base64,iVBO"><img src=""><img src=""><img src="img/aa.png" srcset="img/aa.png 1x">'
    )
  })

  it('drops open pixels and keeps spacers and divider lines', () => {
    expect(
      body(
        cleanEmailHtml(
          `<img src="https://cdn.x.example/open.gif"><img src="https://x.example/a.gif" width="0" height="0"><img src="https://x.example/b.gif" style="width:1px;height:1px"><img src="https://beacon.x.example/b.png" width="600"><img src="//trk.x.example/o?u=TOKEN"><img src="https://x.example/spacer.gif" width="1" height="20"><img src="https://x.example/line.png" width="100%" height="1">`,
          me
        )
      )
    ).toBe(
      '<img src="" width="1" height="20"><img src="" width="100%" height="1">'
    )
  })

  it('removes the person from tags, names, links, styles and split words', () => {
    for (const probe of probes.hidden) {
      const out = cleanEmailHtml(probe, me)
      expect(out, probe).not.toBeNull()
      expect(out, probe).not.toMatch(leaks)
    }
    expect(body(cleanEmailHtml(probes.hidden[24]!, me))).toBe(
      '<p>From "" </p><p>Linen</p>'
    )
  })

  it('never lets a greeting carry over into the next block', () => {
    for (const [html, kept] of [
      ['<p>Hello</p><span>Sam,</span>', '<span>,</span>'],
      ['<header>Hello</header><main>Linen,</main>', '<main>Linen,</main>']
    ])
      expect(cleanEmailHtml(html!, me)).toContain(kept)
  })

  it('writes our own doctype for the layout mode, none for quirks mode', () => {
    const start = (html: string) => cleanEmailHtml(html, me)!.slice(0, 40)
    expect(start('<!DOCTYPE html><p>x</p>')).toMatch(/^<!DOCTYPE html><html>/)
    expect(
      start('<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">x')
    ).toMatch(/^<html>/)
    expect(start(probes.hidden[27]!)).toMatch(/^<!DOCTYPE html><html>/)
    expect(cleanEmailHtml('<meta http-equiv="refresh" content="0">', me)).toBe(
      '<html><head></head><body></body></html>'
    )
  })

  it('writes HTML that reads back as itself', () => {
    for (const probe of [...probes.reparse, ...probes.hidden, klaviyo]) {
      const out = cleanEmailHtml(probe, me)
      expect(out, probe).not.toBeNull()
      expect(out, probe).not.toMatch(/<img[^>]*onerror|<set|<svg|<math/i)
      expect(cleanEmailHtml(out!, me), probe).toBe(out)
    }
    // Raw text is written escaped in a <pre>; a style can never close early.
    expect(body(cleanEmailHtml(probes.reparse[0]!, me))).toBe(
      '<pre>see &lt;/xmp&gt;&lt;img src=x onerror=alert(1)&gt;</pre>'
    )
    expect(cleanEmailHtml(probes.reparse[4]!, me)).toContain(
      '<style>.a{}/style>img src=x onerror=alert(1)></style>'
    )
    expect(body(cleanEmailHtml(probes.reparse[5]!, me))).toBe(
      '<pre>\n\nlinen</pre>'
    )
    expect(body(cleanEmailHtml(probes.reparse[6]!, me))).toBe(
      '<pre>\n\n\nx</pre>'
    )
  })

  it('writes only plain tag and attribute names, and href only on links', () => {
    for (const [html, out] of [
      ['<p>Hi <abc!def>Linen</abc!def></p>', '<p>Hi Linen</p>'],
      ['<p><sampleinbox>Linen</sampleinbox></p>', '<p>Linen</p>'],
      ['<p a!b="1" class="x">Linen</p>', '<p class="x">Linen</p>'],
      ['<div href="https://x.example/?t=1">Linen</div>', '<div>Linen</div>'],
      [
        `<p title='say "hi"'>Linen</p>`,
        '<p title="say &quot;hi&quot;">Linen</p>'
      ]
    ])
      expect(body(cleanEmailHtml(html!, me)), html).toBe(out)
  })

  it('reads <br> as a line break between the pieces of a block', () => {
    for (const [html, out] of [
      // Separate lines are not one word, and no greeting crosses them.
      ['<p>Sa<br>m</p>', '<p>Sa<br>m</p>'],
      ['<p>Hello<br>Sam,</p>', '<p>Hello<br>,</p>'],
      // An address cut by a tag goes with the whole word around it.
      [
        '<p>Write to:sample#in<b>box@gmail.com</b> today</p>',
        '<p>Write <b></b> today</p>'
      ]
    ])
      expect(body(cleanEmailHtml(html!, me)), html).toBe(out)
  })

  it('accepts a result only once cleaning it again changes nothing', () => {
    expect(settle('a', (s) => s)).toBe('a')
    expect(settle('a', () => 'b')).toBe('b')
    expect(settle('a', (s) => `${s}!`)).toBeNull()
    expect(settle(null, (s) => s)).toBeNull()
  })
})

describe('cleanEmail', () => {
  it('cleans all four parts, and cleaning twice changes nothing', () => {
    for (const email of [shopify, { ...shopify, html: klaviyo }]) {
      const { changed, htmlRefused, ...parts } = cleanEmail(email, me, {
        images
      })
      expect(changed).toBe(true)
      expect(htmlRefused).toBe(false)
      expect(cleanEmail(parts, me, { images })).toEqual({
        ...parts,
        htmlRefused: false,
        changed: false
      })
      expect(JSON.stringify(parts)).not.toMatch(person)
    }
  })

  it('says when the HTML was refused', () => {
    const refused = cleanEmail({ ...shopify, html: probes.slow[0]! }, me)
    expect(refused).toMatchObject({ html: null, htmlRefused: true })
  })

  it('stays linear on hostile input', () => {
    const started = Date.now()
    // Long runs: a pattern that rescans a run takes many seconds on these.
    for (const run of [
      'a',
      '@',
      'a@',
      'a.',
      ' ',
      '\u{a0}',
      '\u{200b}',
      'Hi ',
      'Hi Al, ',
      'sent to ',
      'sam [at] ',
      'a at ',
      'url(https://',
      'x.example/',
      '/*',
      '\\75'
    ]) {
      // The address makes the tidying run over the whole run too.
      const text = `${run.repeat(40_000 / run.length)}x sam@example.com,`
      cleanEmailText(text, me)
      expect(
        cleanEmailHtml(`<p style="${text}" alt="${text}">${text}</p>`, me)
      ).not.toBeNull()
      expect(cleanEmailHtml(`<style>${text}</style>`, me)).not.toBeNull()
    }
    // Huge: half a megabyte of newsletters, and 800 KB of words followed by
    // thousands of small texts (each once read the words before it).
    expect(cleanEmailHtml(klaviyo.repeat(250), me)).not.toMatch(person)
    const crowd = `<p>${'x '.repeat(400_000)}${'<b>a@b.cd</b> <b>Sam</b> '.repeat(6_000)}</p>`
    const crowded = cleanEmailHtml(crowd, me)
    expect(crowded).not.toBeNull()
    expect(crowded).not.toMatch(/a@b|b\.cd|Sam/)
    expect(
      cleanEmail({ ...shopify, text: shopify.text.repeat(1_500) }, me).text
    ).not.toMatch(person)
    expect(Date.now() - started).toBeLessThan(8_000)
  })

  it('refuses HTML the parser would be slow on, fast', () => {
    for (const probe of probes.slow) {
      const started = Date.now()
      expect(cleanEmailHtml(probe, me)).toBeNull()
      expect(Date.now() - started, probe.slice(0, 30)).toBeLessThan(1_500)
    }
    const deep = cleanEmailHtml(`${'<table><tr><td>'.repeat(60)}Hi Sam,`, me)
    expect(deep).toContain('<td>Hi there,</td>')
  })

  it('refuses HTML over each limit', () => {
    expect(cleanEmailHtml(klaviyo, me)).not.toBeNull()
    for (const limits of [
      { htmlMs: -1 },
      { tags: 5 },
      { html: 100 },
      { attributeWork: 3 },
      { depth: 3 }
    ])
      expect(
        cleanEmailHtml(klaviyo, me, { limits }),
        Object.keys(limits)[0]
      ).toBeNull()
    // 1 MB: far above any newsletter (Gmail clips at 102 KB).
    expect(cleanEmailHtml(klaviyo.repeat(700), me)).toBeNull()
    // Comments split the words too, so they count as tags.
    const started = Date.now()
    expect(cleanEmailHtml(`<p>${'S<!---->'.repeat(60_000)}</p>`, me)).toBeNull()
    expect(Date.now() - started).toBeLessThan(1_500)
    // Escaping may grow the cleaned HTML past 1 MB: it is still read back.
    expect(cleanEmailHtml(`<p>${'&'.repeat(900_000)}</p>`, me)).not.toBeNull()
  })

  it('checks its one deadline at every step of every round', () => {
    // A clock that has run out at one kind of check only: each check
    // alone stops the cleaning.
    for (const check of ['scan', 'element', 'walk', 'block', 'writer']) {
      const clock = (at: string) => (at === check ? Infinity : 0)
      expect(cleanEmailHtml(klaviyo, me, { clock }), check).toBeNull()
    }
    // Time passes at each check; the first round alone fits in the time,
    // both rounds do not: the deadline is shared.
    let ticks = 0
    const clock = () => ticks++
    expect(cleanEmailHtml(klaviyo, me, { clock })).not.toBeNull()
    const both = ticks
    ticks = 0
    expect(
      cleanEmailHtml(klaviyo, me, {
        clock,
        limits: { htmlMs: Math.round(both * 0.75) }
      })
    ).toBeNull()
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
