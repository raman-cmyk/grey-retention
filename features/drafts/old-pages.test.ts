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
  '/optimizer': '/settings'
}

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return pages(path)
    return name === 'page.tsx' ? [path] : []
  })
}

describe('retired old client pages', () => {
  it('redirect for good to the GROS screen doing their job', async () => {
    const redirects = await nextConfig.redirects!()
    for (const [source, destination] of Object.entries(expected))
      expect(redirects).toContainEqual({ source, destination, permanent: true })
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
})
