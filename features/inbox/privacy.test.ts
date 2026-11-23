// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { inboxConfig, personalisedImageHosts } from './config'
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
      'Write to sampleinbox&#64gmail.com today',
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

  it('shows only stored pictures', () => {
    expect(
      body(
        cleanEmailHtml(
          '<img src="https://cdn.x.example/a.png"><img src="cid:a@b"><img src="data:image/png;base64,iVBO"><img src="data:image/svg+xml,&lt;svg&gt;"><img src="data:text/html,x"><img src="img/aa.png" srcset="img/aa.png 1x, https://x.example/a,b.png 2x">',
          me,
          { images }
        )
      )
    ).toBe(
      '<img src=""><img src=""><img src=""><img src=""><img src=""><img src="img/aa.png" srcset="img/aa.png 1x">'
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
    const crowd = `<p>${'x '.repeat(400_000)}${'<b>a@b.example</b> <b>Sam</b> '.repeat(6_000)}</p>`
    const crowded = cleanEmailHtml(crowd, me)
    expect(crowded).not.toBeNull()
    expect(crowded).not.toMatch(/a@b|b\.cd|Sam/)
    expect(
      cleanEmail({ ...shopify, text: shopify.text.repeat(1_500) }, me).text
    ).not.toMatch(person)
    expect(Date.now() - started).toBeLessThan(8_000)
  }, 15_000)

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
      { ms: -1 },
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
    // A cleaned copy is never longer than an email may be, so cleaning it
    // again never refuses it; one that escaping made longer is refused.
    expect(cleanEmailHtml(`<p>${'&'.repeat(900_000)}</p>`, me)).toBeNull()
    const fit = cleanEmailHtml(`<p>${'&'.repeat(150_000)}</p>`, me)!
    expect(cleanEmailHtml(fit, me)).toBe(fit)
  })

  it('checks its one deadline at every step of every round', () => {
    // A clock that has run out at one kind of check only: each check
    // alone stops the cleaning.
    for (const check of ['scan', 'element', 'walk', 'block', 'writer']) {
      const clock = (at: string) => (at === check ? Infinity : 0)
      expect(cleanEmailHtml(klaviyo, me, { clock }), check).toBeNull()
    }
    // Time passes at each check; the first round alone fits in the time,
    // both rounds do not: the deadline is shared (also by an email with no
    // words, where only the tree's own checks read it).
    for (const html of [klaviyo, '<div></div>'.repeat(400)]) {
      let ticks = 0
      const clock = () => ticks++
      expect(cleanEmailHtml(html, me, { clock })).not.toBeNull()
      const both = ticks
      ticks = 0
      expect(
        cleanEmailHtml(html, me, {
          clock,
          limits: { ms: Math.round(both * 0.75) }
        }),
        html.slice(0, 20)
      ).toBeNull()
    }
  })
})

describe('what the third review found', () => {
  const sample = {
    addresses: ['capture@inbox.example', 'samriv@example.com'],
    names: []
  }

  it('removes every address shape, hidden or not', () => {
    for (const text of [
      'sampleinbox%25252540gmail.com',
      'sampleinbox%2525252525252540gmail.com',
      'john.doe@[10.0.0.1]',
      '"john doe"@example.com',
      'john!doe@example.com',
      'help [@] northwind.example',
      'john\u{34f}@doe.example',
      'sampleinbox+north.wind',
      'sampleinbox.Thanks',
      'sampleinbox_shop'
    ])
      expect(cleanEmailText(`Write to ${text} today`, me), text).not.toMatch(
        /sampleinbox|john|doe|help|%/
      )
    // A short local part goes next to its own domain, however spaced.
    for (const text of [
      'capture at inbox.example',
      'capture [@] inbox.example',
      'capture @ inbox . example',
      'capture &#64; inbox.example',
      'samriv at example',
      'samriv [at] example',
      'samriv   @   example.com',
      'samriv&#64;example.com'
    ])
      expect(cleanEmailText(`Write to ${text} today`, sample), text).toBe(
        'Write to today'
      )
  })

  it('removes a name hidden by invisible or styled characters', () => {
    for (const text of [
      'Thanks, Sa\u{34f}m!',
      'Thanks, Sa\u{fe0f}m!',
      'Thanks, Sa\u{e0020}m!',
      'Thanks, Sa\u{1d173}m!',
      'Thanks, \u{1d412}\u{1d41a}\u{1d426}!'
    ])
      expect(cleanEmailText(text, me), text).toBe('Thanks!')
    expect(cleanEmailText('Hi \u{1d412}\u{1d41a}\u{1d426},', me)).toBe(
      'Hi there,'
    )
    const irish = { addresses: [], names: ["O'Brien"] }
    expect(cleanEmailText('Thanks, O\u{2019}Brien!', irish)).toBe('Thanks!')
  })

  it('removes names in scripts written without spaces', () => {
    expect(
      cleanEmailText(
        '\u{5c71}\u{7530}\u{592a}\u{90ce}\u{69d8}\u{3001}\u{3053}\u{3093}\u{306b}\u{3061}\u{306f}',
        {
          addresses: [],
          names: ['\u{5c71}\u{7530}\u{592a}\u{90ce}']
        }
      )
    ).toBe('\u{69d8}\u{3001}\u{3053}\u{3093}\u{306b}\u{3061}\u{306f}')
    expect(
      cleanEmailText(
        '\u{ae40}\u{bbfc}\u{c218}\u{b2d8}, \u{c548}\u{b155}\u{d558}\u{c138}\u{c694}',
        {
          addresses: [],
          names: ['\u{ae40}\u{bbfc}\u{c218}']
        }
      )
    ).toBe('\u{b2d8}, \u{c548}\u{b155}\u{d558}\u{c138}\u{c694}')
  })

  it('keeps delivery promises that only say "you"', () => {
    for (const text of [
      'Delivered to you in two days.',
      'Delivered to you in 2\u{2013}3 working days.',
      'Sent to you the next morning.',
      'Delivered to you every Friday'
    ])
      expect(cleanEmailText(text, me)).toBe(text)
  })

  it('refuses text that does not settle', () => {
    expect(
      cleanEmailText('Write sa(sa(sa(sa(sam)m)m)m)mpleinbox now', me)
    ).toBe('')
  })

  it('shows only real raster data images and plain srcset sizes', () => {
    expect(
      body(
        cleanEmailHtml(
          '<img src="data:image/png,hello sampleinbox@gmail.com Sam Rivera"><img src="data:image/png;name=sampleinbox@gmail.com;base64,AAAA"><video poster="data:image/gif,Sam Rivera"></video><img srcset="data:image/png;base64,AAAA 1x sampleinbox@gmail.com"><img srcset="img/aa.png 1x Sam Rivera, img/aa.png 2x">',
          me,
          { images }
        )
      )
    ).toBe(
      '<img src=""><img src=""><video poster=""></video><img srcset=""><img srcset="img/aa.png 2x">'
    )
  })

  it('never shows a personalised picture, not even its stored copy', () => {
    const nifty =
      'https://img.nifty.example/hello.png?name=Sam&email=sampleinbox%40gmail.com'
    expect(
      body(
        cleanEmailHtml(`<img src="${nifty.replace('&', '&amp;')}">`, me, {
          images: [{ ref: nifty, path: 'img/cc.png' }]
        })
      )
    ).toBe('<img src="">')
    // Escapes are read, also twice applied, for a short local part too.
    const twice = 'https://x.example/a.png?e=capture%2540inbox.example'
    expect(
      body(
        cleanEmailHtml(`<img src="${twice}">`, sample, {
          images: [{ ref: twice, path: 'img/dd.png' }]
        })
      )
    ).toBe('<img src="">')
  })

  it('lets no CSS load a file, whatever it hides behind', () => {
    for (const css of [
      '<style>@import "https://evil.example/x.css?k=TOKEN\\\n";</style>',
      '<style>@import "\\\nhttps://evil.example/x.css";</style>',
      `<div style="background:image-set('https://evil.example/a.png?k=TOKEN\\\n' 1x)">x</div>`,
      '<div style="background:image-set(&quot;https://evil.example/a.png?k=TOKEN\\&#10;&quot; 1x)">x</div>',
      `<style>@import "${'x'.repeat(2_100)}https://evil.example/?k=TOKEN";</style>`,
      '<style>@import url(https://evil.example/x.css);</style>',
      '<style>@import "https://evil.example/x.css"</style>'
    ])
      expect(cleanEmailHtml(css, me), css.slice(0, 60)).not.toMatch(
        /evil|TOKEN/
      )
    // Ordinary CSS stays as written.
    const plain =
      '<style>@media (width < 600px){.sm\\:hidden{display:none}}a{content:"\\\\\\\\"}</style>'
    expect(cleanEmailHtml(plain, me)).toContain(plain)
  })

  it('never takes a name out of CSS words or HTML tag names', () => {
    const persona = {
      addresses: [],
      names: ['Max Georgia', 'Li', 'Em', 'Mark', 'Line', 'Min']
    }
    const html =
      '<p style="max-width:600px;line-height:1.5;min-height:1px;font-family:Georgia,serif"><em>Linen</em></p><ul><li>One</li></ul><mark>New</mark>'
    expect(body(cleanEmailHtml(html, persona))).toBe(html)
  })

  it('joins the words of boxes set to display inline', () => {
    expect(
      body(
        cleanEmailHtml(
          '<p style="display:inline">Sa</p><p style="display:inline">m</p>',
          me
        )
      )
    ).toBe('<p style="display:inline"></p><p style="display:inline"></p>')
  })
})

describe('what the fourth review found', () => {
  const pictures = (html: string, identity: InboxIdentity, ref: string) =>
    body(
      cleanEmailHtml(html, identity, { images: [{ ref, path: 'img/zz.png' }] })
    )

  it('reads the deadline inside CSS too', () => {
    for (const [check, html] of [
      ['css', '<style>a{background:url(img/zz.png)}</style>'],
      ['strings', '<style>a{content:"x"}</style>'],
      ['css', '<p style="background:url(img/zz.png)">x</p>'],
      ['strings', '<p style="font-family:\'x\'">x</p>']
    ]) {
      const clock = (at: string) => (at === check ? Infinity : 0)
      expect(cleanEmailHtml(html!, me, { clock }), html).toBeNull()
    }
    // Hundreds of thousands of CSS strings stop at the deadline.
    const started = Date.now()
    expect(
      cleanEmailHtml(`<style>${'"\u{3ac}"'.repeat(320_000)}</style>`, me)
    ).toBeNull()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('never shows a picture whose address names the person, in any script', () => {
    for (const [name, query] of [
      ['\u{410}\u{43d}\u{43d}\u{430}', 'name=%D0%90%D0%BD%D0%BD%D0%B0'],
      ['Zo\u{eb}', 'name=Zo%C3%AB'],
      ['Jos\u{e9}', 'name=Jos%c3%a9'],
      ['Sam', 'n=%53am']
    ]) {
      const ref = `https://img.nifty.example/hi.png?${query}`
      expect(
        pictures(`<img src="${ref}">`, { addresses: [], names: [name!] }, ref),
        name
      ).toBe('<img src="">')
    }
    // The inbox's address in base64, and a short local part at any length.
    const short = { addresses: ['samriv@example.com'], names: [] }
    for (const [identity, ref] of [
      [me, 'https://x.example/a.png?e=c2FtcGxlaW5ib3hAZ21haWwuY29t'],
      [me, 'https://x.example/c2FtcGxlaW5ib3hAZ21haWwuY29t/a.png'],
      [short, 'https://x.example/a.png?u=samriv'],
      [short, 'https://x.example/u/samriv/p.png']
    ] as const)
      expect(pictures(`<img src="${ref}">`, identity, ref), ref).toBe(
        '<img src="">'
      )
    // A picture that names no one is shown.
    const plain = 'https://x.example/hero.png?w=600'
    expect(pictures(`<img src="${plain}">`, short, plain)).toBe(
      '<img src="img/zz.png">'
    )
  })

  it('never lets a call raise a limit or stretch the deadline', () => {
    for (const limits of [{ html: 1e9 }, { html: NaN }, { html: Infinity }])
      expect(cleanEmailHtml(klaviyo.repeat(700), me, { limits })).toBeNull()
    expect(
      cleanEmailHtml(`<p>${'S<!---->'.repeat(60_000)}</p>`, me, {
        limits: { tags: NaN }
      })
    ).toBeNull()
    expect(
      cleanEmailText('linen '.repeat(5_000), me, { limits: { text: 1e9 } })
        .length
    ).toBeLessThanOrEqual(10_000)
    // A clock that never moves: real time still ends the work.
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(0)
      .mockReturnValue(1e12)
    try {
      expect(cleanEmailHtml(klaviyo, me, { clock: () => 0 })).toBeNull()
    } finally {
      now.mockRestore()
    }
  })

  it('keeps names in class names, ids and font faces, not addresses', () => {
    const persona = { addresses: me.addresses, names: ['Max Georgia'] }
    const html =
      '<p class="max-w" id="georgia-hero"><font face="Georgia, serif">x</font></p>'
    expect(body(cleanEmailHtml(html, persona))).toBe(html)
    expect(
      body(cleanEmailHtml('<p class="x sampleinbox@gmail.com">y</p>', persona))
    ).toBe('<p class="x ">y</p>')
  })

  it('greets by a name written in capitals, a final sigma too', () => {
    const nikos = {
      addresses: [],
      names: ['\u{39d}\u{3af}\u{3ba}\u{3bf}\u{3c2}']
    }
    expect(
      cleanEmailText('Hi \u{39d}\u{399}\u{39a}\u{39f}\u{3a3},', nikos)
    ).toBe('Hi there,')
  })

  it('matches names whatever their case and accents', () => {
    for (const [name, text] of [
      ['Strau\u{df}', 'Thanks, STRAUSS!'],
      [
        '\u{39c}\u{3b1}\u{3c1}\u{3af}\u{3b1}',
        'Thanks, \u{39c}\u{391}\u{3a1}\u{399}\u{391}!'
      ],
      ['Jos\u{e9}', 'Thanks, Jose!'],
      ['\u{c1}ngel', 'Thanks, Angel!'],
      ['Zo\u{eb}', 'Thanks, ZOE!'],
      ['Ali', 'Thanks, AL\u{130}!'],
      [
        '\u{39d}\u{3af}\u{3ba}\u{3bf}\u{3c2}',
        'Thanks, \u{39d}\u{3af}\u{3ba}\u{3bf}\u{3c2}!'
      ],
      [
        '\u{39d}\u{3af}\u{3ba}\u{3bf}\u{3c2}',
        'Thanks, \u{39d}\u{3af}\u{3ba}\u{3bf}\u{3c3}!'
      ],
      [
        '\u{39d}\u{3af}\u{3ba}\u{3bf}\u{3c2}',
        'Thanks, \u{39d}\u{399}\u{39a}\u{39f}\u{3a3}!'
      ],
      ['Strau\u{df}', 'Thanks, STRAU\u{1e9e}!']
    ])
      expect(
        cleanEmailText(text!, { addresses: [], names: [name!] }),
        name
      ).toBe('Thanks!')
  })
})

describe('ordinary copy stays as written', () => {
  it('keeps numbers, prices and codes that only look like addresses', () => {
    for (const text of [
      'Buy 3@20 each',
      'Shirts 2@50% off',
      'Save 20%25 today',
      'Use code FALL%40',
      'Prices: 2@1.99 each, 3@4.50',
      'Doors open at 10 dot com launch'
    ])
      expect(cleanEmailText(text, me)).toBe(text)
    expect(cleanEmailText('Email us: support at shop dot com', me)).toBe(
      'Email us:'
    )
  })

  it('keeps CSS strings that are words, not links', () => {
    const css =
      '<style>a{content:"Why?"}b{content:"#1 seller"}i{content:"Note: new"}u{content:"/ sale"}</style>'
    expect(cleanEmailHtml(css, me)).toContain(css)
    expect(cleanEmailHtml('<style>@import "evil";</style>', me)).toContain(
      '<style>@import "";</style>'
    )
    // A string read with its escapes, written plain when a name goes.
    expect(
      body(cleanEmailHtml(`<p style="font-family:'Hi \\53 am'">x</p>`, me))
    ).toBe(`<p style="font-family:'Hi '">x</p>`)
  })

  it('keeps a katakana word that only starts with a katakana name', () => {
    const sam = { addresses: [], names: ['\u{30b5}\u{30e0}'] }
    expect(
      cleanEmailText(
        '\u{30b5}\u{30e0}\u{30b9}\u{30f3}\u{306e}\u{65b0}\u{88fd}\u{54c1}\u{3001}\u{30b5}\u{30e0}\u{3055}\u{3093}',
        sam
      )
    ).toBe(
      '\u{30b5}\u{30e0}\u{30b9}\u{30f3}\u{306e}\u{65b0}\u{88fd}\u{54c1}\u{3001}\u{3055}\u{3093}'
    )
    // Nor one that only ends with it.
    const newsom = '\u{30cb}\u{30e5}\u{30fc}\u{30b5}\u{30e0}'
    expect(cleanEmailText(newsom, sam)).toBe(newsom)
  })

  it('takes out only the name when it is cut by tags in a script without spaces', () => {
    const yamada = {
      addresses: [],
      names: ['\u{5c71}\u{7530}\u{592a}\u{90ce}']
    }
    expect(
      body(
        cleanEmailHtml(
          '<p>\u{5c71}\u{7530}<b>\u{592a}\u{90ce}</b>\u{69d8}\u{3001}\u{3053}\u{3093}\u{306b}\u{3061}\u{306f}</p>',
          yamada
        )
      )
    ).toBe(
      '<p><b></b>\u{69d8}\u{3001}\u{3053}\u{3093}\u{306b}\u{3061}\u{306f}</p>'
    )
  })

  it('removes what touches an address cut by tags, on both sides', () => {
    // Addresses back to back: the match ends inside the next one.
    expect(
      body(
        cleanEmailHtml(
          '<p>Mail <b>a@b.example</b><b>a@b.example</b> now</p>',
          me
        )
      )
    ).toBe('<p>Mail <b></b><b></b> now</p>')
    // The inbox's own address cut by a tag, written out.
    const sample = { addresses: ['capture@inbox.example'], names: [] }
    expect(
      body(
        cleanEmailHtml(
          '<p>Write to capture <b>at</b> inbox.example today</p>',
          sample
        )
      )
    ).toBe('<p>Write to <b></b> today</p>')
  })

  it('keeps no hidden markers and writes non-breaking spaces as they are', () => {
    const marked = 'A\u{fff9}\u{e000}\u{fffb}B Northwind'
    expect(cleanEmailText(marked, me)).toBe(marked)
    expect(body(cleanEmailHtml('<p>a&nbsp;b</p>', me))).toBe('<p>a&nbsp;b</p>')
  })

  it('never reads a piece of a word at the end of what it reads', () => {
    const text = `https://x.example/${'a'.repeat(39_971)} sampleinbox@gmail.com`
    expect(cleanEmailText(text, me)).not.toMatch(/sample/)
  })

  it('shows no data picture, small or large', () => {
    for (const data of [
      'data:image/png;base64,iVBORw0KGgo=',
      `data:image/png;base64,${'A'.repeat(150_000)}`
    ])
      expect(body(cleanEmailHtml(`<img src="${data}">`, me))).toBe(
        '<img src="">'
      )
  })
})

describe('what the fifth review found', () => {
  /** Distinct characters of the first plane, no surrogates. */
  const distinct = (length: number) => {
    let s = ''
    for (let c = 0xa0; s.length < length; c++) {
      if (c >= 0xd800 && c < 0xe000) c = 0xe000
      if (c > 0xfffd) c = 0xa0
      s += String.fromCharCode(c)
    }
    return s
  }
  const pictures = (identity: InboxIdentity, ref: string) =>
    body(
      cleanEmailHtml(`<img src="${ref}">`, identity, {
        images: [{ ref, path: 'img/zz.png' }]
      })
    )

  it('reads the deadline inside long text, at every pass', () => {
    const long = distinct(10_000).replace(/["&<]/g, 'x')
    for (const check of ['fold', 'pass'])
      for (const html of [`<p>${long}</p>`, `<p title="${long}">x</p>`]) {
        const clock = (at: string) => (at === check ? Infinity : 0)
        expect(cleanEmailHtml(html, me, { clock }), check).toBeNull()
      }
    // Time passes at each check: a long text of distinct characters reads
    // the clock as it goes, a short one fits in the same time.
    let ticks = 0
    const clock = () => ticks++
    const limits = { ms: 30 }
    expect(cleanEmailHtml('<p>linen</p>', me, { clock, limits })).not.toBeNull()
    ticks = 0
    expect(
      cleanEmailHtml(`<p>${distinct(200_000)}</p>`, me, { clock, limits })
    ).toBeNull()
  })

  it('reads a million distinct characters in time', () => {
    const started = Date.now()
    cleanEmailHtml(`<p>Sa(Sa(x@y.example)m)m ${distinct(989_950)}</p>`, me)
    expect(Date.now() - started).toBeLessThan(6_000)
    // A sign that stands for a whole phrase is read as one sign.
    expect(
      cleanEmailHtml(`<p>${'\u{fdfa}'.repeat(600_000)}</p>`, me)
    ).not.toBeNull()
  }, 15_000)

  it('keeps words that only look like a name once folded', () => {
    for (const [name, text] of [
      ['Ana', '2 per order (\u{3b1}\u{3bd}\u{3ac})'],
      ['Max', 'M\u{e1}x. 2 por cliente'],
      ['Mia', 'Esta oferta es m\u{ed}a'],
      ['Mia', '\u{39c}\u{3af}\u{3b1} \u{3c6}\u{3bf}\u{3c1}\u{3ac}'],
      ['Noel', 'Joyeux No\u{eb}l'],
      ['Weiss', 'T-Shirt Wei\u{df}'],
      ['Gross', 'gro\u{df} und klein'],
      ['Strauss', 'Ein Strau\u{df} Rosen'],
      ['STRAUSS', 'Thanks, Strau\u{df}!'],
      ['Jose', 'Thanks, Jos\u{e9}!'],
      ['Meta', '\u{3bc}\u{3b5}\u{3c4}\u{3ac} \u{3c4}\u{3b7}\u{3bd}'],
      ['Kata', '\u{3ba}\u{3b1}\u{3c4}\u{3ac} \u{3c4}\u{3b7}\u{3bd}'],
      ['Kai', '\u{3b1} \u{3ba}\u{3b1}\u{3b9} \u{3b2}'],
      [
        'Tom',
        '\u{432} \u{442}\u{43e}\u{43c} \u{447}\u{438}\u{441}\u{43b}\u{435}'
      ],
      ['Pia', 'Una p\u{ed}a tradici\u{f3}n'],
      ['Ena', '\u{388}\u{3bd}\u{3b1} \u{3b4}\u{3ce}\u{3c1}\u{3bf}'],
      [
        'Nea',
        '\u{39d}\u{3ad}\u{3b1} \u{3c3}\u{3c5}\u{3bb}\u{3bb}\u{3bf}\u{3b3}\u{3ae}'
      ]
    ])
      expect(
        cleanEmailText(text!, { addresses: [], names: [name!] }),
        name
      ).toBe(text)
    // Nor in a script without spaces: サカ is not サガ.
    const saka = { addresses: [], names: ['\u{30b5}\u{30ab}'] }
    expect(cleanEmailText('\u{30b5}\u{30ac}', saka)).toBe('\u{30b5}\u{30ac}')
    // A word mixing scripts is a disguise; a greeting reads any case.
    expect(
      cleanEmailText('Thanks, \u{41c}\u{43e}n\u{430}!', {
        addresses: [],
        names: ['Mona']
      })
    ).toBe('Thanks!')
    expect(
      cleanEmailText('Hi jose,', { addresses: [], names: ['Jos\u{e9}'] })
    ).toBe('Hi there,')
  })

  it('draws no attribute with CSS, so a name kept in a class is never shown', () => {
    expect(
      cleanEmailHtml(
        '<style>.g::after{content:attr(class)}</style><p class="g Sam">x</p>',
        me
      )
    ).toContain('<style>.g::after{}</style>')
    expect(
      body(
        cleanEmailHtml(
          '<p class="Sam" style="color:red;--x:attr(class);margin:0">x</p>',
          me
        )
      )
    ).toBe('<p class="Sam" style="color:red;;margin:0">x</p>')
    // Written in capitals, or hidden by an escape (then all of it goes).
    expect(
      cleanEmailHtml(
        '<style>font::after{content:"> " ATTR(face)}</style><font face="Sam">x</font>',
        me
      )
    ).toContain('<style>font::after{}</style>')
    expect(
      cleanEmailHtml(
        '<style>.g::after{content:at\\74 r(id)}p{color:red}</style><p id="Sam">x</p>',
        me
      )
    ).toContain('<style></style>')
  })

  it('never shows a picture that names the person in any encoding', () => {
    const jose = { addresses: [], names: ['Jos\u{e9}'] }
    const anna = { addresses: [], names: ['\u{410}\u{43d}\u{43d}\u{430}'] }
    for (const [identity, ref] of [
      [jose, 'https://img.x.example/p.png?d=eyJuIjoiSm9zw6kifQ=='],
      [anna, 'https://img.x.example/p.png?d=eyJuIjoi0JDQvdC90LAifQ=='],
      [me, 'https://img.x.example/p.png?d=eyJuIjoiU2FtIiwKIngiOjF9'],
      [me, 'https://img.x.example/p.png?d=eyJuIjoiU2FtIiwicSI6Ij8_PyJ9'],
      [me, 'https://img.x.example/p.png?d=U2Ft'],
      [me, 'https://img.x.example/p.png?d=Uml2ZXJh'],
      [me, 'https://img.x.example/p/v1-eyJuIjoiU2FtIFJpdmVyYSJ9.png'],
      [jose, 'https://img.x.example/p.png?name=Jos%E9'],
      [jose, 'https://img.x.example/p.png?name=Jos%C3%A9%FF'],
      [me, 'https://img.x.example/p.png?n=%25%35%33am'],
      [me, 'https://img.x.example/p.png?n=%53%61%6D%FF'],
      [jose, 'https://img.x.example/p.png?n=jose'],
      [jose, 'https://img.x.example/p.png?d=eyJuIjoiSm9z6SJ9'],
      [me, 'https://img.x.example/p.png?d=%55%32%46%74']
    ] as const)
      expect(pictures(identity, ref), ref).toBe('<img src="">')
  })

  it('never cuts what it reads between an address and its domain', () => {
    const short = { addresses: ['samriv@example.com'], names: [] }
    expect(
      cleanEmailSubject(
        `https://x.example/${'a'.repeat(767)} Sale samriv @ example.com`,
        short
      )
    ).toBe('Sale')
    const text = `Sale ${'linen '.repeat(6_664)}samriv @ example.com`
    expect(cleanEmailText(text, short)).not.toMatch(/samriv/)
  })

  it('empties CSS strings that load a file, even run over lines', () => {
    for (const string of ['"ht\\\ntps://x.example/a"', '"bg.png"'])
      expect(
        cleanEmailHtml(
          `<style>a{background-image:image-set(${string} 1x)}</style>`,
          me
        )
      ).toContain('<style>a{background-image:image-set("" 1x)}</style>')
    // A string that loses a name is written back with its quotes and
    // backslashes escaped.
    expect(
      body(cleanEmailHtml(`<p style="font-family:'Sam \\27 s'">x</p>`, me))
    ).toBe(`<p style="font-family:' \\'s'">x</p>`)
    expect(
      body(cleanEmailHtml(`<p style="font-family:'Hi Sam \\5c ok'">x</p>`, me))
    ).toBe(`<p style="font-family:'Hi  \\\\ok'">x</p>`)
  })
})

describe('what the sixth review found', () => {
  const pictures = (identity: InboxIdentity, ref: string) =>
    body(
      cleanEmailHtml(`<img src="${ref}">`, identity, {
        images: [{ ref, path: 'img/zz.png' }]
      })
    )

  it('reads a long run of percent escapes in time', () => {
    // The deadline is read inside one run: 2,000 four-byte characters are
    // only 2,000 characters but 8,000 bytes.
    for (const run of ['%E9'.repeat(10_000), '%F0%9F%98%80'.repeat(2_000)]) {
      const clock = (at: string) => (at === 'fold' ? Infinity : 0)
      expect(
        cleanEmailHtml(`<p>${run}</p>`, me, { clock }),
        run.slice(0, 6)
      ).toBeNull()
    }
    let ticks = 0
    const clock = () => ticks++
    expect(
      cleanEmailHtml(`<p>${'%E9'.repeat(200_000)}</p>`, me, {
        clock,
        limits: { ms: 30 }
      })
    ).toBeNull()
    // In real time: a million characters of bytes that are no UTF-8.
    const started = Date.now()
    cleanEmailHtml(`<p>Sa(Sa(x@y.example)m)m ${'%E9'.repeat(329_990)}</p>`, me)
    expect(Date.now() - started).toBeLessThan(5_000)
  }, 15_000)

  it('removes a name joined to a code or to its other words', () => {
    for (const [text, clean] of [
      ['Your code SAM20 is ready', 'Your code is ready'],
      ['Hi SamRivera,', 'Hi there,'],
      ['Thanks, Sam2Rivera!', 'Thanks!'],
      ['Join #TeamSam today', 'Join #Team today'],
      // Ordinary words stay.
      ['Samsung, Samba and #TeamSamsung', 'Samsung, Samba and #TeamSamsung'],
      // A byte that is no UTF-8 does not join a name to a word, nor does
      // an escape read as a letter.
      ['Thanks, Sam%FF!', 'Thanks, %FF!'],
      ['Thanks, %41Sam!', 'Thanks, %41!'],
      ['Thanks, Sam%61!', 'Thanks, %61!']
    ])
      expect(cleanEmailText(text!, me), text).toBe(clean)
    // In a picture's address, a name inside a longer word is enough.
    for (const ref of [
      'https://img.x.example/p.png?code=SAM20',
      'https://img.x.example/p.png?n=SamRivera',
      // A byte that starts no full UTF-8 sequence, an overlong S.
      'https://img.x.example/p.png?n=%E9%53%61%6D',
      'https://img.x.example/p.png?n=%C1%93am'
    ])
      expect(pictures(me, ref), ref).toBe('<img src="">')
  })

  it('reads a name through marks that only decorate it', () => {
    for (const [name, text] of [
      ['Sam', 'Thanks S\u{336}a\u{336}m\u{336}!'],
      ['Sam', 'Thanks Sa\u{323}m!'],
      // Arabic vowel signs and Hebrew points, written or not.
      [
        '\u{645}\u{62d}\u{645}\u{62f}',
        'Thanks \u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{651}\u{64e}\u{62f}!'
      ],
      [
        '\u{645}\u{64f}\u{62d}\u{64e}\u{645}\u{651}\u{64e}\u{62f}',
        'Thanks \u{645}\u{62d}\u{645}\u{62f}!'
      ],
      [
        '\u{5e9}\u{5e8}\u{5d4}',
        'Thanks \u{5e9}\u{5b8}\u{5c2}\u{5e8}\u{5b8}\u{5d4}!'
      ]
    ])
      expect(
        cleanEmailText(text!, { addresses: [], names: [name!] }),
        text
      ).toBe('Thanks!')
  })

  it('reads no picture address longer than any link', () => {
    const long = `https://img.x.example/p.png?x=${'a'.repeat(9_000)}`
    expect(pictures(me, long)).toBe('<img src="">')
    // A megabyte address is not read at all, so it costs no time.
    const started = Date.now()
    cleanEmailHtml('<p>x</p>', me, {
      images: [
        { ref: `data:image/png;base64,${'U2Ft'.repeat(250_000)}`, path: 'a' }
      ]
    })
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('reads a base64 part of any length and cuts on a whole word', () => {
    // "Sam Rivera" in base64 with "-v1" joined: read once the last odd
    // character is left out.
    expect(
      pictures(me, 'https://img.x.example/p.png?d=U2FtIFJpdmVyYQ-v1')
    ).toBe('<img src="">')
    expect(
      cleanEmailSubject(`https://x.example/${'a'.repeat(772)} Sale Rivera`, me)
    ).toBe('Sale')
    // A function whose name only ends in "attr" draws nothing.
    expect(cleanEmailHtml('<style>a{x:xattr(1)}</style>', me)).toContain(
      '<style>a{x:xattr(1)}</style>'
    )
  })
})

describe('what the seventh review found', () => {
  const pictures = (identity: InboxIdentity, ref: string) =>
    body(
      cleanEmailHtml(`<img src="${ref}">`, identity, {
        images: [{ ref, path: 'img/zz.png' }]
      })
    )

  it('removes a name glued to other words, codes, # and @', () => {
    for (const [text, clean] of [
      ['#SamLovesLinen', '#LovesLinen'],
      ['Share #SamStyle', 'Share #Style'],
      ['SamStyle picks', 'Style picks'],
      ['Hey SamFriend', 'Hey Friend'],
      ['HappyBirthdaySam!', 'HappyBirthday!'],
      ['#RiveraFamily', '#Family'],
      ['Code SAMVIP', 'Code'],
      ['Code VIPSAM', 'Code'],
      ['Code 20SAM', 'Code 20'],
      ['Welcome back, SamR.', 'Welcome back, R.'],
      ['Follow @SamRiveraOfficial', 'Follow @Official'],
      ['Follow @samrivera', 'Follow @'],
      ['samrivera', ''],
      ['Code SamRivera2024', 'Code'],
      ['Code SAMRIVERA2024', 'Code'],
      // Accepted: hides on the safe side.
      ['#SamSmith', '#Smith'],
      ['Visit samrivera.example', 'Visit.example']
    ])
      expect(cleanEmailText(text!, me), text).toBe(clean)
    // Words that only start like a name stay.
    for (const [name, text] of [
      ['Sam Rivera', 'Samsung, Samba, Samsonite, SAMSUNG, #TeamSamsung'],
      ['Max', 'Maxwell, MAXIMUM'],
      ['Ann', 'Annapolis, Anniversary, #AnnualSale'],
      ['Kai', 'Kaizen']
    ])
      expect(
        cleanEmailText(text!, { addresses: [], names: [name!] }),
        name
      ).toBe(text)
    expect(
      cleanEmailText('MaxMara coat', { addresses: [], names: ['Max'] })
    ).toBe('Mara coat')
  })

  it('removes a name without its accents, also in small letters', () => {
    for (const [name, text] of [
      ['Jos\u{e9}', 'Thanks jose!'],
      ['\u{c1}ngel', 'Thanks angel!']
    ])
      expect(
        cleanEmailText(text!, { addresses: [], names: [name!] }),
        name
      ).toBe('Thanks!')
  })

  it('shows no data: picture through any attribute or CSS', () => {
    const data = 'data:image/png;base64,iVBORw0KGgo='
    const html = cleanEmailHtml(
      `<img src="${data}" srcset="${data} 1x"><video poster="${data}"></video><table background="${data}"><tr><td style="background:url(${data})">x</td></tr></table><style>a{background:image-set("${data}" 1x)}</style>`,
      me
    )
    expect(html).not.toContain('data:')
  })

  it('hides every picture drawn for each subscriber', () => {
    const drawn = { ...me, imageHosts: personalisedImageHosts }
    for (const ref of [
      'https://img1.niftyimages.com/abc/def/hi.png',
      'https://movable-ink-1234.com/p/rp/abc.png',
      'https://cdn.x.example/hero.png?rid=ab12cd34',
      'https://cdn.x.example/hero.png?email_id=00a1b2c3',
      'https://cdn.x.example/hero.png?Subscriber-Id=777777'
    ])
      expect(pictures(drawn, ref), ref).toBe('<img src="">')
    // An ordinary picture, or a short value, is shown.
    for (const ref of [
      'https://cdn.x.example/hero.png?w=600&v=2',
      'https://cdn.x.example/hero.png?uid=12',
      'https://notniftyimages.com/hero.png'
    ])
      expect(pictures(drawn, ref), ref).toBe('<img src="img/zz.png">')
  })

  it('reads a joined name in a picture address in any case', () => {
    const joli = { addresses: [], names: ['Jo Li'] }
    for (const ref of [
      'https://img.x.example/p.png?n=joli',
      'https://img.x.example/p.png?u=dearjoli'
    ])
      expect(pictures(joli, ref), ref).toBe('<img src="">')
    // A two-letter word alone never counts inside a longer one.
    expect(pictures(joli, 'https://cdn.x.example/files/hero.png')).toBe(
      '<img src="img/zz.png">'
    )
    // A byte that is no UTF-8 after a name read from escapes.
    expect(
      cleanEmailText('Thanks, Jos%C3%A9%FF!', {
        addresses: [],
        names: ['Jos\u{e9}']
      })
    ).toBe('Thanks!')
  })
})

describe('inboxIdentity', () => {
  it('is the inbox address and the subscriber names from the settings', () => {
    expect(
      inboxIdentity(
        inboxConfig({ INBOX_SUBSCRIBER_NAMES: ' Sam  Rivera , ,S ' })
      )
    ).toEqual({
      addresses: ['capture@inbox.example'],
      names: ['Sam Rivera'],
      imageHosts: [...personalisedImageHosts]
    })
    // The Gmail address counts while the inbox cannot be read yet.
    expect(
      inboxIdentity(
        inboxConfig({
          INBOX_TRANSPORT: 'gmail_imap',
          INBOX_IMAP_USER: 'SampleInbox@gmail.com'
        })
      )
    ).toEqual({
      addresses: ['sampleinbox@gmail.com'],
      names: [],
      imageHosts: [...personalisedImageHosts]
    })
  })
})
