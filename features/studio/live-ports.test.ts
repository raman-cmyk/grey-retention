// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const jobs = vi.hoisted(() => ({ requestSectionRender: vi.fn() }))
vi.mock('./render-jobs', () => jobs)
const reads = vi.hoisted(() => ({ buildRenders: vi.fn() }))
vi.mock('./waits', () => reads)
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
import { pictureLinkSeconds, studioPortsFor } from './live-ports'
import type { BuildRender } from './waits'

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

/** Storage that answers `info` with these tags in turn, and downloads `bytes`. */
function storage(
  options: {
    tags?: (string | null)[]
    download?: Uint8Array | null
    signed?: string | null
  } = {}
) {
  const tags = [...(options.tags ?? ['abc'])]
  const calls: unknown[][] = []
  const files = {
    info: vi.fn(async (path: string) => {
      calls.push(['info', path])
      const tag = tags.length > 1 ? tags.shift() : tags[0]
      return tag === null
        ? { data: null, error: { message: 'x' } }
        : { data: { etag: tag }, error: null }
    }),
    download: vi.fn(async (path: string) => {
      calls.push(['download', path])
      const bytes =
        options.download === undefined
          ? new Uint8Array([1, 2, 3, 4])
          : options.download
      return bytes
        ? { data: new Blob([bytes as Uint8Array<ArrayBuffer>]), error: null }
        : { data: null, error: { message: 'x' } }
    }),
    createSignedUrl: vi.fn(async (path: string, seconds: number) => {
      calls.push(['sign', path, seconds])
      const url =
        options.signed === undefined
          ? `https://db.example/storage/v1/object/sign/studio-renders/${path}?token=t`
          : options.signed
      return url
        ? { data: { signedUrl: url }, error: null }
        : { data: null, error: { message: 'x' } }
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
const ai = vi.fn()
const ports = (
  s: ReturnType<typeof storage>,
  over: { until?: number; now?: () => number } = {}
) => {
  const fallbacks = memoryFallbackLog()
  return {
    fallbacks,
    ports: studioPortsFor(s.db, {
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
      until: over.until ?? 100_000,
      now: over.now ?? (() => 0)
    })
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('the design studio’s ports in the build (DST-006c part 2b)', () => {
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
    // A tag read as W/"abc" or "abc" is the same tag.
    expect(
      await ports(storage({ tags: ['W/"abc"', '"abc"'] })).ports.picture(
        drawn,
        's2'
      )
    ).not.toBeNull()
  })

  it('signs a year-long https link only for a picture of this build still drawn as recorded', async () => {
    reads.buildRenders.mockResolvedValue([drawn])
    const s = storage()
    expect(await ports(s).ports.sign(render)).toBe(
      `https://db.example/storage/v1/object/sign/studio-renders/${drawn.path}?token=t`
    )
    expect(reads.buildRenders).toHaveBeenCalledWith(s.db, { tenant, build })
    expect(s.calls).toContainEqual(['sign', drawn.path, pictureLinkSeconds])
    expect(pictureLinkSeconds).toBe(365 * 24 * 3600)
    // Not this build's, not drawn, changed, not signed, or not https.
    reads.buildRenders.mockResolvedValue([])
    expect(await ports(storage()).ports.sign(render)).toBeNull()
    reads.buildRenders.mockResolvedValue([
      { id: render, key: 'k', state: 'queued' }
    ])
    expect(await ports(storage()).ports.sign(render)).toBeNull()
    reads.buildRenders.mockResolvedValue([drawn])
    for (const bad of [
      storage({ tags: ['changed'] }),
      storage({ signed: null }),
      storage({ signed: 'http://127.0.0.1:54321/x.jpg' })
    ])
      expect(await ports(bad).ports.sign(render)).toBeNull()
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
      callerKey: `email-build:${build}`,
      ai,
      fallbacks
    })
    await p.design({} as never, undefined)
    const ctx = agents.designSection.mock.calls[0]![1]
    expect(ctx).toMatchObject({ tenantId: tenant, ai })
    expect(ctx.fits()).toBe(true)
    await p.critique({} as never, {} as never)
    expect(agents.critiqueSection.mock.calls[0]![0]).toEqual({
      brief: {},
      image: {}
    })
  })

  it('counts each agent call and its slack before the claim’s end', () => {
    const { ports: p } = ports(storage(), { until: 47_000 })
    expect(p.fits()).toBe(true)
    expect(p.fits(3)).toBe(true)
    expect(p.fits(4)).toBe(false)
    const late = ports(storage(), { until: 16_999 }).ports
    expect(late.fits()).toBe(false)
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
})
