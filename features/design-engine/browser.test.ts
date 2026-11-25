// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Browser } from '@playwright/test'
import { holdPictures, markedHtml, measureHtml } from './browser'

describe('getting an email ready for the locked browser', () => {
  it('marks sections the way the inbox does', () => {
    const html =
      '<html><body><table width="600"><tr><td>One</td></tr><tr><td>Two</td></tr></table></body></html>'
    expect(markedHtml(html)).toContain('<tr data-gr-section="1">')
    expect(markedHtml(html)).toContain('<tr data-gr-section="2">')
  })

  it('keeps our own marks, but removes marks and flags anyone else’s HTML brings', () => {
    const ours = '<table data-gr-section="1"><tr><td>x</td></tr></table>'
    expect(markedHtml(ours, true)).toBe(ours)
    const theirs =
      '<html><body><table width="600" data-de-email><tr data-gr-section="9"><td data-de-src="https://x.example/a.png">One</td></tr><tr data-gr-section=\'9\'><td>Two</td></tr></table></body></html>'
    const out = markedHtml(theirs)
    expect(out).not.toMatch(/data-gr-section="9"|data-gr-section='9'|data-de-/)
    expect(out).toContain('data-gr-section="1"')
    expect(out).toContain('data-gr-section="2"')
  })

  it('holds the place of a picture the browser may not load, keeping its address', () => {
    const out = holdPictures(
      '<img alt="A" src="https://cdn.example.org/a.png?x=1&amp;y=2" width="200" height="100">'
    )
    expect(out).toMatch(
      /^<img alt="A" src="data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+" data-de-src="https:\/\/cdn\.example\.org\/a\.png\?x=1&amp;y=2" width="200" height="100">$/
    )
    const svg = Buffer.from(
      /base64,([^"]+)"/.exec(out)![1]!,
      'base64'
    ).toString()
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"/>'
    )
  })

  it('never expands $ patterns in an address', () => {
    const out = holdPictures(
      `<img src="https://cdn.example.org/a.png?a=$&b=$'c=$\`" width="20" height="10">`
    )
    expect(out).toContain(
      `data-de-src="https://cdn.example.org/a.png?a=$&b=$'c=$\`"`
    )
    expect(out.match(/<img /g)).toHaveLength(1)
  })

  it('leaves alone inline pictures, allowed ones, those without a size and sizes no email has', () => {
    const inline =
      '<img src="data:image/png;base64,AAAA" width="10" height="10">'
    expect(holdPictures(inline)).toBe(inline)
    const allowed =
      '<img src="https://pictures.example.com/a.png" width="10" height="10">'
    expect(holdPictures(allowed, ['https://pictures.example.com'])).toBe(
      allowed
    )
    const sizeless =
      '<img src="https://cdn.example.org/a.png" style="width:100%">'
    expect(holdPictures(sizeless)).toBe(sizeless)
    const giant =
      '<img src="https://cdn.example.org/a.png" width="9999" height="9999">'
    expect(holdPictures(giant)).toBe(giant)
    const tall =
      '<img src="https://cdn.example.org/a.png" width="600" height="99999">'
    expect(holdPictures(tall)).toBe(tall)
  })

  it('refuses an email larger than 2 MB before it reaches the browser', async () => {
    const never = {} as Browser
    expect(await measureHtml(never, 'x'.repeat(2_000_001))).toEqual({
      ok: false,
      error: 'The email is larger than 2 MB.'
    })
  })
})
