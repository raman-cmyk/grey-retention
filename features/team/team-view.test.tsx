import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installDialogPolyfill } from '@/tests/helpers/dialog-polyfill'

const actions = vi.hoisted(() => ({
  inviteTeammate: vi.fn(async () => ({ message: 'Invite saved.' })),
  resendInvite: vi.fn(async () => ({
    message: 'Invite renewed for 7 more days. No email was sent.'
  })),
  cancelInvite: vi.fn(async () => ({ message: 'Invite cancelled.' })),
  changeMember: vi.fn(async () => ({ message: 'Done.' }))
}))
vi.mock('./actions', () => actions)

import { ActivityCard, InviteCard, InvitesCard, MembersCard } from './team-view'
import type { TeamMember } from './rules'

installDialogPolyfill()
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const owner: TeamMember = {
  id: 'm-owner',
  profileId: 'p-owner',
  name: 'Olive Owner',
  email: 'owner@example.com',
  role: 'owner',
  status: 'active',
  updatedAt: '2026-11-06T10:00:00Z',
  isMe: true
}
const staff: TeamMember = {
  id: 'm-staff',
  profileId: 'p-staff',
  name: 'Sam Staff',
  email: 'sam@example.com',
  role: 'staff',
  status: 'active',
  updatedAt: '2026-11-06T11:00:00Z',
  isMe: false
}
const gone: TeamMember = {
  ...staff,
  id: 'm-gone',
  name: '',
  email: 'gone@example.com',
  status: 'inactive'
}
const sent = (mock: { mock: { calls: unknown[][] } }) =>
  mock.mock.calls[0]?.[1] as FormData

describe('InviteCard', () => {
  it('has email, role (Staff or Manager) and is honest about email', async () => {
    render(<InviteCard />)
    expect(screen.getByLabelText('Email')).toHaveAttribute(
      'placeholder',
      'teammate@company.com'
    )
    const role = screen.getByLabelText('Role')
    expect(role).toHaveValue('staff')
    expect(
      within(role)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Staff', 'Manager'])
    expect(screen.getByText(/no email is sent/)).toBeVisible()
    expect(
      screen.getByText(/Only the owner approves copy, designs and sending/)
    ).toBeVisible()
    await userEvent.type(screen.getByLabelText('Email'), 'ana@example.com')
    await userEvent.selectOptions(role, 'admin')
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    const data = sent(actions.inviteTeammate)
    expect(data.get('email')).toBe('ana@example.com')
    expect(data.get('role')).toBe('admin')
    expect(await screen.findByText('Invite saved.')).toBeVisible()
    // A fresh form, cursor in Email for the next one.
    expect(screen.getByLabelText('Email')).toHaveValue('')
    await vi.waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus())
  })

  it('keeps what was typed when the invite is refused', async () => {
    actions.inviteTeammate.mockResolvedValueOnce({
      error: 'This person is already on the team.'
    } as never)
    render(<InviteCard />)
    await userEvent.type(screen.getByLabelText('Email'), 'sam@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send invite' }))
    expect(
      await screen.findByText('This person is already on the team.')
    ).toBeVisible()
    const email = screen.getByLabelText('Email')
    expect(email).toHaveValue('sam@example.com')
    // The field points at the reason, and the cursor is back in it.
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(
      'This person is already on the team.'
    )
    await vi.waitFor(() => expect(email).toHaveFocus())
  })
})

describe('MembersCard', () => {
  it('lists members: owner pill, (you), email, and the deactivated count', () => {
    render(<MembersCard members={[owner, staff, gone]} canManage />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Members (2) · 1 deactivated'
    )
    const me = screen.getByText('Olive Owner').closest('li')!
    expect(me).toHaveTextContent('(you)')
    expect(within(me).getByText('Owner')).toBeVisible()
    expect(within(me).queryByRole('combobox')).toBeNull()
    expect(within(me).queryByRole('button')).toBeNull()
    const sam = screen.getByText('Sam Staff').closest('li')!
    expect(within(sam).getByText('sam@example.com')).toBeVisible()
    expect(within(sam).getByText('S')).toBeInTheDocument()
    const old = screen.getByText('gone@example.com').closest('li')!
    expect(within(old).getByText('Deactivated')).toBeVisible()
    expect(
      within(old).getByRole('button', { name: 'Reactivate gone@example.com' })
    ).toBeVisible()
  })

  it('changes nothing until Change role and Yes; Cancel keeps the role', async () => {
    render(<MembersCard members={[owner, staff]} canManage />)
    const select = screen.getByLabelText('Role for Sam Staff')
    const change = screen.getByRole('button', {
      name: 'Change role for Sam Staff'
    })
    expect(change).toBeDisabled()
    await userEvent.selectOptions(select, 'admin')
    // Picking alone opens nothing (keyboard users can browse the list).
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(change).toBeEnabled()
    await userEvent.click(change)
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Make Sam Staff a Manager?')).toBeVisible()
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Cancel' })
    )
    expect(actions.changeMember).not.toHaveBeenCalled()
  })

  it('changes the role after Yes, with the version shown', async () => {
    actions.changeMember.mockResolvedValueOnce({
      message: 'Sam Staff is now a Manager.'
    } as never)
    render(<MembersCard members={[owner, staff]} canManage />)
    await userEvent.selectOptions(
      screen.getByLabelText('Role for Sam Staff'),
      'admin'
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Change role for Sam Staff' })
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Change role'
      })
    )
    await vi.waitFor(() => expect(actions.changeMember).toHaveBeenCalled())
    const data = sent(actions.changeMember)
    expect(Object.fromEntries(data)).toEqual({
      id: 'm-staff',
      updatedAt: '2026-11-06T11:00:00Z',
      name: 'Sam Staff',
      change: 'role',
      role: 'admin',
      status: 'active'
    })
    expect(await screen.findByText('Sam Staff is now a Manager.')).toBeVisible()
  })

  it('asks before deactivating, then moves the cursor to the heading', async () => {
    actions.changeMember.mockResolvedValueOnce({
      message: 'Sam Staff was deactivated.'
    } as never)
    render(<MembersCard members={[owner, staff]} canManage />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Deactivate Sam Staff' })
    )
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Deactivate Sam Staff?')).toBeVisible()
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Deactivate' })
    )
    await vi.waitFor(() => expect(actions.changeMember).toHaveBeenCalled())
    expect(sent(actions.changeMember).get('status')).toBe('inactive')
    expect(sent(actions.changeMember).get('role')).toBe('staff')
    expect(await screen.findByText('Sam Staff was deactivated.')).toBeVisible()
    await vi.waitFor(() =>
      expect(screen.getByRole('heading', { level: 2 })).toHaveFocus()
    )
  })

  it('shows a refusal on the card', async () => {
    actions.changeMember.mockResolvedValueOnce({
      error:
        'Someone changed this in another window. Reload the page and try again.'
    } as never)
    render(<MembersCard members={[owner, staff]} canManage />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Deactivate Sam Staff' })
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Deactivate'
      })
    )
    expect(
      await screen.findByText(/Someone changed this in another window/)
    ).toBeVisible()
  })

  it('a manager cannot change themselves; staff see roles only', () => {
    const me = { ...staff, role: 'admin' as const, isMe: true }
    const { unmount } = render(<MembersCard members={[owner, me]} canManage />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByText('Manager')).toBeVisible()
    unmount()
    render(<MembersCard members={[owner, staff]} canManage={false} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(
      screen.getByText(
        'Only the owner or a manager can invite people and change access.'
      )
    ).toBeVisible()
  })
})

describe('InvitesCard', () => {
  const now = Date.parse('2026-11-06T12:00:00Z')
  const invites = [
    {
      id: 'i1',
      email: 'new@example.com',
      role: 'admin' as const,
      expiresAt: '2026-11-13T12:00:00Z'
    },
    {
      id: 'i2',
      email: 'late@example.com',
      role: 'staff' as const,
      expiresAt: '2026-11-01T12:00:00Z'
    }
  ]

  it('lists pending invites with role and expiry', () => {
    render(<InvitesCard invites={invites} now={now} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Pending invites (2)'
    )
    const first = screen.getByText('new@example.com').closest('li')!
    expect(first).toHaveTextContent('Manager · Expires in 7 days')
    const second = screen.getByText('late@example.com').closest('li')!
    expect(second).toHaveTextContent('Staff · Expired')
  })

  it('resends and cancels', async () => {
    render(<InvitesCard invites={invites} now={now} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Resend invite to late@example.com' })
    )
    expect(
      await screen.findByText(
        'Invite renewed for 7 more days. No email was sent.'
      )
    ).toBeVisible()
    expect(sent(actions.resendInvite).get('id')).toBe('i2')
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel invite to new@example.com' })
    )
    expect(await screen.findByText('Invite cancelled.')).toBeVisible()
    expect(sent(actions.cancelInvite).get('id')).toBe('i1')
  })

  it('shows the empty state', () => {
    render(<InvitesCard invites={[]} now={now} />)
    expect(screen.getByText('No pending invites.')).toBeVisible()
  })
})

describe('ActivityCard', () => {
  it('lists recent team changes with who and when', () => {
    render(
      <ActivityCard
        timezone="Asia/Kathmandu"
        events={[
          {
            id: 'e1',
            text: 'Sam Staff was deactivated',
            by: 'you',
            at: '2026-11-06T10:00:00Z'
          }
        ]}
      />
    )
    expect(
      screen.getByRole('heading', { name: 'Recent team changes' })
    ).toBeVisible()
    expect(
      screen.getByText('Sam Staff was deactivated').closest('li')
    ).toHaveTextContent('Sam Staff was deactivated · by you · Nov 6')
  })

  it('says when nothing changed yet', () => {
    render(<ActivityCard timezone="UTC" events={[]} />)
    expect(screen.getByText('No changes yet.')).toBeVisible()
  })
})
