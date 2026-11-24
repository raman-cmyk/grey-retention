import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'

/**
 * Runs the signed-in workspace's queued sample jobs now (a followed brand's
 * sample capture, a draft's copy), as the scheduled worker does in the app.
 * UI-OLDc retired the old pages' "Run … fixture jobs" buttons; this calls
 * the local fixture dispatch with the local cron secret instead, for this
 * workspace only, until a pass finds nothing left to do.
 */
export async function runWorkspaceJobs(page: Page, passes = 6) {
  const me = await page.request.get('/api/v1/me')
  expect(me.status()).toBe(200)
  const tenantId = (await me.json()).data.tenantId as string
  const secret = readFileSync('.audit/local-cron-secret.txt', 'utf8')
  for (let pass = 0; pass < passes; pass += 1) {
    const ran = await page.request.post('/api/internal/jobs', {
      headers: { authorization: `Bearer ${secret}` },
      data: { tenantId, limit: 4 }
    })
    expect(ran.status()).toBe(200)
    if ((await ran.json()).processed === 0) return
  }
}
