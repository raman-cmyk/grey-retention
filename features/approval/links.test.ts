// @vitest-environment node
import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  linkLifetimeDays,
  redeemApprovalLink,
  refusalWords,
  signApprovalLink,
  verifyApprovalLink,
  type ApprovalLinkStore,
  type LinkClaims
} from './links'

const secret = 'test-secret-that-is-at-least-32-characters-long'
const older = 'older-secret-that-is-at-least-32-characters-x'
const now = new Date('2026-11-08T09:00:00Z')
const link = {
  tenantId: 'tenant-a',
  recipientId: 'owner-1',
  batchId: '2026-W46',
  action: 'approve_all' as const,
  items: [
    { campaignId: 'tue', revision: 1 },
    { campaignId: 'thu', revision: 3 }
  ]
}
const memoryStore = (answer?: 'not_owner' | 'changed') => {
  const used = new Set<string>()
  const store: ApprovalLinkStore & { used: Set<string> } = {
    used,
    async redeem(claims) {
      if (answer) return answer
      if (used.has(claims.jti)) return 'used'
      used.add(claims.jti)
      return 'ok'
    }
  }
  return store
}
const payloadOf = (token: string) =>
  JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())

describe('signed approval links', () => {
  it('carry only ids: workspace, recipient, batch and the emails shown', () => {
    const { token, expiresAt } = signApprovalLink(
      secret,
      {
        ...link,
        subject: 'Secret launch',
        email: 'owner@example.com'
      } as never,
      now
    )
    expect(expiresAt).toBe('2026-11-15T09:00:00.000Z')
    expect(linkLifetimeDays).toBe(7)
    const payload = payloadOf(token)
    expect(Object.keys(payload).sort()).toEqual(
      ['act', 'batch', 'exp', 'items', 'jti', 'sub', 'tenant', 'v'].sort()
    )
    expect(payload.items).toEqual([
      ['tue', 1],
      ['thu', 3]
    ])
    expect(token).not.toMatch(/Secret|owner@/)
  })

  it('work for exactly 7 days', () => {
    const { token } = signApprovalLink(secret, link, now)
    expect(
      verifyApprovalLink(secret, token, new Date('2026-11-15T08:59:59Z'))
    ).toMatchObject({
      ok: true,
      claims: { act: 'approve_all', batch: '2026-W46', sub: 'owner-1' }
    })
    expect(
      verifyApprovalLink(secret, token, new Date('2026-11-15T09:00:00Z'))
    ).toEqual({ ok: false, reason: 'expired' })
  })

  it('refuse a changed, forged, re-spelled or broken link', () => {
    const { token } = signApprovalLink(secret, link, now)
    const [payload, signature] = token.split('.')
    const tampered: LinkClaims = { ...payloadOf(token), tenant: 'tenant-b' }
    const forged = `${Buffer.from(JSON.stringify(tampered)).toString('base64url')}.${signature}`
    expect(verifyApprovalLink(secret, forged, now)).toEqual({
      ok: false,
      reason: 'bad_signature'
    })
    expect(
      verifyApprovalLink('another-secret-that-is-32-characters-x', token, now)
    ).toEqual({ ok: false, reason: 'bad_signature' })
    for (const respelled of [`${token}=`, `${token}!!`])
      expect(verifyApprovalLink(secret, respelled, now).ok).toBe(false)
    for (const bad of [
      '',
      'abc',
      'a.b.c',
      `${payload}.`,
      `.${signature}`,
      `${'x'.repeat(1000)}.${'y'.repeat(1001)}`
    ])
      expect(verifyApprovalLink(secret, bad, now), bad.slice(0, 10)).toEqual({
        ok: false,
        reason: expect.stringMatching(/malformed|bad_signature/)
      })
  })

  it('refuse a well-signed payload of the wrong shape', () => {
    const signWith = (claims: object) => {
      const p = Buffer.from(JSON.stringify(claims)).toString('base64url')
      return `${p}.${createHmac('sha256', secret).update(p).digest('base64url')}`
    }
    const good = payloadOf(signApprovalLink(secret, link, now).token)
    for (const claims of [
      { ...good, act: 'change' }, // a Change link covers exactly one email
      { ...good, extra: 'x' },
      { ...good, v: 2 },
      { ...good, items: [] },
      { ...good, sub: '' },
      { ...good, __proto__: { admin: true }, tenant: 'a b' }
    ])
      expect(verifyApprovalLink(secret, signWith(claims), now)).toEqual({
        ok: false,
        reason: 'malformed'
      })
  })

  it('keep working while the secret is rotated', () => {
    const { token } = signApprovalLink(older, link, now)
    expect(verifyApprovalLink([secret, older], token, now).ok).toBe(true)
    expect(verifyApprovalLink(secret, token, now).ok).toBe(false)
  })

  it('need a long secret, real ids and one email for a Change link', () => {
    expect(() => signApprovalLink('short', link, now)).toThrow(/32 characters/)
    expect(() => signApprovalLink([], link, now)).toThrow(/32 characters/)
    expect(() =>
      signApprovalLink(secret, { ...link, action: 'change' }, now)
    ).toThrow(/exactly one email/)
    expect(() =>
      signApprovalLink(secret, { ...link, recipientId: '' }, now)
    ).toThrow(/invalid ids/)
    expect(() => signApprovalLink(secret, { ...link, items: [] }, now)).toThrow(
      /invalid ids/
    )
    const change = signApprovalLink(
      secret,
      { ...link, action: 'change', items: [{ campaignId: 'c1', revision: 2 }] },
      now
    )
    expect(verifyApprovalLink(secret, change.token, now)).toMatchObject({
      ok: true,
      claims: { act: 'change', items: [['c1', 2]] }
    })
  })
})

describe('using a link (the confirmation button)', () => {
  it('works once: a second press is refused', async () => {
    const store = memoryStore()
    const { token, jti } = signApprovalLink(secret, link, now)
    expect(
      await redeemApprovalLink(secret, token, now, store, null)
    ).toMatchObject({ ok: true })
    expect(store.used.has(jti)).toBe(true)
    expect(await redeemApprovalLink(secret, token, now, store, null)).toEqual({
      ok: false,
      reason: 'used'
    })
  })

  it('is never used up just by opening it', () => {
    const store = memoryStore()
    const { token } = signApprovalLink(secret, link, now)
    verifyApprovalLink(secret, token, now)
    verifyApprovalLink(secret, token, now)
    expect(store.used.size).toBe(0)
  })

  it('is refused for another signed-in person, before the store is asked', async () => {
    const store = memoryStore()
    const redeem = vi.spyOn(store, 'redeem')
    const { token } = signApprovalLink(secret, link, now)
    expect(
      await redeemApprovalLink(secret, token, now, store, 'someone-else')
    ).toEqual({ ok: false, reason: 'other_user' })
    expect(redeem).not.toHaveBeenCalled()
    expect(
      await redeemApprovalLink(secret, token, now, store, 'owner-1')
    ).toMatchObject({ ok: true })
  })

  it('passes on the store’s refusals: no longer the owner, or the week changed', async () => {
    const { token } = signApprovalLink(secret, link, now)
    for (const answer of ['not_owner', 'changed'] as const)
      expect(
        await redeemApprovalLink(secret, token, now, memoryStore(answer), null)
      ).toEqual({ ok: false, reason: answer })
  })

  it('does not use up a link that fails its checks', async () => {
    const store = memoryStore()
    const { token } = signApprovalLink(secret, link, now)
    await redeemApprovalLink(
      secret,
      token,
      new Date('2026-12-01T00:00:00Z'),
      store,
      null
    )
    expect(store.used.size).toBe(0)
  })

  it('explains every refusal in plain words', () => {
    expect(refusalWords.expired).toMatch(/7 days/)
    expect(refusalWords.used).toMatch(/already used/)
    for (const words of Object.values(refusalWords))
      expect(words).toMatch(/Open the app|Sign in/)
  })
})
