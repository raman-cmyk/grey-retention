// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { fakeInboundTransport } from './fake-transport'
import { runInboxStep } from './step'
import type { pollInbox } from './worker'

type Db = Parameters<typeof runInboxStep>[0]
const db = {} as Db
const ready = { ready: true as const, transport: fakeInboundTransport() }
const none = { emails: 0, stored: 0, failed: 0, retried: 0 }
const assets = vi.fn(async () => none)

describe('runInboxStep', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reports an inbox that is not set up, in words, without polling', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const poll = vi.fn()
    expect(
      await runInboxStep(
        db,
        { ready: false, kind: 'gmail_imap', reason: 'Set INBOX_IMAP_USER.' },
        { poll }
      )
    ).toEqual({
      transport: 'gmail_imap',
      ready: false,
      reason: 'Set INBOX_IMAP_USER.'
    })
    expect(poll).not.toHaveBeenCalled()
  })

  it('returns the poll and says whether the mail is sample mail', async () => {
    const poll = vi.fn(async () => ({ state: 'busy' as const }))
    expect(await runInboxStep(db, ready, { poll, assets })).toEqual({
      transport: 'fake',
      ready: true,
      synthetic: true,
      run: { state: 'busy' },
      assets: none
    })
  })

  it('never throws: a poll that cannot start becomes a failed run with its code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const poll = vi.fn(async () => {
      throw Object.assign(new Error('secret detail'), { code: 'PGRST301' })
    }) as unknown as typeof pollInbox
    const step = await runInboxStep(db, ready, { poll, assets })
    expect(step).toMatchObject({ run: { state: 'failed', code: 'PGRST301' } })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret detail')
  })

  it('stops waiting for a slow inbox so the workspace jobs keep their time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const poll = vi.fn(
      () => new Promise<never>(() => {})
    ) as unknown as typeof pollInbox
    const step = await runInboxStep(db, ready, { poll, assets, timeoutMs: 20 })
    expect(step).toMatchObject({
      run: { state: 'failed', code: 'inbox_step_timeout' }
    })
  })

  it('keeps the images after the poll, until its own deadline, even when the poll failed', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const poll = vi.fn(async () => ({
      state: 'failed' as const,
      code: 'imap_timeout'
    }))
    const keep = vi.fn(async () => ({ ...none, emails: 2, stored: 5 }))
    const before = Date.now()
    const step = await runInboxStep(db, ready, {
      poll,
      assets: keep,
      assetsUntilMs: 1_000
    })
    expect(step).toMatchObject({ assets: { emails: 2, stored: 5 } })
    const deadline = (keep.mock.calls[0] as unknown as [unknown, number])[1]
    expect(deadline - before).toBeGreaterThanOrEqual(1_000)
    expect(deadline - before).toBeLessThan(1_500)
  })

  it('reports an image step that fails without hiding the poll', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const poll = vi.fn(async () => ({ state: 'busy' as const }))
    const keep = vi.fn(async () => {
      throw Object.assign(new Error('x'), { code: 'PGRST000' })
    })
    expect(await runInboxStep(db, ready, { poll, assets: keep })).toMatchObject(
      {
        run: { state: 'busy' },
        assets: { state: 'failed', code: 'PGRST000' }
      }
    )
  })
})
