import { describe, expect, it } from 'vitest'
import { GMAIL_CLIP_BYTES } from '@/features/blocks/render'
import { blueprint, button, image, section, text } from './fixtures'
import { DrawError, drawBlueprint, sentBytes } from './render'

describe('drawing a blueprint', () => {
  const html = drawBlueprint(blueprint())

  it('draws nested tables at the email width with a mark on every section', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('width="600"')
    expect(html).toContain('data-gr-section="1"')
    expect(html).toContain('data-gr-section="2"')
    expect(html).toContain('data-de-email')
    expect(html).not.toMatch(/<script|<link|<iframe|<form|javascript:/i)
  })

  it('writes every gap as a spacer of its exact height and every part at its size', () => {
    expect(html).toContain('<td height="20"')
    expect(html).toContain('width="600" height="300"')
    expect(html).toContain('font-size:32px;line-height:38px;font-weight:700')
    // The button: 160 × 48 with a 20 px line, so 14 px above and below.
    expect(html).toContain('display:block;width:160px;padding:14px 0 14px')
    // A filled grid column and the gap cells between columns.
    expect(html).toContain('bgcolor="#f6f6f6"')
    expect(html).toMatch(/class="de-g" width="30"/)
  })

  it('stacks columns, shrinks margins and pictures on a phone', () => {
    expect(html).toContain('@media only screen and (max-width:620px)')
    expect(html).toContain('.de-c{display:block!important;width:100%!important')
    expect(html).toContain(
      '.de-i{max-width:100%!important;height:auto!important}'
    )
    expect(html).toContain('class="de-p"')
  })

  it('escapes words, so they never become HTML or a Klaviyo tag', () => {
    const out = drawBlueprint(
      blueprint({
        sections: [
          section({
            items: [
              text({ runs: [{ text: '<b>{{ first_name }}</b> & co\nnext' }] })
            ]
          })
        ]
      })
    )
    expect(out).toContain(
      '&lt;b&gt;&#123;&#123; first_name &#125;&#125;&lt;/b&gt; &amp; co<br>next'
    )
  })

  it('draws runs with their own look and links', () => {
    const out = drawBlueprint(
      blueprint({
        sections: [
          section({
            items: [
              text({
                runs: [
                  { text: 'Plain ' },
                  { text: 'bold', weight: 700, color: '#ff0000' },
                  {
                    text: ' link',
                    href: 'https://example.com/x',
                    underline: true
                  },
                  { text: ' old', strike: true }
                ]
              })
            ]
          })
        ]
      })
    )
    expect(out).toContain(
      '<span style="font-weight:700;color:#ff0000">bold</span>'
    )
    expect(out).toContain(
      '<a href="https://example.com/x" target="_blank" style="color:#333333;text-decoration:underline"> link</a>'
    )
    expect(out).toContain(
      '<span style="text-decoration:line-through"> old</span>'
    )
  })

  it('adds the closest safe fonts after the email’s own', () => {
    const out = drawBlueprint(
      blueprint({
        sections: [
          section({
            items: [
              text({ font: { ...text().font, family: "'Sample Serif'" } })
            ]
          })
        ]
      })
    )
    expect(out).toContain(
      "font-family:'Sample Serif', Georgia, 'Times New Roman', Times, serif"
    )
  })

  it('takes only https pictures in Klaviyo mode', () => {
    const inline = blueprint({
      sections: [
        section({
          items: [image({ src: 'data:image/png;base64,iVBORw0KGgo=' })]
        })
      ]
    })
    expect(() => drawBlueprint(inline, { mode: 'klaviyo' })).toThrow(DrawError)
    expect(drawBlueprint(inline)).toContain('data:image/png')
    expect(drawBlueprint(blueprint(), { mode: 'klaviyo' })).toContain(
      'https://example.com/a.png'
    )
  })

  it('draws a picture it could not keep as a grey picture of the same size, never in Klaviyo mode', () => {
    const lost = blueprint({
      sections: [section({ items: [image({ src: null })] })]
    })
    const out = drawBlueprint(lost)
    const src =
      /<img class="de-i" src="data:image\/svg\+xml;base64,([^"]+)"/.exec(out)
    expect(Buffer.from(src![1]!, 'base64').toString()).toContain(
      'width="600" height="300"'
    )
    expect(out).toContain('width="600" height="300" style="display:block;')
    expect(() => drawBlueprint(lost, { mode: 'klaviyo' })).toThrow(DrawError)
  })

  it('draws an outlined button with its border inside its size', () => {
    const out = drawBlueprint(
      blueprint({
        sections: [
          section({
            items: [
              button({
                background: null,
                border: { width: 2, color: '#123456' }
              })
            ]
          })
        ]
      })
    )
    expect(out).toContain('border:2px solid #123456')
    expect(out).toContain('width:156px;padding:12px 0 12px')
  })

  it('puts a section drawn by a library block in its place, marked', () => {
    const out = drawBlueprint(blueprint(), {
      replaced: new Map([[2, '<tr data-block="cta"><td>Block</td></tr>']])
    })
    expect(out).toContain(
      '<tr data-gr-section="2" data-block="cta"><td>Block</td></tr>'
    )
    expect(out.match(/data-gr-section="2"/g)).toHaveLength(1)
  })

  it('counts an inline picture as the link it becomes when it checks the Gmail clip', () => {
    const big = `<p>${'x'.repeat(10)}</p><img src="data:image/png;base64,${'A'.repeat(200_000)}">`
    expect(sentBytes(big)).toBeLessThan(400)
    expect(sentBytes(html)).toBeLessThan(GMAIL_CLIP_BYTES)
  })
})
