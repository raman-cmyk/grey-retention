// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireRequestContext, from } = vi.hoisted(() => ({
  requireRequestContext: vi.fn(),
  from: vi.fn()
}))
vi.mock('server-only', () => ({}))
vi.mock('@/features/auth/application/request-context', () => ({
  requireRequestContext
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ from })
}))
const { blockGallery } = await import('./gallery-data')

function rows(kit: unknown, tenant: unknown = { name: 'Northwind' }) {
  from.mockImplementation((table: string) => ({
    select: () => ({
      eq: (_column: string, value: string) => ({
        maybeSingle: async () => {
          expect(value).toBe('tenant-a')
          return table === 'brand_kits'
            ? { data: kit, error: null }
            : { data: tenant, error: null }
        }
      })
    })
  }))
}

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('AUTH_MODE', 'supabase')
  requireRequestContext.mockResolvedValue({ tenantId: 'tenant-a' })
  from.mockReset()
})

describe('blockGallery', () => {
  it('draws the 20 blocks in the workspace brand kit', async () => {
    rows({ colors: ['#123456', '#abcdef', '#fafafa'], fonts: ['Inter'] })
    const gallery = await blockGallery()
    expect(requireRequestContext).toHaveBeenCalledWith('client')
    expect(gallery.items).toHaveLength(20)
    expect(gallery).toMatchObject({
      brandName: 'Northwind',
      usesOwnBrand: true
    })
    expect(gallery.items[1].html).toContain('#123456')
    expect(gallery.items[1].html).toContain("'Inter'")
  })

  it('falls back to a labelled sample brand without kit colours', async () => {
    rows({ colors: [], fonts: [] })
    const gallery = await blockGallery()
    expect(gallery).toMatchObject({
      brandName: 'Cedar Lane',
      usesOwnBrand: false
    })
    expect(gallery.brandNote).toMatch(/sample brand/)
  })

  it('sends sanitized previews: no links, scripts or outside loads', async () => {
    rows(null)
    const gallery = await blockGallery()
    for (const item of gallery.items) {
      expect(item.html).not.toMatch(/<script|<a\s[^>]*href=/i)
      expect(item.html).toContain('Content-Security-Policy')
    }
  })
})
