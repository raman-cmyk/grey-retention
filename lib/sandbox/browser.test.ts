// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { BrowserType } from '@playwright/test'
import { launch, loadableOrigins, makeInert } from './browser.mjs'

describe('the locked browser’s shared rules', () => {
  it('allows https origins and loopback http only', () => {
    expect([
      ...loadableOrigins([
        'https://cdn.example.com',
        'http://127.0.0.1:5000',
        'http://localhost',
        'http://example.com',
        'null',
        'https://cdn.example.com/path'
      ])
    ]).toEqual([
      'https://cdn.example.com',
      'http://127.0.0.1:5000',
      'http://localhost'
    ])
  })

  it('makes inert every tag that reaches out on its own', () => {
    expect(
      makeInert(
        '<META http-equiv="refresh" content="0;url=https://x"><link rel=prefetch href=x><base href=x><iframe src=x></iframe><p>ok</p>'
      )
    ).toBe(
      '<wbr hidden data-gr-meta http-equiv="refresh" content="0;url=https://x"><wbr hidden data-gr-link rel=prefetch href=x><wbr hidden data-gr-base href=x><wbr hidden data-gr-iframe src=x></iframe><p>ok</p>'
    )
  })

  it('launches Chromium with its OS sandbox first, with no secret in its environment', async () => {
    const calls: unknown[] = []
    const chromium = {
      launch: vi.fn(async (options: unknown) => {
        calls.push(options)
        if (calls.length === 1) throw new Error('no sandbox here')
        return 'browser'
      })
    } as unknown as BrowserType
    expect(await launch(chromium)).toBe('browser')
    expect(calls[0]).toMatchObject({ chromiumSandbox: true })
    for (const c of calls)
      expect(Object.keys((c as { env: object }).env).sort()).toEqual([
        'HOME',
        'PATH'
      ])
  })
})
