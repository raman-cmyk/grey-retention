// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import type { LibraryCopyInput } from '@/features/design-engine/library-copy'
import type { PhotoTools } from '@/features/design-engine/photos'
import { linkOk, photoHosts, run, sectionOf, upload } from './design-copies.mjs'

const jpeg = `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`
const job = (n: number, uploads = 2) => ({
  job: `j${n}`,
  lease: `l${n}`,
  engine: 'v-test',
  input: {
    brand: { name: 'Cedar Studio' },
    products: [],
    words: { headline: [], body: [], button: [] },
    rules: { offer: null, maxDiscountPercent: 0 },
    vocabulary: ['Cedar Studio'],
    sourceNames: ['Pine & Co'],
    mode: 'klaviyo',
    // Never read: the photo hosts are the server's own list.
    origins: ['https://evil.test']
  },
  source: { width: 600 },
  html: `https://db.test/sign/inbox-raw/${n}.marked.html?token=t`,
  uploads: Array.from({ length: uploads }, (_, index) => ({
    index,
    url: `https://db.test/upload/${n}/${index}.jpg?token=u`
  })),
  origins: [
    'https://cdn.shopify.com',
    'http://plain.test',
    'https://x.test/path'
  ]
})
const made = (cuts = 1) => ({
  ok: true as const,
  html: '<img src="https://email-copies.invalid/0.jpg">',
  sections: [
    {
      ordinal: 1,
      kind: 'hero' as const,
      result: 'copied' as const,
      tries: 1,
      problems: [],
      fallback: null
    },
    {
      ordinal: 2,
      kind: 'offer' as const,
      result: 'library' as const,
      tries: 0,
      problems: [],
      fallback: {
        block: 'offer_banner' as never,
        blockName: 'Offer banner',
        reason:
          'Section 2 (offer) has a countdown timer, so it was built from the library’s Offer banner block.'
      }
    }
  ],
  pass: false,
  leaks: [],
  footerAdded: true,
  cuts: Array.from({ length: cuts }, (_, i) => ({
    placeholder: `https://email-copies.invalid/${i}.jpg`,
    inline: jpeg,
    width: 600,
    height: 300
  }))
})

afterEach(() => vi.unstubAllGlobals())

describe('the library copy browser (DES-ENGINE-002b2)', () => {
  it('fetches photos only from the server’s https hosts, never the job input’s', () => {
    expect(photoHosts(job(1).origins)).toEqual(['https://cdn.shopify.com'])
    expect(photoHosts('x')).toEqual([])
  })

  it('takes https links, or loopback ones for a local run', () => {
    expect(linkOk('https://db.test/a')).toBe(true)
    expect(linkOk('http://127.0.0.1:54321/a')).toBe(true)
    expect(linkOk('http://db.test/a')).toBe(false)
    expect(linkOk('file:///etc/passwd')).toBe(false)
  })

  it('keeps a section’s plain reason only when it was not copied', () => {
    const [copied, library] = made().sections.map((s) => sectionOf(s as never))
    expect(copied).toEqual({
      ordinal: 1,
      kind: 'hero',
      result: 'copied',
      reason: null
    })
    expect(library!.reason).toContain('countdown timer')
  })

  it('uploads a cut photo as a JPEG to its signed link, never anything else', async () => {
    const put = vi.fn(async () => new Response('{}'))
    await upload('https://db.test/u?token=1', jpeg, put as never)
    expect(put).toHaveBeenCalledWith(
      'https://db.test/u?token=1',
      expect.objectContaining({
        method: 'PUT',
        redirect: 'error',
        headers: { 'content-type': 'image/jpeg', 'x-upsert': 'true' }
      })
    )
    await expect(
      upload('https://db.test/u', 'data:image/png;base64,AAAA', put as never)
    ).rejects.toThrow('upload_failed')
    await expect(
      upload('http://db.test/u', jpeg, put as never)
    ).rejects.toThrow('upload_failed')
    await expect(upload(undefined, jpeg, put as never)).rejects.toThrow(
      'upload_failed'
    )
  })

  it('copies each email, uploads its cuts and reports the copy, a final failure or a retry; then carries the builds on', async () => {
    const queue = [[job(1)], [job(2, 0)], [job(3)], [job(4)], [job(5)], []]
    const posts: Record<string, unknown>[] = []
    const claims: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('https://app.test/')) {
          expect(init?.redirect).toBe('error')
          if (init?.method === 'POST') {
            posts.push(JSON.parse(String(init.body)))
            return new Response('{"ok":true}')
          }
          claims.push(url)
          if (url.endsWith('?carry=1'))
            return new Response('{"off":false,"builds":1,"ran":2}')
          return new Response(JSON.stringify({ jobs: queue.shift() ?? [] }))
        }
        if (url.includes('/3.marked'))
          return new Response('gone', { status: 404 })
        return new Response('<table data-gr-section="1"></table>')
      })
    )
    const inputs: LibraryCopyInput[] = []
    const hosts: string[][] = []
    const sent: string[] = []
    const answers = [
      made(1),
      made(1), // job 2 has no upload links: too many photos
      // job 3's HTML cannot be read: never copied
      { ok: false as const, error: 'could not draw' },
      made(1) // job 5: the upload fails
    ]
    const lines: string[] = []
    const counts = await run({
      base: 'https://app.test',
      secret: 'x'.repeat(40),
      browser: {} as Browser,
      log: (l) => lines.push(l),
      engine: 'v-test',
      tools: (origins) => {
        hosts.push(origins)
        return {} as PhotoTools
      },
      copy: async (_b, input) => {
        inputs.push(input)
        return answers.shift()! as never
      },
      send: async (url) => {
        if (url?.includes('/upload/5/')) throw new Error('upload_failed')
        sent.push(url ?? '')
      }
    })
    expect(counts).toEqual({
      copied: 1,
      failed: 2,
      retry: 2,
      skew: false,
      carried: 1
    })
    expect(claims.filter((u) => u.includes('?engine=v-test'))).toHaveLength(6)
    expect(claims.at(-1)).toBe(
      'https://app.test/api/internal/design/copies?carry=1'
    )
    // The copy gets the job's input, the original's HTML, the canvas cut
    // and photo tools on the server's https hosts only.
    expect(inputs[0]).toMatchObject({
      sourceHtml: '<table data-gr-section="1"></table>',
      sourceNames: ['Pine & Co'],
      mode: 'klaviyo',
      crop: 'canvas'
    })
    expect(inputs[0]).not.toHaveProperty('origins')
    expect(hosts[0]).toEqual(['https://cdn.shopify.com'])
    expect(sent).toEqual(['https://db.test/upload/1/0.jpg?token=u'])
    expect(posts).toEqual([
      {
        job: 'j1',
        lease: 'l1',
        engine: 'v-test',
        record: {
          html: '<img src="https://email-copies.invalid/0.jpg">',
          sections: made().sections.map((s) => sectionOf(s as never)),
          pass: false,
          leaks: [],
          footerAdded: true,
          photos: [0]
        }
      },
      { job: 'j2', lease: 'l2', engine: 'v-test', failure: 'too_many_photos' },
      { job: 'j3', lease: 'l3', retry: 'html_unreadable' },
      { job: 'j4', lease: 'l4', engine: 'v-test', failure: 'copy_failed' },
      { job: 'j5', lease: 'l5', retry: 'upload_failed' }
    ])
    expect(lines).toEqual([
      'Copies made: 1. Cannot be copied: 2. To try again: 2. Emails carried on: 1.'
    ])
  })

  it('says so when the app runs another engine version, and copies nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"jobs":[],"skew":true}'))
    )
    const counts = await run({
      base: 'https://app.test',
      secret: 'x'.repeat(40),
      browser: {} as Browser,
      log: () => undefined,
      engine: 'v-test',
      tools: () => ({}) as PhotoTools,
      copy: async () => {
        throw new Error('never')
      }
    })
    expect(counts).toMatchObject({ copied: 0, skew: true, carried: 0 })
  })
})
