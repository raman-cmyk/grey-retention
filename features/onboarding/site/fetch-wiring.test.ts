// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const made = vi.hoisted(() => [] as unknown[])
vi.mock('@/features/inbox/image-fetch', () => ({
  createImageFetcher: (options: unknown) => (
    made.push(options),
    { fetch: vi.fn() }
  )
}))
import {
  liveSiteFetcher,
  logoFetchOptions,
  sheetFetchOptions,
  siteFetchOptions
} from './fetch'

describe('the live reader’s own fetchers (ONB-060b)', () => {
  it('reads pages with the brand-host guards, logo pictures with the logo guards and stylesheets with theirs', () => {
    liveSiteFetcher('shop.com')
    expect(made).toHaveLength(4)
    expect(JSON.stringify(made[0])).toBe(
      JSON.stringify(siteFetchOptions('shop.com'))
    )
    expect(made[1]).toBe(logoFetchOptions)
    // FONT-b: the brand's and the font services' CSS, and Google's as a browser.
    const [own, google] = made.slice(2) as ReturnType<
      typeof sheetFetchOptions
    >[]
    expect(JSON.stringify(own)).toBe(
      JSON.stringify(sheetFetchOptions('shop.com'))
    )
    expect(google!.userAgent).toBe(
      sheetFetchOptions('shop.com', true).userAgent
    )
    expect([own!.allowHost('shop.com'), google!.allowHost('shop.com')]).toEqual(
      [true, false]
    )
  })
})
