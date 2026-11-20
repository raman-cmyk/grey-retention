// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  dataUri,
  imageRefs,
  maxImages,
  sniffImage,
  stripMetadata
} from './images'

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

describe('stripMetadata', () => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)])
  }
  const signature = Buffer.from('89504e470d0a1a0a', 'hex')

  it('keeps no text in a PNG or a JPEG, and the picture whole', () => {
    const picture = Buffer.concat([
      signature,
      chunk('IHDR', Buffer.alloc(13)),
      chunk('tEXt', Buffer.from('Comment\0Hi Sam Rivera')),
      chunk('iTXt', Buffer.from('Author\0\0\0\0\0Sam')),
      chunk('IDAT', Buffer.from('pixels')),
      chunk('IEND', Buffer.alloc(0)),
      // Nothing after the end is kept either.
      Buffer.from('Sam Rivera')
    ])
    const png = Buffer.from(stripMetadata(Uint8Array.from(picture)))
    expect(png.includes('Sam')).toBe(false)
    expect(
      png.equals(
        Buffer.concat([
          signature,
          chunk('IHDR', Buffer.alloc(13)),
          chunk('IDAT', Buffer.from('pixels')),
          chunk('IEND', Buffer.alloc(0))
        ])
      )
    ).toBe(true)
    const segment = (marker: number, data: string) => {
      const length = Buffer.alloc(2)
      length.writeUInt16BE(data.length + 2)
      return Buffer.concat([
        Buffer.from([0xff, marker]),
        length,
        Buffer.from(data)
      ])
    }
    const jfif = segment(0xe0, 'JFIF\0')
    const scan = Buffer.concat([
      segment(0xda, 'scan'),
      Buffer.from('data Sam?'),
      Buffer.from([0xff, 0xd9])
    ])
    const jpeg = Buffer.from(
      stripMetadata(
        Uint8Array.from(
          Buffer.concat([
            Buffer.from([0xff, 0xd8]),
            jfif,
            segment(0xe1, 'Exif\0\0Sam Rivera'),
            segment(0xfe, 'Hi Sam'),
            scan
          ])
        )
      )
    )
    expect(
      jpeg.equals(Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, scan]))
    ).toBe(true)
    // Another format, or a broken file, stays as it is.
    const gif = new TextEncoder().encode('GIF89a Sam')
    expect(stripMetadata(gif)).toBe(gif)
    const broken = Uint8Array.from(
      Buffer.concat([signature, Buffer.from([0, 0, 9])])
    )
    expect(stripMetadata(broken)).toBe(broken)
  })
})
