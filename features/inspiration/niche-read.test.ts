// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const observer = vi.hoisted(() => ({
  enabled: vi.fn(() => false),
  allowed: vi.fn(async (rows: unknown[]) => rows)
}))
vi.mock('@/features/inbox/observer-sheet', () => ({
  observerEnabled: observer.enabled
}))
vi.mock('@/features/inbox/observer-access', () => ({
  observerAllowed: observer.allowed
}))
import { nicheEmails, nichePerBrand, nicheReadPerBrand } from './niche-read'

afterEach(() => {
  vi.clearAllMocks()
  observer.enabled.mockReturnValue(false)
  observer.allowed.mockImplementation(async (rows: unknown[]) => rows)
})

type Row = {
  id: string
  capture_id: string
  synthetic: boolean
  received_at: string
  screenshot_path: string | null
}
const row = (
  id: string,
  capture: string,
  synthetic: boolean,
  day = 10,
  shot: string | null = null
): Row => ({
  id,
  capture_id: capture,
  synthetic,
  received_at: `2026-11-${String(day).padStart(2, '0')}T10:00:00Z`,
  screenshot_path: shot
})

/** The server's client: emails per capture (newest first) and signing. */
function service(emails: Row[], options: { error?: { message: string } } = {}) {
  const asked: { capture: unknown; limit: unknown }[] = []
  const signed: string[][] = []
  const from = vi.fn(() => {
    let capture: unknown
    const chain = {
      select: () => chain,
      eq: (_: string, value: unknown) => {
        capture = value
        return chain
      },
      order: () => chain,
      limit: async (n: number) => {
        asked.push({ capture, limit: n })
        if (options.error) return { data: null, error: options.error }
        return {
          data: emails
            .filter((e) => e.capture_id === capture)
            .map((e) => ({
              ...e,
              external_id: `msg:${e.id}`,
              inbox_message_id: null,
              subject: `Subject ${e.id}`,
              text_content: 'Hello',
              safe_html: '<p>Hello</p>',
              screenshot_width: 600,
              screenshot_height: 900
            })),
          error: null
        }
      }
    }
    return chain
  })
  const storage = {
    from: () => ({
      createSignedUrls: async (paths: string[]) => {
        signed.push(paths)
        return {
          data: paths.map((path) => ({
            path,
            signedUrl: `https://signed.example/${path}`,
            error: null
          })),
          error: null
        }
      }
    })
  }
  return { db: { from, storage } as never, from, asked, signed }
}

const brands = [
  { captureId: 'sample', domain: 'bark.example', name: 'Bark Co' },
  { captureId: 'real', domain: 'wild.com', name: 'Wild Paws' }
]

describe('nicheEmails (GROS-INS-002)', () => {
  it('reads no real brand while the Observer source is off', async () => {
    const s = service([row('s1', 'sample', true), row('r1', 'real', false)])
    const items = await nicheEmails(s.db, brands)
    expect(s.asked.map((a) => a.capture)).toEqual(['sample'])
    expect(items.map((i) => [i.id, i.domain, i.from, i.sample])).toEqual([
      ['s1', 'bark.example', 'Bark Co', true]
    ])
  })

  it('keeps only what the human selection allows, under a brand of its own kind', async () => {
    observer.enabled.mockReturnValue(true)
    observer.allowed.mockImplementation(async (rows: unknown[]) =>
      (rows as Row[]).filter((r) => r.id !== 'r-unrated')
    )
    const s = service([
      row('s1', 'sample', true),
      // A real email under a sample brand, and a sample one under a real brand.
      row('s-real', 'sample', false),
      row('r-sample', 'real', true),
      row('r-rated', 'real', false),
      row('r-unrated', 'real', false)
    ])
    const items = await nicheEmails(s.db, brands)
    expect(s.asked).toEqual([
      { capture: 'sample', limit: nicheReadPerBrand },
      { capture: 'real', limit: nicheReadPerBrand }
    ])
    expect(observer.allowed).toHaveBeenCalledOnce()
    expect(items.map((i) => i.id)).toEqual(['s1', 'r-rated'])
  })

  it('shows the newest six per brand and signs only their screenshots', async () => {
    const many = Array.from({ length: nichePerBrand + 2 }, (_, i) =>
      row(`s${i}`, 'sample', true, 20 - i, `shots/s${i}.png`)
    )
    const s = service(many)
    const items = await nicheEmails(s.db, [brands[0]!])
    expect(items.map((i) => i.id)).toEqual(
      many.slice(0, nichePerBrand).map((r) => r.id)
    )
    expect(s.signed).toEqual([
      many.slice(0, nichePerBrand).map((r) => r.screenshot_path)
    ])
    expect(items[0]?.screenshot).toEqual({
      url: 'https://signed.example/shots/s0.png',
      width: 600,
      height: 900
    })
  })

  it('reads nothing without brands, and fails when a read or the recheck fails', async () => {
    const none = service([])
    expect(await nicheEmails(none.db, [])).toEqual([])
    expect(none.from).not.toHaveBeenCalled()
    await expect(
      nicheEmails(service([], { error: { message: 'down' } }).db, brands)
    ).rejects.toMatchObject({ message: 'down' })
    observer.allowed.mockRejectedValueOnce(new Error('sheet down'))
    await expect(
      nicheEmails(service([row('s1', 'sample', true)]).db, brands)
    ).rejects.toThrow('sheet down')
  })
})
