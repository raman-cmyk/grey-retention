import { readFileSync } from 'node:fs'
import { expect, type APIRequestContext } from '@playwright/test'

/**
 * Runs the onboarding readers once, as their scheduled run does (the local
 * cron secret, as the scheduled sweep journeys use it): the queued reads
 * of the sample sites are read.
 */
export async function runReaders(request: APIRequestContext) {
  const secret = readFileSync('.audit/local-cron-secret.txt', 'utf8')
  const ran = await request.get('/api/internal/onboarding/readers', {
    headers: { authorization: `Bearer ${secret}` }
  })
  expect(ran.status()).toBe(200)
  expect(await ran.json()).toMatchObject({ state: 'done', failed: 0 })
}
