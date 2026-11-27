// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { run } from './design-blocks.mjs'
import { blueprint } from '@/features/design-engine/fixtures'

afterEach(() => vi.unstubAllGlobals())

describe('the block library browser (DES-ENGINE-004)', () => {
  it('draws each handed-out section and reports verdicts only, printing counts only', async () => {
    const queue = [
      {
        jobs: [
          {
            job: 'j1',
            lease: 'l1',
            checks: [
              { ordinal: 1, blueprint: blueprint() },
              { ordinal: 3, blueprint: blueprint() }
            ]
          }
        ]
      },
      { jobs: [] }
    ]
    const posts: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(init?.redirect).toBe('error')
        expect(url).toContain('/api/internal/design/blocks')
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)))
          return new Response('{"ok":true}')
        }
        if (url.includes('peek=1')) return new Response('{"waiting":0}')
        return new Response(JSON.stringify(queue.shift() ?? { jobs: [] }))
      })
    )
    const lines: string[] = []
    const answers = [
      { pass: true as const },
      { pass: false as const, failure: 'not_alike' as const, problems: ['x'] }
    ]
    const counts = await run({
      base: 'https://app.test',
      secret: 's'.repeat(40),
      browser: {} as Browser,
      engine: 'v1',
      log: (l) => lines.push(l),
      check: async () => answers.shift()!
    })
    expect(counts).toMatchObject({ sources: 1, passed: 1, failed: 1, retry: 0 })
    expect(posts).toEqual([
      {
        job: 'j1',
        lease: 'l1',
        engine: 'v1',
        checks: [
          { ordinal: 1, pass: true },
          { ordinal: 3, pass: false, failure: 'not_alike' }
        ]
      }
    ])
    expect(lines.join('\n')).not.toMatch(/Xxxx|https?:/)
  })

  it('hands a job back to try again when the browser breaks, and stops on another engine version', async () => {
    const posts: Record<string, unknown>[] = []
    const queue = [
      {
        jobs: [
          {
            job: 'j1',
            lease: 'l1',
            checks: [{ ordinal: 1, blueprint: blueprint() }]
          }
        ]
      },
      { jobs: [], skew: true }
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(String(init.body)))
          return new Response('{"ok":true}')
        }
        return new Response(JSON.stringify(queue.shift() ?? { jobs: [] }))
      })
    )
    const counts = await run({
      base: 'https://app.test',
      secret: 's'.repeat(40),
      browser: {} as Browser,
      engine: 'v1',
      log: () => {},
      check: async () => {
        throw new Error('crashed')
      }
    })
    expect(counts).toMatchObject({ retry: 1, skew: true })
    expect(posts).toEqual([{ job: 'j1', lease: 'l1', retry: 'engine_error' }])
  })

  const longEmail = () => [
    {
      jobs: [
        {
          job: 'j1',
          lease: 'l1',
          checks: [1, 2, 3].map((ordinal) => ({
            ordinal,
            blueprint: blueprint()
          }))
        }
      ]
    },
    { jobs: [] }
  ]
  const longRun = async (step: number, refuse: boolean) => {
    const posts: Record<string, unknown>[] = []
    let clock = 0
    const queue = longEmail()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          const body = JSON.parse(String(init.body))
          posts.push(body)
          if (body.renew && refuse) return new Response('{}', { status: 409 })
          return new Response('{"ok":true}')
        }
        if (url.includes('peek=1')) return new Response('{"waiting":0}')
        return new Response(JSON.stringify(queue.shift() ?? { jobs: [] }))
      })
    )
    const counts = await run({
      base: 'https://app.test',
      secret: 's'.repeat(40),
      browser: {} as Browser,
      engine: 'v1',
      log: () => {},
      now: () => clock,
      check: async () => {
        clock += step
        return { pass: true as const }
      }
    })
    return { posts, counts }
  }

  it('renews the lease while it draws a long email, and hands the email back when the run’s time is spent', async () => {
    const { posts, counts } = await longRun(2.5 * 60_000, false)
    // Renewed before the second section; the run's 4 minutes are spent
    // before the third: handed back (its try given back), nothing recorded.
    expect(posts).toEqual([
      { job: 'j1', lease: 'l1', renew: true },
      { job: 'j1', lease: 'l1', release: 'run_budget' }
    ])
    expect(counts).toMatchObject({ sources: 0, retry: 1 })
  })

  it('stops the email, nothing recorded, when the renewal is refused', async () => {
    const { posts, counts } = await longRun(2.1 * 60_000, true)
    expect(posts).toEqual([{ job: 'j1', lease: 'l1', renew: true }])
    expect(counts).toMatchObject({ sources: 0, retry: 1 })
  })
})
