import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
const auth = vi.hoisted(() => ({ requireRequestContext: vi.fn() }))
const supabase = vi.hoisted(() => ({ createClient: vi.fn() }))
const env = vi.hoisted(() => ({ values: { AUTH_MODE: 'supabase' } }))
vi.mock('@/features/auth/application/request-context', () => auth)
vi.mock('@/lib/supabase/server', () => supabase)
vi.mock('@/lib/env/server', () => ({ getServerEnvironment: () => env.values }))

import {
  cancelInvite,
  changeMember,
  inviteTeammate,
  resendInvite
} from './actions'

const tenant = '00000000-0000-4000-8000-000000000101'
const member = '00000000-0000-4000-8000-000000000777'
const invite = '00000000-0000-4000-8000-000000000888'
function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [k, v] of Object.entries(values)) data.set(k, v)
  return data
}
const change = {
  id: member,
  updatedAt: '2026-11-06T12:00:00.123456+00:00',
  name: 'Ana Lee',
  change: 'role',
  role: 'admin',
  status: 'active'
}

let rpc: ReturnType<typeof vi.fn>
const signedInAs = (tenantRole: string) =>
  auth.requireRequestContext.mockResolvedValue({ tenantId: tenant, tenantRole })
beforeEach(() => {
  env.values = { AUTH_MODE: 'supabase' }
  signedInAs('owner')
  rpc = vi.fn(async () => ({ data: null, error: null }))
  supabase.createClient.mockResolvedValue({ rpc })
})
afterEach(() => vi.clearAllMocks())

describe('inviteTeammate', () => {
  it('saves an invite and says no email was sent', async () => {
    const result = await inviteTeammate(
      {},
      form({ email: ' Ana@Example.com ', role: 'admin' })
    )
    expect(result.message).toBe(
      'Invite saved for ana@example.com as Manager. Email sending is not switched on yet, so no email was sent.'
    )
    expect(rpc).toHaveBeenCalledWith('invite_team', {
      t: tenant,
      email: 'ana@example.com',
      role: 'admin'
    })
  })

  it('lets a manager invite, but refuses staff before reading the form', async () => {
    signedInAs('admin')
    expect(
      (await inviteTeammate({}, form({ email: 'a@b.co', role: 'staff' })))
        .message
    ).toMatch(/Invite saved/)
    signedInAs('staff')
    const data = form({ email: 'a@b.co', role: 'staff' })
    const read = vi.spyOn(data, 'get')
    expect((await inviteTeammate({}, data)).error).toBe(
      'Only the owner or a manager can change the team.'
    )
    expect(read).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('refuses the demo and bad input without saving', async () => {
    env.values = { AUTH_MODE: 'demo' }
    expect(
      (await inviteTeammate({}, form({ email: 'a@b.co', role: 'staff' }))).error
    ).toMatch(/sign in again/)
    env.values = { AUTH_MODE: 'supabase' }
    expect(
      (await inviteTeammate({}, form({ email: 'nope', role: 'staff' }))).error
    ).toBe('Enter an email address like name@company.com.')
    expect(
      (await inviteTeammate({}, form({ email: 'a@b.co', role: 'owner' }))).error
    ).toBe('Choose Staff or Manager.')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains duplicates and refusals in plain words', async () => {
    const cases = [
      [{ code: 'PT409', message: 'Already a member' }, /already on the team/],
      [{ code: 'PT409', message: 'Already invited' }, /Use Resend/],
      [
        { code: '42501', message: 'Team administrator required' },
        /Only the owner or a manager/
      ],
      [{ code: '23514' }, /Check the details/],
      [{ code: 'XX000' }, /Nothing was changed/]
    ] as const
    for (const [error, text] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect(
        (await inviteTeammate({}, form({ email: 'a@b.co', role: 'staff' })))
          .error
      ).toMatch(text)
    }
  })
})

describe('resendInvite and cancelInvite', () => {
  it('resend renews the invite, cancel cancels it', async () => {
    expect((await resendInvite({}, form({ id: invite }))).message).toBe(
      'Invite renewed for 7 more days. No email was sent.'
    )
    expect(rpc).toHaveBeenLastCalledWith('resend_team_invite', {
      t: tenant,
      invite
    })
    expect((await cancelInvite({}, form({ id: invite }))).message).toBe(
      'Invite cancelled.'
    )
    expect(rpc).toHaveBeenLastCalledWith('revoke_team_invite', {
      t: tenant,
      invite
    })
  })

  it('needs an id, a manager, and says when the invite is gone', async () => {
    expect((await resendInvite({}, form({ id: 'x' }))).error).toBe(
      'Reload the page and try again.'
    )
    signedInAs('staff')
    expect((await cancelInvite({}, form({ id: invite }))).error).toMatch(
      /Only the owner or a manager/
    )
    expect(rpc).not.toHaveBeenCalled()
    signedInAs('owner')
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PT409', message: 'This invite was cancelled or accepted' }
    })
    expect((await cancelInvite({}, form({ id: invite }))).error).toBe(
      'This invite was already cancelled or accepted. Reload the page.'
    )
  })
})

describe('changeMember', () => {
  it('changes a role with the version the person saw', async () => {
    expect((await changeMember({}, form(change))).message).toBe(
      'Ana Lee is now a Manager.'
    )
    expect(rpc).toHaveBeenCalledWith('change_team_member', {
      t: tenant,
      membership: member,
      expected_at: change.updatedAt,
      role: 'admin',
      status: 'active'
    })
  })

  it('deactivates and reactivates', async () => {
    expect(
      (
        await changeMember(
          {},
          form({
            ...change,
            role: 'staff',
            status: 'inactive',
            change: 'deactivate'
          })
        )
      ).message
    ).toBe('Ana Lee was deactivated.')
    expect(
      (
        await changeMember(
          {},
          form({
            ...change,
            role: 'staff',
            status: 'active',
            change: 'reactivate'
          })
        )
      ).message
    ).toBe('Ana Lee was reactivated.')
  })

  it('never makes an owner and refuses staff', async () => {
    expect(
      (await changeMember({}, form({ ...change, role: 'owner' }))).error
    ).toBe('Reload the page and try again.')
    expect(
      (await changeMember({}, form({ ...change, status: 'invited' }))).error
    ).toBe('Reload the page and try again.')
    signedInAs('staff')
    expect((await changeMember({}, form(change))).error).toMatch(
      /Only the owner or a manager/
    )
    expect(rpc).not.toHaveBeenCalled()
  })

  it('explains the owner, self and stale refusals', async () => {
    const cases = [
      [
        { code: '42501', message: "The owner's access cannot be changed here" },
        'The owner’s access cannot be changed here.'
      ],
      [
        { code: '42501', message: 'You cannot change your own access' },
        'You cannot change your own access. Ask the owner.'
      ],
      [
        { code: '42501', message: 'Member unavailable' },
        'This is no longer on your team. Reload the page.'
      ],
      [
        { code: 'PT409', message: 'Membership changed' },
        'Someone changed this in another window. Reload the page and try again.'
      ]
    ] as const
    for (const [error, text] of cases) {
      rpc.mockResolvedValueOnce({ data: null, error })
      expect((await changeMember({}, form(change))).error).toBe(text)
    }
  })
})
