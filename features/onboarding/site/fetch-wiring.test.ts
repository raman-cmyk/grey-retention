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
import { liveSiteFetcher, logoFetchOptions, siteFetchOptions } from './fetch'

describe('the live reader’s own fetchers (ONB-060b)', () => {
  it('reads pages with the brand-host guards and logo pictures with the logo guards', () => {
    liveSiteFetcher('shop.com')
    expect(made).toHaveLength(2)
    expect(JSON.stringify(made[0])).toBe(
      JSON.stringify(siteFetchOptions('shop.com'))
    )
    expect(made[1]).toBe(logoFetchOptions)
  })
})
