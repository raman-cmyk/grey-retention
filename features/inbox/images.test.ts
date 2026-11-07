// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { dataUri, imageRefs, maxImages, sniffImage } from './images'

const png = Uint8Array.from(Buffer.from('89504e470d0a1a0a0000', 'hex'))

describe('imageRefs', () => {
  it('finds every image the HTML uses, once, in order', () => {
    const html = `
      <style>.hero{background:url('https://cdn.shop.example/bg.jpg')}</style>
      <table background="https://cdn.shop.example/table.gif"><tr>
      <td style="background-image: url(https://cdn.shop.example/cell.png)">
        <img src="https://cdn.shop.example/a.png?x=1&amp;y=2" alt="">
        <img srcset="https://cdn.shop.example/b.png 1x, https://cdn.shop.example/b@2x.png 2x">
        <img src='cid:logo@shop'>
        <img src="data:image/png;base64,iVBORw0KGgo=">
        <img src="https://cdn.shop.example/a.png?x=1&amp;y=2">
        <img src="/relative.png"><img src="javascript:alert(1)">
        <picture><source srcset="https://cdn.shop.example/c.webp"></picture>
        <div style="background-image:url(&quot;https://cdn.shop.example/quoted.png&quot;)"></div>
      </td></tr></table>`
    const refs = imageRefs(html)
    expect(refs.map((r) => [r.source, r.target])).toEqual([
      ['remote', 'https://cdn.shop.example/table.gif'],
      ['remote', 'https://cdn.shop.example/cell.png'],
      ['remote', 'https://cdn.shop.example/a.png?x=1&y=2'],
      ['remote', 'https://cdn.shop.example/b.png'],
      ['remote', 'https://cdn.shop.example/b@2x.png'],
      ['cid', 'logo@shop'],
      ['inline', 'data:image/png;base64,iVBORw0KGgo='],
      ['remote', 'https://cdn.shop.example/c.webp'],
      ['remote', 'https://cdn.shop.example/quoted.png'],
      ['remote', 'https://cdn.shop.example/bg.jpg']
    ])
    // The reference stays as written, so the stored copy can replace it.
    expect(refs[2]!.ref).toBe('https://cdn.shop.example/a.png?x=1&amp;y=2')
    expect(refs.map((r) => r.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it(`keeps at most ${maxImages} images`, () => {
    const html = Array.from(
      { length: 80 },
      (_, i) => `<img src="https://cdn.shop.example/${i}.png">`
    ).join('')
    expect(imageRefs(html)).toHaveLength(maxImages)
  })

  it('reads hostile HTML quickly', () => {
    const started = Date.now()
    imageRefs('<img src="'.repeat(200_000))
    imageRefs('<img ' + 'a '.repeat(500_000))
    expect(Date.now() - started).toBeLessThan(3_000)
  })
})

describe('sniffImage and dataUri', () => {
  it('decides the type by the bytes, never by the name', () => {
    expect(sniffImage(png)).toEqual({ contentType: 'image/png', ext: 'png' })
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject(
      { ext: 'jpg' }
    )
    expect(sniffImage(new TextEncoder().encode('GIF89a...'))).toMatchObject({
      ext: 'gif'
    })
    expect(
      sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))
    ).toMatchObject({ ext: 'webp' })
    expect(
      sniffImage(new TextEncoder().encode('<svg xmlns="..."/>'))
    ).toBeNull()
    expect(sniffImage(new TextEncoder().encode('<html>'))).toBeNull()
  })

  it('decodes base64 data images only', () => {
    expect(dataUri('data:image/png;base64,iVBORw0KGgo=')?.[0]).toBe(0x89)
    expect(dataUri('data:text/html;base64,PGI+')).toBeNull()
    expect(dataUri('data:image/svg+xml,<svg/>')).toBeNull()
  })
})
