// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const live = vi.hoisted(() => ({ inboxTagging: vi.fn() }))
vi.mock('@/features/intelligence/live', () => live)
import { sampleAsk } from '@/features/intelligence/passes'
import { fakeInboundTransport } from './fake-transport'
import { runInboxStep } from './step'
import type { pollInbox } from './worker'

type Db = Parameters<typeof runInboxStep>[0]
const db = {
  rpc: async () => ({ data: 0, error: null })
} as unknown as Db
const ready = { ready: true as const, transport: fakeInboundTransport() }
const none = { emails: 0, stored: 0, failed: 0, retried: 0 }
const assets = vi.fn(async () => none)
const nothingLabelled = {
  emails: 0,
  sections: 0,
  untagged: 0,
  retried: 0,
  deferred: 0
}
const label = vi.fn(async () => nothingLabelled)
const nothingPlaced = {
  emails: 0,
  made: 0,
  matched: 0,
  dropped: 0,
  retried: 0,
  deferred: 0
}
const variants = vi.fn(async () => nothingPlaced)
const nothingConfirmed = { clicked: 0, refused: 0, failed: 0 }
const confirm = vi.fn(async () => nothingConfirmed)

describe('runInboxStep', () => {
  // The sample rules, unless a test sets up a live model.
  beforeEach(() =>
    live.inboxTagging.mockReturnValue({
      ask: sampleAsk,
      pictures: false,
      batchMs: 0
    })
  )
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
    expect(
      await runInboxStep(db, ready, { poll, assets, label, variants, confirm })
    ).toEqual({
      transport: 'fake',
      ready: true,
      synthetic: true,
      run: { state: 'busy' },
      assets: none,
      labels: nothingLabelled,
      variants: nothingPlaced,
      confirms: nothingConfirmed
    })
  })

  it('never throws: a poll that cannot start becomes a failed run with its code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const poll = vi.fn(async () => {
      throw Object.assign(new Error('secret detail'), { code: 'PGRST301' })
    }) as unknown as typeof pollInbox
    const step = await runInboxStep(db, ready, {
      poll,
      assets,
      label,
      variants,
      confirm
    })
    expect(step).toMatchObject({ run: { state: 'failed', code: 'PGRST301' } })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret detail')
  })

  it('stops waiting for a slow inbox so the workspace jobs keep their time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const poll = vi.fn(
      () => new Promise<never>(() => {})
    ) as unknown as typeof pollInbox
    const step = await runInboxStep(db, ready, {
      poll,
      assets,
      label,
      variants,
      timeoutMs: 20
    })
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
      label,
      variants,
      confirm,
      assetsUntilMs: 1_000
    })
    expect(step).toMatchObject({ assets: { emails: 2, stored: 5 } })
    const deadline = (keep.mock.calls[0] as unknown as [unknown, number])[1]
    expect(deadline - before).toBeGreaterThanOrEqual(1_000)
    expect(deadline - before).toBeLessThan(1_500)
  })

  it('tags first, then places the tagged sections in the library, by the same deadline', async () => {
    const poll = vi.fn(async () => ({ state: 'busy' as const }))
    const order: string[] = []
    const place = vi.fn(async () => {
      order.push('variants')
      return nothingPlaced
    })
    const tag = vi.fn(async () => {
      order.push('labels')
      return nothingLabelled
    })
    await runInboxStep(db, ready, {
      poll,
      assets,
      label: tag,
      variants: place,
      confirm,
      assetsUntilMs: 10_000
    })
    expect(order).toEqual(['labels', 'variants'])
    const placeBy = (place.mock.calls[0] as unknown as [unknown, number])[1]
    const tagBy = (tag.mock.calls[0] as unknown as [unknown, number])[1]
    expect(placeBy).toBe(tagBy)
  })

  it('places sections itself with the sample rules', async () => {
    const poll = vi.fn(async () => ({ state: 'busy' as const }))
    const step = await runInboxStep(db, ready, {
      poll,
      assets,
      label,
      confirm
    })
    expect(step).toMatchObject({ variants: nothingPlaced })
  })

  it('leaves the library to the tagging run when a live model is set up', async () => {
    live.inboxTagging.mockReturnValue({
      ask: vi.fn(),
      pictures: true,
      batchMs: 8_000
    })
    const poll = vi.fn(async () => ({ state: 'busy' as const }))
    const step = await runInboxStep(db, ready, {
      poll,
      assets,
      label,
      confirm
    })
    expect(step).toMatchObject({ variants: null, labels: nothingLabelled })
  })

  it('reports a library step that fails and still tags', async () => {
    const poll = vi.fn(async () => ({ state: 'busy' as const }))
    const broken = vi.fn(async () => {
      throw Object.assign(new Error('x'), { code: 'PGRST000' })
    })
    const tag = vi.fn(async () => nothingLabelled)
    expect(
      await runInboxStep(db, ready, {
        poll,
        assets,
        label: tag,
        variants: broken,
        confirm
      })
    ).toMatchObject({
      variants: { state: 'failed', code: 'PGRST000' },
      labels: nothingLabelled
    })
    expect(tag).toHaveBeenCalledOnce()
  })

  it('reports an image step that fails without hiding the poll', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const poll = vi.fn(async () => ({ state: 'busy' as const }))
    const keep = vi.fn(async () => {
      throw Object.assign(new Error('x'), { code: 'PGRST000' })
    })
    expect(
      await runInboxStep(db, ready, {
        poll,
        assets: keep,
        label,
        variants,
        confirm
      })
    ).toMatchObject({
      run: { state: 'busy' },
      assets: { state: 'failed', code: 'PGRST000' }
    })
  })
})
