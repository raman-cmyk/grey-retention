import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => null }))

const { sessionEmail, shellIdentity } = await import('./shell-identity')

const client = (result: unknown) => ({
  auth: { getClaims: vi.fn(async () => result as never) }
})

describe('sessionEmail', () => {
  it('returns the email of the signed-in user', async () => {
    const db = client({
      data: { claims: { sub: 'u1', email: ' rae@northwind.example ' } },
      error: null
    })
    expect(await sessionEmail(db, 'u1')).toBe('rae@northwind.example')
  })

  it('shows nothing for another user, a missing or odd email, or an error', async () => {
    expect(
      await sessionEmail(
        client({
          data: { claims: { sub: 'u2', email: 'x@y.example' } },
          error: null
        }),
        'u1'
      )
    ).toBeNull()
    expect(
      await sessionEmail(
        client({ data: { claims: { sub: 'u1', email: 42 } }, error: null }),
        'u1'
      )
    ).toBeNull()
    expect(
      await sessionEmail(
        client({ data: { claims: { sub: 'u1', email: '  ' } }, error: null }),
        'u1'
      )
    ).toBeNull()
    expect(
      await sessionEmail(
        client({ data: null, error: new Error('expired') }),
        'u1'
      )
    ).toBeNull()
    const throwing = {
      auth: { getClaims: async () => Promise.reject(new Error('net')) }
    }
    expect(await sessionEmail(throwing as never, 'u1')).toBeNull()
  })
})

describe('shellIdentity without a database session', () => {
  it('falls back to "Your account" with no email', async () => {
    const identity = await shellIdentity({
      kind: 'designer',
      userId: 'u1',
      designerId: 'd1'
    } as never)
    expect(identity).toEqual({
      name: 'Your account',
      initials: 'YA',
      email: null,
      role: 'Designer'
    })
  })
})
