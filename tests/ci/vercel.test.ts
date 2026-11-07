// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', '..', 'vercel.json'), 'utf8')
) as {
  crons?: { path: string; schedule: string }[]
  git?: { deploymentEnabled?: Record<string, boolean> }
}

describe('vercel.json', () => {
  it('deploys main only: agent branches make no preview deployments', () => {
    // The free plan allows 100 deployments a day; every branch push made one.
    expect(config.git?.deploymentEnabled).toEqual({
      main: true,
      'claude/**': false
    })
  })

  it('keeps the daily job worker cron', () => {
    expect(config.crons).toEqual([
      { path: '/api/internal/jobs', schedule: '7 1 * * *' }
    ])
  })
})
