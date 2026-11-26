// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '@playwright/test'
import { run } from './design-uploads.mjs'
import { blueprint } from '@/features/design-engine/fixtures'

const job = (n: number, design: 'own' | 'other' = 'own') => ({
  job: `j${n}`,
  lease: `l${n}`,
  design,
  pictures: n,
  html: `https://db.test/sign/email-uploads/t/${n}/email.html?token=t`
})

afterEach(() => vi.unstubAllGlobals())

describe('the upload measuring browser (DES-ENGINE-003)', () => {
  it('measures each upload for its kind and reports a blueprint, a final failure or a retry, printing counts only', async () => {
    const queue = [[job(1)], [job(2, 'other')], [job(3)], [job(4)], []]
    const posts: Record<string, unknown>[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.startsWith('https://app.test/')) {
          expect(init?.redirect).toBe('error')
          expect(url).toContain('/api/internal/design/uploads')
          if (init?.method === 'POST') {
            posts.push(JSON.parse(String(init.body)))
            return new Response('{"ok":true}')
          }
          if (url.includes('sweep=1'))
            return new Response('{"removed":2,"leftovers":1}')
          return new Response(JSON.stringify({ jobs: queue.shift() ?? [] }))
        }
        expect(init?.redirect).toBe('error')
        if (url.includes('/4/')) return new Response('gone', { status: 404 })
        return new Response(
          '<table data-gr-section="1"><tr><td>x</td></tr></table>'
        )
      })
    )
    const measured: [string, number][] = []
    const answers = [
      { ok: true as const, blueprint: blueprint() },
      {
        ok: false as const,
        failure: 'too_tall' as const,
        retry: false as const
      },
      { ok: false as const, failure: 'timeout' as const, retry: true as const }
    ]
    const lines: string[] = []
    const counts = await run({
      base: 'https://app.test',
      secret: 's'.repeat(40),
      browser: {} as Browser,
      engine: 'v1',
      log: (l) => lines.push(l),
      measure: async (_b, _html, design, pictures) => {
        measured.push([design, pictures])
        return answers.shift()!
      }
    })
    expect(measured).toEqual([
      ['own', 1],
      ['other', 2],
      ['own', 3]
    ])
    expect(posts).toEqual([
      { job: 'j1', lease: 'l1', engine: 'v1', blueprint: blueprint() },
      { job: 'j2', lease: 'l2', engine: 'v1', failure: 'too_tall' },
      { job: 'j3', lease: 'l3', retry: 'timeout' },
      { job: 'j4', lease: 'l4', retry: 'html_unreadable' }
    ])
    expect(counts).toEqual({
      measured: 1,
      failed: 1,
      retry: 2,
      skew: false,
      cleaned: 3
    })
    expect(lines).toEqual([
      'Uploads measured: 1. Cannot be measured: 1. To try again: 2. Cleaned: 3.'
    ])
    expect(lines.join(' ')).not.toMatch(/https?:|s{40}/)
  })

  it('stops at once when the app runs another engine version or hands out nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ jobs: [], skew: true })))
    )
    const counts = await run({
      base: 'https://app.test',
      secret: 's'.repeat(40),
      browser: {} as Browser,
      engine: 'v1',
      log: () => {},
      measure: async () => {
        throw new Error('never')
      }
    })
    expect(counts.skew).toBe(true)
    // One claim, then the sweep.
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
