// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { holdPictures, markedHtml } from './browser'

describe('getting an email ready for the locked browser', () => {
  it('marks sections the way the inbox does, unless they are marked already', () => {
    const html =
      '<html><body><table width="600"><tr><td>One</td></tr><tr><td>Two</td></tr></table></body></html>'
    expect(markedHtml(html)).toContain('<tr data-gr-section="1">')
    expect(markedHtml(html)).toContain('<tr data-gr-section="2">')
    const ours = '<table data-gr-section="1"><tr><td>x</td></tr></table>'
    expect(markedHtml(ours)).toBe(ours)
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

  it('leaves alone inline pictures, allowed ones and those without a size', () => {
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
  })
})
