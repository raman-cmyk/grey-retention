// @vitest-environment node
import { matchScore } from './match'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const fontSource = vi.hoisted(() => ({ brandFonts: vi.fn() }))
vi.mock('@/features/onboarding/brand-fonts', () => fontSource)
const jobs = vi.hoisted(() => ({ requestSectionRender: vi.fn() }))
vi.mock('./render-jobs', () => jobs)
const reads = vi.hoisted(() => ({ buildRenders: vi.fn(), buildViews: vi.fn() }))
vi.mock('./waits', () => reads)
const previews = vi.hoisted(() => ({ requestEmailRender: vi.fn() }))
vi.mock('./preview-jobs', () => ({
  emailViewNames: ['desktop', 'phone', 'dark'],
  requestEmailRender: previews.requestEmailRender
}))
const emailCritic = vi.hoisted(() => ({ critiqueEmail: vi.fn() }))
// DST-004c: the inbox's stored section crops.
const crops = vi.hoisted(() => ({
  pictureTimeoutMs: 3_000,
  storedPicture: vi.fn(
    async (): Promise<
      { mediaType: 'image/jpeg'; base64: string } | undefined
    > => undefined
  )
}))
vi.mock('@/features/inbox/pictures', () => crops)
vi.mock('./email-critic', () => emailCritic)
const agents = vi.hoisted(() => ({
  storyboardFor: vi.fn(),
  designSection: vi.fn(),
  critiqueSection: vi.fn()
}))
vi.mock('./storyboard', async (original) => ({
  ...(await original<typeof import('./storyboard')>()),
  storyboardFor: agents.storyboardFor
}))
vi.mock('./designer', async (original) => ({
  ...(await original<typeof import('./designer')>()),
  designSection: agents.designSection
}))
vi.mock('./critic', async (original) => ({
  ...(await original<typeof import('./critic')>()),
  critiqueSection: agents.critiqueSection
}))
import { InMemoryMemoryStore } from '@/features/agents/memory'
import { InMemoryRunLog } from '@/features/agents/runtime'
import { memoryFallbackLog } from '@/features/fallback/log'
import {
  emailPortsFor,
  noPhotos,
  photoOf,
  sectionFonts,
  pictureLinkSeconds,
  studioPortsFor,
  viewKey,
  type DrawnView
} from './live-ports'
import type { BuildRender, BuildView } from './waits'

const tenant = '00000000-0000-4000-8000-000000000101'
const build = '44444444-4444-4444-8444-444444444444'
const lease = '22222222-2222-4222-8222-222222222222'
const render = '00000001-3333-4333-8333-333333333333'
const drawn: Extract<BuildRender, { state: 'drawn' }> = {
  id: render,
  key: 's2-r1-x',
  state: 'drawn',
  path: `render/${render}.jpg`,
  height: 640,
  bytes: 4,
  etag: '"abc"'
}

/**
 * Storage: `info` answers the render's path with `tags` in turn and the
 * final copy's path with `finalTags` (missing, then copied, by default);
 * `copy` answers `copy`; downloads `bytes`.
 */
function storage(
  options: {
    tags?: (string | null)[]
    finalTags?: (string | null)[]
    copy?: { statusCode: string } | null
    download?: Uint8Array | null
    signed?: string | null
  } = {}
) {
  const tags = [...(options.tags ?? ['abc'])]
  const finalTags = [...(options.finalTags ?? [null, 'abc'])]
  const calls: unknown[][] = []
  const answer = (tag: string | null | undefined) =>
    tag === null
      ? { data: null, error: { statusCode: '404', message: 'Not found' } }
      : tag === 'down'
        ? { data: null, error: { statusCode: '500', message: 'down' } }
        : { data: { etag: tag }, error: null }
  const next = (list: (string | null)[]) =>
    list.length > 1 ? list.shift() : list[0]
  const files = {
    info: vi.fn(async (path: string) => {
      calls.push(['info', path])
      return answer(next(path.startsWith('final/') ? finalTags : tags))
    }),
    copy: vi.fn(async (from: string, to: string) => {
      calls.push(['copy', from, to])
      return options.copy
        ? { data: null, error: { ...options.copy, message: 'x' } }
        : { data: { path: to }, error: null }
    }),
    download: vi.fn(async (path: string) => {
      calls.push(['download', path])
      const bytes =
        options.download === undefined
          ? new Uint8Array([1, 2, 3, 4])
          : options.download
      return bytes
        ? { data: new Blob([bytes as Uint8Array<ArrayBuffer>]), error: null }
        : { data: null, error: { statusCode: '404', message: 'Not found' } }
    }),
    createSignedUrl: vi.fn(async (path: string, seconds: number) => {
      calls.push(['sign', path, seconds])
      const url =
        options.signed === undefined
          ? `https://db.example/storage/v1/object/sign/studio-renders/${path}?token=t`
          : options.signed
      return url
        ? { data: { signedUrl: url }, error: null }
        : { data: null, error: { statusCode: '404', message: 'Not found' } }
    })
  }
  return {
    calls,
    files,
    db: {
      storage: {
        from: (bucket: string) => (calls.push(['bucket', bucket]), files)
      }
    } as never
  }
}
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])
const photos = {
  fetch: vi.fn(async () => ({ ok: true as const, bytes: jpeg }))
}
const ai = vi.fn()
const ports = (
  s: ReturnType<typeof storage>,
  over: { until?: number; now?: () => number; sample?: boolean } = {}
) => {
  const fallbacks = memoryFallbackLog()
  return {
    fallbacks,
    ports: studioPortsFor(s.db, {
      tenant,
      sample: over.sample,
      build,
      lease,
      agents: {
        memory: new InMemoryMemoryStore(),
        log: new InMemoryRunLog(),
        ai
      },
      fallbacks,
      callerKey: `email-build:${build}`,
      industry: 'home',
      photos,
      until: over.until ?? 100_000,
      now: over.now ?? (() => 0)
    })
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('the design studio’s ports in the build (DST-006c part 2b)', () => {
  it('loads the collected font faces only for the explicitly real leased workspace', async () => {
    const face = {
      family: 'Cedar Serif',
      url: 'https://cdn.shopify.com/cedar.woff2',
      weight: 700
    }
    fontSource.brandFonts.mockResolvedValue([{ faces: [face] }])
    const s = storage()
    expect(await ports(s).ports.fonts!()).toEqual([])
    expect(await ports(s, { sample: true }).ports.fonts!()).toEqual([])
    expect(fontSource.brandFonts).not.toHaveBeenCalled()
    expect(await ports(s, { sample: false }).ports.fonts!()).toEqual([face])
    expect(fontSource.brandFonts).toHaveBeenCalledWith(s.db, tenant)
  })

  it('keeps the existing retry behavior for a failed font read instead of silently changing brand fonts', async () => {
    fontSource.brandFonts.mockRejectedValue(
      new Error('synthetic database failure')
    )
    await expect(
      ports(storage(), { sample: false }).ports.fonts!()
    ).rejects.toThrow('synthetic database failure')
  })

  it('filters unsafe font URLs/names/weights, deduplicates faces and respects the renderer cap', () => {
    const face = {
      family: 'Cedar Serif',
      url: 'https://cdn.shopify.com/cedar.woff2',
      weight: 700
    }
    const unsafe = [
      { ...face, family: 'bad";css' },
      { ...face, weight: 10 },
      ...[
        'http://cdn.shopify.com/a.woff2',
        'https://127.0.0.1/a.woff2',
        'https://fonts.example.com/a.woff2',
        'https://cdn.shopify.com.evil.example.com/a.woff2',
        'https://localhost/a.woff2',
        'https://192.168.1.1/a.woff2',
        'https://user:pass@cdn.shopify.com/a.woff2',
        'https://cdn.shopify.com:444/a.woff2',
        'not a url',
        'https://cdn.shopify.com/a.woff2#x'
      ].map((url) => ({ ...face, url }))
    ]
    expect(
      sectionFonts([
        ...unsafe,
        face,
        { ...face, url: 'https://fonts.gstatic.com/same-face.woff2' }
      ])
    ).toEqual([face])
    expect(
      sectionFonts(
        Array.from({ length: 8 }, (_, i) => ({
          ...face,
          weight: 100 + i * 100
        }))
      )
    ).toHaveLength(4)
  })
  it('allows exact known font CDNs and excludes custom domains until renderer DNS pinning exists', () => {
    for (const host of [
      'cdn.shopify.com',
      'fonts.gstatic.com',
      'use.typekit.net',
      'fonts.bunny.net',
      'fast.fonts.net',
      'cloud.typography.com',
      'fonts.cdnfonts.com'
    ]) {
      const face = { family: 'Cedar Serif', url: `https://${host}/cedar.woff2` }
      expect(sectionFonts([face])).toEqual([face])
    }
    expect(
      sectionFonts([
        { family: 'Cedar Serif', url: 'https://brand.example.com/font.woff2' }
      ])
    ).toEqual([])
  })

  it('reads a picture back only while its tag is the one recorded, before and after', async () => {
    const ok = storage({ tags: ['abc', 'abc'] })
    expect(await ports(ok).ports.picture(drawn, 's2')).toEqual({
      id: 's2',
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: 'image/jpeg',
      width: 1200,
      height: 1280
    })
    expect(ok.calls.filter((c) => c[0] !== 'bucket')).toEqual([
      ['info', drawn.path],
      ['download', drawn.path],
      ['info', drawn.path]
    ])
    for (const s of [
      storage({ tags: ['other'] }),
      storage({ tags: [null] }),
      storage({ download: null }),
      storage({ tags: ['abc', 'changed'] })
    ])
      expect(await ports(s).ports.picture(drawn, 's2')).toBeNull()
    // A tag that is an MD5 must be the downloaded bytes' own.
    const md5 = createHash('md5')
      .update(new Uint8Array([1, 2, 3, 4]))
      .digest('hex')
    const own = { ...drawn, etag: `"${md5}"` }
    expect(
      await ports(storage({ tags: [md5, md5] })).ports.picture(own, 's2')
    ).not.toBeNull()
    const other = { ...drawn, etag: `"${'0'.repeat(32)}"` }
    expect(
      await ports(storage({ tags: ['0'.repeat(32)] })).ports.picture(
        other,
        's2'
      )
    ).toBeNull()
    // A tag read as "abc" is the same tag; a weak or an empty one is not.
    expect(
      await ports(storage({ tags: ['"abc"', 'abc'] })).ports.picture(
        drawn,
        's2'
      )
    ).not.toBeNull()
    for (const tag of ['W/"abc"', '""'])
      expect(
        await ports(storage({ tags: [tag] })).ports.picture(drawn, 's2')
      ).toBeNull()
    // Storage down: it throws (the step is tried again), never coded.
    await expect(
      ports(storage({ tags: ['down'] })).ports.picture(drawn, 's2')
    ).rejects.toMatchObject({ statusCode: '500' })
  })

  it('signs a year-long https link only for a picture of this build still drawn as recorded', async () => {
    reads.buildRenders.mockResolvedValue([drawn])
    const s = storage()
    const final = `final/${render}.jpg`
    expect(await ports(s).ports.sign(drawn)).toBe(
      `https://db.example/storage/v1/object/sign/studio-renders/${final}?token=t`
    )
    // Only to check the picture: never its grids (DST-004b2d).
    expect(reads.buildRenders).toHaveBeenCalledWith(
      s.db,
      { tenant, build },
      { grids: false }
    )
    // Copied from the picture as recorded, checked before and after, and
    // the copy linked: no upload link reaches it.
    expect(s.calls.filter((c) => c[0] !== 'bucket')).toEqual([
      ['info', final],
      ['info', drawn.path],
      ['copy', drawn.path, final],
      ['info', drawn.path],
      ['info', final],
      ['sign', final, pictureLinkSeconds]
    ])
    // Copied by an earlier claim: the copy is used as it is.
    const made = storage({ finalTags: ['abc'] })
    expect(await ports(made).ports.sign(drawn)).not.toBeNull()
    expect(made.calls.some((c) => c[0] === 'copy')).toBe(false)
    // A copy there already (409) is used when its tag is the picture's.
    const raced = storage({ copy: { statusCode: '409' } })
    expect(await ports(raced).ports.sign(drawn)).not.toBeNull()
    // Another picture at the copy's path, or a copy that changed: none.
    expect(
      await ports(storage({ finalTags: [null, 'other'] })).ports.sign(drawn)
    ).toBeNull()
    expect(
      await ports(storage({ tags: ['abc', 'changed'] })).ports.sign(drawn)
    ).toBeNull()
    // Changed before the copy: nothing is copied.
    const changed = storage({ tags: ['changed'] })
    expect(await ports(changed).ports.sign(drawn)).toBeNull()
    expect(changed.calls.some((c) => c[0] === 'copy')).toBe(false)
    // A copy there already with another tag (409): none.
    expect(
      await ports(
        storage({ copy: { statusCode: '409' }, finalTags: [null, 'other'] })
      ).ports.sign(drawn)
    ).toBeNull()
    // Storage down reading the copy: it throws.
    await expect(
      ports(storage({ finalTags: ['down'] })).ports.sign(drawn)
    ).rejects.toMatchObject({ statusCode: '500' })
    // Storage down while copying: it throws, never an unlinked hero.
    await expect(
      ports(storage({ copy: { statusCode: '500' } })).ports.sign(drawn)
    ).rejects.toMatchObject({ statusCode: '500' })
    expect(pictureLinkSeconds).toBe(365 * 24 * 3600)
    // Not this build's, not drawn, changed, not signed, or not https.
    reads.buildRenders.mockResolvedValue([])
    expect(await ports(storage()).ports.sign(drawn)).toBeNull()
    reads.buildRenders.mockResolvedValue([
      { id: render, key: 'k', state: 'queued' }
    ])
    expect(await ports(storage()).ports.sign(drawn)).toBeNull()
    // The database down: it throws, never an unlinked hero.
    reads.buildRenders.mockRejectedValueOnce(new Error('down'))
    await expect(ports(storage()).ports.sign(drawn)).rejects.toThrow('down')
    // Drawn again since (another tag): not the picture the studio saw.
    reads.buildRenders.mockResolvedValue([{ ...drawn, etag: '"new"' }])
    expect(await ports(storage()).ports.sign(drawn)).toBeNull()
    reads.buildRenders.mockResolvedValue([drawn])
    for (const bad of [
      storage({ tags: ['changed'] }),
      storage({ signed: null }),
      storage({ signed: 'http://127.0.0.1:54321/x.jpg' })
    ])
      expect(await ports(bad).ports.sign(drawn)).toBeNull()
  })

  it('asks for a picture under the build’s own lease, and reads this build’s pictures', async () => {
    jobs.requestSectionRender.mockResolvedValue(render)
    const s = storage()
    const { ports: p } = ports(s)
    const section = { id: 's2', height: 640, html: '<p>x</p>', css: '' }
    expect(
      await p.request({ key: 'k', section, hosts: ['cdn.shop.example'] })
    ).toBe(render)
    expect(jobs.requestSectionRender).toHaveBeenCalledWith(s.db, {
      build,
      lease,
      key: 'k',
      section,
      hosts: ['cdn.shop.example']
    })
    reads.buildRenders.mockResolvedValue([drawn])
    expect(await p.renders()).toEqual([drawn])
  })

  it('runs the agents through the build’s metered AI, the designer with its time', async () => {
    const { ports: p, fallbacks } = ports(storage(), { until: 40_000 })
    await p.storyboard({ mode: 'scratch', slot: {} as never, sections: [] })
    expect(agents.storyboardFor.mock.calls[0]![1]).toMatchObject({
      tenantId: tenant,
      industry: 'home',
      callerKey: `email-build:${build}`,
      ai,
      fallbacks
    })
    await p.design({} as never, undefined)
    const ctx = agents.designSection.mock.calls[0]![1]
    expect(ctx).toMatchObject({ tenantId: tenant, ai })
    expect(ctx.fits()).toBe(true)
    const brief = { image: { url: 'https://cdn.shop.example/p.jpg' } }
    // With the critic's tries and the photo's time left.
    const roomy = ports(storage()).ports
    await roomy.critique(brief as never, {} as never)
    // The product's own photo goes to the critic, within its limits.
    expect(photos.fetch).toHaveBeenCalledWith(
      'https://cdn.shop.example/p.jpg',
      {
        maxBytes: 3 * 1024 * 1024,
        timeoutMs: 8_000
      }
    )
    expect(agents.critiqueSection.mock.calls[0]![0]).toEqual({
      brief,
      image: {},
      photo: {
        mediaType: 'image/jpeg',
        base64: Buffer.from(jpeg).toString('base64')
      }
    })
    // A photo that cannot be read, or is no picture the critic takes: none.
    for (const got of [
      { ok: false as const, failure: 'timeout' as const },
      { ok: true as const, bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]) }
    ]) {
      photos.fetch.mockResolvedValueOnce(got as never)
      await ports(storage()).ports.critique(brief as never, {} as never)
      expect(agents.critiqueSection.mock.calls.at(-1)![0]).toEqual({
        brief,
        image: {}
      })
    }
  })

  it('fetches the photo once a claim, only in the time the critic leaves, and never throws for it', async () => {
    photos.fetch.mockClear()
    const brief = { image: { url: 'https://cdn.shop.example/p.jpg' } }
    const p = ports(storage(), { until: 50_000 }).ports
    await p.critique(brief as never, {} as never)
    await p.critique(brief as never, {} as never)
    // 50 s less the critic's 3 × 15 s and the slack: 3 s for the photo.
    expect(photos.fetch).toHaveBeenCalledTimes(1)
    expect(photos.fetch).toHaveBeenCalledWith(brief.image.url, {
      maxBytes: 3 * 1024 * 1024,
      timeoutMs: 3_000
    })
    // No time for it: no fetch, the critic goes without.
    const tight = ports(storage(), { until: 47_500 }).ports
    await tight.critique(brief as never, {} as never)
    expect(photos.fetch).toHaveBeenCalledTimes(1)
    // A fetcher that throws: no photo, never a failed step.
    photos.fetch.mockRejectedValueOnce(new Error('boom'))
    await ports(storage()).ports.critique(brief as never, {} as never)
    expect(agents.critiqueSection.mock.calls.at(-1)![0]).not.toHaveProperty(
      'photo'
    )
    expect(
      await noPhotos.fetch('https://x.example/p.jpg', {} as never)
    ).toEqual({ ok: false, failure: 'blocked' })
  })

  it('counts each agent call and its slack before the claim’s end', () => {
    const { ports: p } = ports(storage(), { until: 47_000 })
    expect(p.fits()).toBe(true)
    expect(p.fits(3)).toBe(true)
    expect(p.fits(4)).toBe(false)
    const late = ports(storage(), { until: 16_999 }).ports
    expect(late.fits()).toBe(false)
  })

  it('scores a render’s two grids, only for the crop the brief rebuilds (DST-004b2d)', async () => {
    const { ports: p } = ports(storage())
    const crop = 'sect/00000000-0000-4000-8000-0000000000a1/1.jpg'
    const grid = {
      width: 24,
      height: 12,
      values: Array.from({ length: 288 }, (_, i) => (i % 24 < 12 ? 40 : 245))
    }
    const render = {
      id: '00000001-3333-4333-8333-333333333333',
      key: 's2-r1-x',
      state: 'drawn' as const,
      path: 'render/00000001-3333-4333-8333-333333333333.jpg',
      height: 320,
      bytes: 1,
      etag: 'e',
      grids: { drawn: grid, reference: grid, referencePath: crop }
    }
    const copied = {
      mode: 'copy',
      reference: { tone: 'dark', height: 320, image: crop }
    } as unknown as Parameters<NonNullable<typeof p.match>>[0]
    expect(await p.match!(copied, render)).toBe(10)
    // The drawing against the crop, never the other way round: the score
    // takes its rows from the reference's proportions.
    const wide = {
      width: 24,
      height: 4,
      values: Array.from({ length: 96 }, (_, i) => (i % 24 < 12 ? 40 : 245))
    }
    const tall = {
      width: 24,
      height: 48,
      values: Array.from({ length: 1152 }, (_, i) =>
        Math.floor(i / 24) < 24 ? 40 : 245
      )
    }
    const asked = await p.match!(copied, {
      ...render,
      grids: { drawn: wide, reference: tall, referencePath: crop }
    })
    expect(asked).toBe(matchScore(wide, tall))
    expect(asked).not.toBe(matchScore(tall, wide))
    // Another crop's grids, or none: not measured.
    expect(
      await p.match!(
        {
          ...copied,
          reference: {
            tone: 'dark',
            height: 320,
            image: crop.replace('1.jpg', '2.jpg')
          }
        },
        render
      )
    ).toBeNull()
    expect(await p.match!(copied, { ...render, grids: undefined })).toBeNull()
  })

  it('logs each coded section once, in the owner’s words', async () => {
    const { ports: p, fallbacks } = ports(storage())
    await p.coded('s2', 'render_timed_out')
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        tenantId: tenant,
        agent: 'design-studio',
        reasonCode: 'studio_render_timed_out',
        reason: 'The picture did not come in time.',
        fallback: 'Drew the section as its coded block.',
        detail: { section: 's2' }
      })
    ])
  })

  it('says a copied email whose heights do not fit is designed from scratch (DST-002b)', async () => {
    const { ports: p, fallbacks } = ports(storage())
    await p.coded('email', 'reference_unfit')
    expect(fallbacks.entries()).toEqual([
      expect.objectContaining({
        reasonCode: 'studio_reference_unfit',
        reason:
          'The copied email’s section heights do not fit this email’s sections.',
        fallback:
          'Designed the email’s sections from scratch, in the copied order.',
        detail: { section: 'email' }
      })
    ])
  })

  it('knows a photo the critic takes by its bytes', () => {
    expect(
      photoOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]))?.mediaType
    ).toBe('image/png')
    expect(
      photoOf(
        new Uint8Array([
          0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50
        ])
      )?.mediaType
    ).toBe('image/webp')
    expect(photoOf(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull()
  })
})

describe('the whole-email check’s ports in the build (DST-006d part 2a)', () => {
  const view = '00000002-3333-4333-8333-333333333333'
  const phone: DrawnView = {
    id: view,
    key: 'e-abc',
    view: 'phone',
    state: 'drawn',
    path: `email/${view}.jpg`,
    height: 2100,
    cut: false,
    wide: true,
    bytes: 4,
    etag: '"abc"'
  }
  const email = { emailType: 'launch', angle: 'Meet the tray', brand: 'Grove' }
  const portsOf = (s: ReturnType<typeof storage>) => {
    const fallbacks = memoryFallbackLog()
    return emailPortsFor(s.db, {
      tenant,
      build,
      lease,
      agents: {
        memory: new InMemoryMemoryStore(),
        log: new InMemoryRunLog(),
        ai
      },
      fallbacks,
      callerKey: `email-build:${build}`,
      industry: 'home',
      email
    })
  }

  it('keys a version of the email by its HTML, as the database takes a key', () => {
    const key = viewKey('<p>x</p>')
    expect(key).toBe(viewKey('<p>x</p>'))
    expect(key).not.toBe(viewKey('<p>y</p>'))
    expect(key).toMatch(/^[a-z0-9-]{1,40}$/)
  })

  it('asks for the three views under the build’s own lease, with the brand for the footer', async () => {
    previews.requestEmailRender.mockResolvedValue(view)
    const s = storage()
    await portsOf(s).ask('e-abc', '<p>x</p>')
    expect(previews.requestEmailRender.mock.calls.map((c) => c[1])).toEqual(
      ['desktop', 'phone', 'dark'].map((v) => ({
        build,
        lease,
        key: 'e-abc',
        view: v,
        html: '<p>x</p>',
        brandName: 'Grove'
      }))
    )
    // A refusal comes through as it is.
    previews.requestEmailRender.mockRejectedValueOnce({ code: 'PT409' })
    await expect(
      portsOf(storage()).ask('e-abc', '<p>y</p>')
    ).rejects.toMatchObject({ code: 'PT409' })
  })

  it('reads only this version’s views, in the build’s own workspace', async () => {
    const other: BuildView = {
      id: render,
      key: 'e-old',
      view: 'desktop',
      state: 'queued'
    }
    reads.buildViews.mockResolvedValue([other, phone])
    const s = storage()
    expect(await portsOf(s).views('e-abc')).toEqual([phone])
    expect(reads.buildViews).toHaveBeenCalledWith(s.db, { tenant, build })
  })

  it('reads a view’s picture back only while its tag, size and bytes are the ones recorded', async () => {
    const jpeg4 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    const ok = storage({ tags: ['abc', 'abc'], download: jpeg4 })
    expect(await portsOf(ok).picture(phone)).toEqual({
      bytes: jpeg4,
      contentType: 'image/jpeg',
      width: 375,
      height: 2100,
      cut: false,
      wide: true
    })
    expect(ok.calls.filter((c) => c[0] !== 'bucket')).toEqual([
      ['info', phone.path],
      ['download', phone.path],
      ['info', phone.path]
    ])
    for (const s of [
      storage({ tags: ['other'], download: jpeg4 }),
      storage({ tags: [null], download: jpeg4 }),
      storage({ download: null }),
      storage({ tags: ['abc', 'changed'], download: jpeg4 }),
      // Not the size recorded, or not a JPEG.
      storage({ download: new Uint8Array([0xff, 0xd8, 0xff]) }),
      storage({ download: new Uint8Array([1, 2, 3, 4]) })
    ])
      expect(await portsOf(s).picture(phone)).toBeNull()
    // A single upload's tag is its bytes' MD5: other bytes under it are refused.
    const md5 = createHash('md5').update(jpeg4).digest('hex')
    const tagged = { ...phone, etag: `"${md5}"` }
    expect(
      await portsOf(storage({ tags: [md5, md5], download: jpeg4 })).picture(
        tagged
      )
    ).not.toBeNull()
    const other = '0'.repeat(32)
    expect(
      await portsOf(storage({ tags: [other, other], download: jpeg4 })).picture(
        { ...phone, etag: `"${other}"` }
      )
    ).toBeNull()
    await expect(
      portsOf(storage({ tags: ['down'] })).picture(phone)
    ).rejects.toMatchObject({ statusCode: '500' })
  })

  it('asks the Design critic about the whole email, through the build’s metered AI', async () => {
    emailCritic.critiqueEmail.mockResolvedValue({
      pass: true,
      scores: {},
      problems: []
    })
    const views = { desktop: {} as never, phone: {} as never }
    expect(await portsOf(storage()).judge(views)).toMatchObject({ pass: true })
    const [input, ctx] = emailCritic.critiqueEmail.mock.calls[0]!
    expect(input).toEqual({ email, views })
    expect(ctx).toMatchObject({
      tenantId: tenant,
      industry: 'home',
      callerKey: `email-build:${build}`,
      ai
    })
  })

  it('shows the Section designer and the critic the crop a Copy section rebuilds, read once a claim (DST-004c)', async () => {
    const crop = 'sect/00000000-0000-4000-8000-0000000000a1/1.jpg'
    const picture = { mediaType: 'image/jpeg' as const, base64: 'AAAA' }
    crops.storedPicture.mockResolvedValue(picture)
    const s = storage()
    const p = ports(s).ports
    const copy = {
      mode: 'copy',
      image: { url: 'https://cdn.shop.example/p.jpg' },
      reference: { tone: 'dark', height: 640, image: crop }
    }
    await p.design(copy as never, undefined)
    expect(agents.designSection.mock.calls[0]![3]).toEqual(picture)
    await p.critique(copy as never, {} as never)
    expect(agents.critiqueSection.mock.calls[0]![0]).toMatchObject({
      reference: picture
    })
    // Read once, from the inbox, within the picture's time limit.
    expect(crops.storedPicture).toHaveBeenCalledTimes(1)
    expect(crops.storedPicture).toHaveBeenCalledWith(s.db, crop, 3_000)
  })

  it('shows no crop for Scratch or Remix, a path that is not a crop, one that cannot be read, or no time', async () => {
    const crop = 'sect/00000000-0000-4000-8000-0000000000a1/1.jpg'
    const brief = (over: Record<string, unknown>) => ({
      mode: 'copy',
      image: { url: 'https://cdn.shop.example/p.jpg' },
      reference: { tone: 'dark', height: 640, image: crop },
      ...over
    })
    crops.storedPicture.mockResolvedValue({
      mediaType: 'image/jpeg',
      base64: 'AAAA'
    })
    for (const b of [
      brief({ mode: 'scratch' }),
      brief({ mode: 'remix' }),
      brief({ reference: { tone: 'dark', height: 640, image: 'shot/x.jpg' } }),
      brief({ reference: { tone: 'dark', height: 640 } })
    ]) {
      const p = ports(storage()).ports
      await p.design(b as never, undefined)
      expect(agents.designSection.mock.calls.at(-1)![3]).toBeUndefined()
    }
    expect(crops.storedPicture).not.toHaveBeenCalled()
    // It cannot be read: the agents go without it, never a failed step.
    crops.storedPicture.mockRejectedValueOnce(new Error('down'))
    const p = ports(storage()).ports
    await p.design(brief({}) as never, undefined)
    expect(agents.designSection.mock.calls.at(-1)![3]).toBeUndefined()
    // No time left for it before the critic's calls: not read.
    crops.storedPicture.mockClear()
    const tight = ports(storage(), { until: 47_500 }).ports
    await tight.critique(brief({}) as never, {} as never)
    expect(crops.storedPicture).not.toHaveBeenCalled()
  })
})
