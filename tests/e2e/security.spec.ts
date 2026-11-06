import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { login } from './accounts'
test('UC-14 internal worker requires a secret, validates scope and rejects disabled webhooks', async ({
  page
}, info) => {
  await login(page, info.project.name.startsWith('mobile') ? 'other' : 'owner')
  const me = await page.request.get('/api/v1/me'),
    ctx = (await me.json()).data
  const denied = await page.request.post('/api/internal/jobs', {
    data: { tenantId: ctx.tenantId }
  })
  expect(denied.status()).toBe(401)
  const secret = readFileSync('.audit/local-cron-secret.txt', 'utf8'),
    headers = { authorization: `Bearer ${secret}` }
  const invalid = await page.request.post('/api/internal/jobs', {
    headers,
    data: { tenantId: ctx.tenantId, limit: 500 }
  })
  expect(invalid.status()).toBe(400)
  const oversized = await page.request.post('/api/internal/jobs', {
    headers,
    data: { tenantId: ctx.tenantId, padding: 'x'.repeat(2200) }
  })
  expect(oversized.status()).toBe(413)
  const dispatched = await page.request.post('/api/internal/jobs', {
    headers,
    data: { tenantId: ctx.tenantId, limit: 1 }
  })
  expect(dispatched.status()).toBe(200)
  expect(await dispatched.json()).toMatchObject({
    synthetic: true,
    live: false
  })
  const webhook = await page.request.post('/api/webhooks/klaviyo', {
    data: { originalFixture: true }
  })
  expect(webhook.status()).toBe(503)
  // GET is the scheduled sweep (Vercel cron / GitHub Actions); it needs the secret.
  const method = await page.request.get('/api/internal/jobs')
  expect(method.status()).toBe(401)
  const secure = await page.request.get('/reports')
  expect(secure.headers()['x-content-type-options']).toBe('nosniff')
  expect(secure.headers()['content-security-policy']).toContain(
    "frame-ancestors 'none'"
  )
})
