// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { PhotoOpener } from '@/features/design-engine/photos'
import { picture } from '@/features/design-engine/golden/pictures'
import { picturePlaceholder, placeholderIndex, prepareUpload } from './prepare'

const png = (w: number, h: number) =>
  Buffer.from(picture(w, h, '#336699', true).split(',')[1]!, 'base64')

/** A fake web: only the given addresses answer, with a PNG. */
const web = (answers: Record<string, Buffer>) => {
  const asked: string[] = []
  const open: PhotoOpener = vi.fn(async (url: URL) => {
    asked.push(url.href)
    const body = answers[url.href]
    return {
      status: body ? 200 : 404,
      contentType: 'image/png',
      body: (async function* () {
        if (body) yield body
      })(),
      cancel: () => {}
    }
  })
  return { open, asked }
}

const email = (body: string) =>
  `<!doctype html><html><body><table width="600"><tr><td>${body}</td></tr></table></body></html>`

describe('an uploaded email made ready (DES-ENGINE-003)', () => {
  it('keeps an own design’s pictures from the file and the fixed hosts, each at its placeholder with its own size', async () => {
    const { open, asked } = web({
      'https://cdn.shopify.com/s/files/hero.png': png(60, 30),
      'https://mcusercontent.com/abc/logo.png': png(20, 10)
    })
    const inline = picture(40, 40, '#aa0000', true)
    const html = email(
      `<img src="https://cdn.shopify.com/s/files/hero.png" width="600" height="300" alt="Hero">` +
        `<img src="cid:Logo@1" alt="Logo">` +
        `<img src="${inline}" width="200">` +
        `<img src="https://mcusercontent.com/abc/logo.png">` +
        // The same picture twice is kept once.
        `<img src="https://cdn.shopify.com/s/files/hero.png" width="300" height="150">` +
        `<img src="https://tracker.example/pixel.gif" width="1" height="1">` +
        `<img src="https://images.example/photo.jpg" width="600" height="400">`
    )
    const got = await prepareUpload(
      html,
      [{ contentId: 'logo@1', type: 'image/png', bytes: png(30, 12) }],
      'own',
      { open }
    )
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(
      got.pictures.map((p) => [p.index, p.type, p.width, p.height, p.from])
    ).toEqual([
      [0, 'image/png', 60, 30, 'web'],
      [1, 'image/png', 30, 12, 'file'],
      [2, 'image/png', 40, 40, 'file'],
      [3, 'image/png', 20, 10, 'web']
    ])
    // Only the fixed hosts were asked, never the others.
    expect(asked.sort()).toEqual([
      'https://cdn.shopify.com/s/files/hero.png',
      'https://mcusercontent.com/abc/logo.png'
    ])
    expect(got.missing).toEqual([
      {
        host: 'tracker.example',
        count: 1,
        why: 'it is hosted on a site GROS doesn’t load photos from yet'
      },
      {
        host: 'images.example',
        count: 1,
        why: 'it is hosted on a site GROS doesn’t load photos from yet'
      }
    ])
    // Each picture read is an empty drawing of its own size, its
    // placeholder beside it; the file's own picture data is not in it.
    expect(got.html).toContain(
      `data-de-src="${picturePlaceholder(0, 'image/png')}"`
    )
    expect(
      got.html.match(/data-de-src="https:\/\/email-uploads\.invalid\/0\.png"/g)
    ).toHaveLength(2)
    expect(got.html).toContain(
      `data-de-src="${picturePlaceholder(1, 'image/png')}"`
    )
    expect(got.html).not.toContain(inline)
    expect(got.html).not.toContain('cid:')
    expect(got.html).toContain(
      Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"/>'
      ).toString('base64')
    )
    // A picture that could not be read stays as it was.
    expect(got.html).toContain('https://images.example/photo.jpg')
    // Marked into sections by our own splitter.
    expect(got.html).toMatch(/data-gr-section="1"/)
  })

  it('keeps nothing of another brand’s pictures, only their sizes', async () => {
    const { open } = web({ 'https://cdn.shopify.com/a.png': png(60, 30) })
    const got = await prepareUpload(
      email(
        `<img src="https://cdn.shopify.com/a.png"><img src="${picture(10, 10, '#000000', true)}">`
      ),
      [],
      'other',
      { open }
    )
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.pictures).toEqual([])
    expect(got.html).toContain(
      'data-de-src="https://email-uploads.invalid/0.png"'
    )
    expect(got.html).toContain(
      'data-de-src="https://email-uploads.invalid/1.png"'
    )
  })

  it('removes the file’s own marks before marking it', async () => {
    const got = await prepareUpload(
      email(
        `<p data-gr-section="9" data-de-src="https://evil.example/x.png">Hi</p>`
      ),
      [],
      'own'
    )
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.html).not.toContain('evil.example')
    expect(got.html).not.toContain('data-gr-section="9"')
  })

  it('says why a picture inside the file cannot be used', async () => {
    const got = await prepareUpload(
      email(`<img src="cid:missing"><img src="cid:notapicture">`),
      [
        {
          contentId: 'notapicture',
          type: 'image/png',
          bytes: Buffer.from('hello')
        }
      ],
      'own'
    )
    expect(got.ok).toBe(true)
    if (!got.ok) return
    expect(got.pictures).toEqual([])
    expect(got.missing).toEqual([
      { host: 'the file', count: 1, why: 'it is not inside the file' },
      {
        host: 'the file',
        count: 1,
        why: 'it is not a PNG, JPEG, WebP or GIF picture'
      }
    ])
  })

  it('never fetches an http picture, a private address or a redirect', async () => {
    const open: PhotoOpener = vi.fn(async () => ({
      status: 302,
      contentType: 'image/png',
      body: (async function* () {})(),
      cancel: () => {}
    }))
    const got = await prepareUpload(
      email(
        `<img src="http://cdn.shopify.com/a.png"><img src="https://cdn.shopify.com/moved.png">`
      ),
      [],
      'own',
      { open }
    )
    expect(got.ok && got.pictures).toEqual([])
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('refuses an email too large to measure', async () => {
    const got = await prepareUpload(email('x'.repeat(2_100_000)), [], 'own')
    expect(got).toEqual({ ok: false, code: 'too_large_to_measure' })
  })

  it('reads a placeholder back to its picture', () => {
    expect(placeholderIndex(picturePlaceholder(7, 'image/jpeg'))).toBe(7)
    expect(placeholderIndex('https://email-uploads.invalid/7.jpg?x')).toBe(null)
    expect(placeholderIndex('https://cdn.shopify.com/7.jpg')).toBe(null)
    expect(placeholderIndex(null)).toBe(null)
  })
})
