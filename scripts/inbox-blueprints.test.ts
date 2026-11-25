// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { pictureOrigins, run } from './inbox-blueprints.mjs'
import { blueprint } from '@/features/design-engine/fixtures'
import { forStorage } from '@/features/design-engine/stored'
import { findFile } from './ts-hooks.mjs'

const job = (n: number) => ({
  job: `j${n}`,
  lease: `l${n}`,
  html: `https://db.test/sign/inbox-raw/${n}.marked.html?token=t`,
  images: [
    {
      ref: 'https://cdn.shop.test/a.png',
      url: 'https://db.test/sign/a?token=1'
    },
    { ref: 'cid:x', url: 'http://evil.test/b.png' }
  ]
})

afterEach(() => vi.unstubAllGlobals())

describe('the blueprint browser', () => {
  it('lets pictures load only from the job’s own https links', () => {
    expect(pictureOrigins(job(1))).toEqual(['https://db.test'])
  })

  it('measures each email and reports a bare blueprint, a final failure or a retry, printing counts only', async () => {
    const queue = [[job(1)], [job(2)], [job(3)], [job(4)], []]
    const posts: unknown[] = []
    const claims: string[] = []
    const htmls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('https://app.test/')) {
          expect(init?.redirect).toBe('error')
          if (init?.method !== 'POST') claims.push(url)
          if (init?.method === 'POST') {
            posts.push(JSON.parse(String(init.body)))
            return new Response('{"ok":true}')
          }
          return new Response(JSON.stringify({ jobs: queue.shift() ?? [] }))
        }
        if (url.includes('/4.marked'))
          return new Response('gone', { status: 404 })
        return new Response(
          '<table data-gr-section="1"><tr><td><img src="https://cdn.shop.test/a.png"></td></tr></table>'
        )
      })
    )
    const lines: string[] = []
    const bare = forStorage(blueprint())
    const answers = [
      { ok: true as const, blueprint: bare },
      {
        ok: false as const,
        failure: 'too_tall' as const,
        retry: false as const
      },
      { ok: false as const, failure: 'timeout' as const, retry: true as const }
    ]
    const counts = await run({
      base: 'https://app.test',
      secret: 'x'.repeat(40),
      browser: {} as Browser,
      log: (l) => lines.push(l),
      engine: 'v-test',
      measure: async (_b, html, origins) => {
        htmls.push(html)
        expect(origins).toEqual(['https://db.test'])
        return answers.shift()!
      }
    })
    expect(counts).toEqual({ measured: 1, failed: 1, retry: 2, skew: false })
    expect(claims.every((u) => u.endsWith('?engine=v-test'))).toBe(true)
    expect(htmls[0]).toContain('https://db.test/sign/a?token=1')
    expect(posts).toEqual([
      { job: 'j1', lease: 'l1', engine: 'v-test', blueprint: bare },
      { job: 'j2', lease: 'l2', engine: 'v-test', failure: 'too_tall' },
      { job: 'j3', lease: 'l3', retry: 'timeout' },
      { job: 'j4', lease: 'l4', retry: 'html_unreadable' }
    ])
    expect(lines).toEqual([
      'Blueprints measured: 1. Cannot be measured: 1. To try again: 2.'
    ])
    expect(lines.join(' ')).not.toMatch(/token|db\.test|x{40}/)
  })

  it('finds the engine’s TypeScript the way the app does', () => {
    expect(findFile(`${process.cwd()}/features/design-engine/stored`)).toMatch(
      /stored\.ts$/
    )
    expect(findFile(`${process.cwd()}/features/design-engine/nothing`)).toBe(
      null
    )
  })

  it('measures nothing when the app runs another engine version, and says so', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ jobs: [], skew: true })))
    )
    const lines: string[] = []
    const measure = vi.fn()
    const counts = await run({
      base: 'https://app.test',
      secret: 'x'.repeat(40),
      browser: {} as Browser,
      log: (l) => lines.push(l),
      engine: 'v-old',
      measure
    })
    expect(counts).toEqual({ measured: 0, failed: 0, retry: 0, skew: true })
    expect(measure).not.toHaveBeenCalled()
    expect(lines[0]).toContain('another engine version')
  })
})
