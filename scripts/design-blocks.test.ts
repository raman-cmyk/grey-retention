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
})
