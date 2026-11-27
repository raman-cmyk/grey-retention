import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import nextConfig from '@/next.config'

/**
 * UI-OLDc: every retired old client page opens its GROS screen (old links,
 * bookmarks and the old shell's menu), and no page is left at the old
 * address to show the old design.
 */
const expected: Record<string, string> = {
  '/first-draft': '/inspiration/use',
  '/campaigns/:campaignId': '/plan/draft/:campaignId',
  '/connections': '/settings',
  '/reports': '/results',
  '/competitor-agent': '/inspiration',
  '/competitor-agent/:subscriptionId': '/inspiration',
  '/email-library': '/inspiration',
  '/email-library/:emailId': '/inspiration/use?reference=:emailId',
  '/campaign-agent': '/plan',
  '/get-started': '/setup',
  '/optimizer': '/settings',
  // UI-BRAND, UI-BRAND-2: Brand is a main page, Brand book and Brand
  // assets under it; their addresses under Settings open them.
  '/brand/voice': '/brand#tone',
  '/store': '/brand',
  '/assets': '/brand/assets',
  '/settings/brand': '/brand',
  '/settings/brand/book': '/brand/book',
  '/settings/assets': '/brand/assets',
  // DES-ENGINE-003b: the old "Add an email you like" pages and their results.
  '/import-reference': '/inspiration/add',
  '/import-reference/files/:fileImportId': '/inspiration/add',
  '/create-email/:importId': '/inspiration/add',
  '/emails/:resultId': '/plan'
}

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return pages(path)
    return name === 'page.tsx' ? [path] : []
  })
}

describe('retired old client pages', () => {
  it('redirect to the GROS screen doing their job', async () => {
    const redirects = await nextConfig.redirects!()
    for (const [source, destination] of Object.entries(expected))
      expect(redirects).toContainEqual({
        source,
        destination,
        permanent: false
      })
  })

  it('leave no page at the old address', () => {
    const app = join(import.meta.dirname, '../../app')
    const addresses = pages(app).map((p) =>
      p
        .slice(app.length)
        .replace(/\/\([^)]+\)/g, '')
        .replace(/\/page\.tsx$/, '')
        .replace(/\[([^\]]+)\]/g, ':$1')
    )
    for (const source of Object.keys(expected))
      expect(addresses).not.toContain(source)
    expect(addresses).not.toContain('/copy-review')
  })

  it('leave no page in the old shell (DES-ENGINE-003b)', () => {
    const app = join(import.meta.dirname, '../../app')
    expect(pages(app).filter((p) => p.includes('/(client)/'))).toEqual([])
  })

  it('serve Brand, the Brand book and Brand assets at their own addresses (UI-BRAND-2)', async () => {
    const app = join(import.meta.dirname, '../../app')
    const addresses = pages(app).map((p) =>
      p
        .slice(app.length)
        .replace(/\/\([^)]+\)/g, '')
        .replace(/\/page\.tsx$/, '')
    )
    for (const page of ['/brand', '/brand/book', '/brand/assets'])
      expect(addresses).toContain(page)
    const redirects = await nextConfig.redirects!()
    expect(redirects.map((r) => r.source)).not.toContain('/brand')
    expect(redirects.map((r) => r.source)).not.toContain('/brand/book')
  })
})
