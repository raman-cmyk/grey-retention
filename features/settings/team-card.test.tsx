import {
  cleanup,
  render,
  screen,
  waitFor,
  within
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const team = vi.hoisted(() => ({
  inviteTeammate: vi.fn(),
  resendInvite: vi.fn(),
  cancelInvite: vi.fn(),
  changeMember: vi.fn()
}))
vi.mock('@/features/team/actions', () => team)

import type { PendingInvite, TeamMember } from '@/features/team/rules'
import type { SettingsView } from './page-model'
import { TeamCard } from './team-card'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

const person = (over: Partial<TeamMember>): TeamMember => ({
  id: 'm-sam',
  profileId: 'p-sam',
  name: 'Sam Staff',
  email: 'sam@cedarlane.example',
  role: 'staff',
  status: 'active',
  updatedAt: '2026-11-06T11:00:00.123456+00:00',
  isMe: false,
  ...over
})
const me = person({
  id: 'm-owner',
  name: 'Olive Owner',
  email: 'owner@cedarlane.example',
  role: 'owner',
  isMe: true
})
const sam = person({})
const ana = person({
  id: 'm-ana',
  name: 'Ana Lee',
  email: 'ana@cedarlane.example',
  role: 'admin'
})
const gone = person({
  id: 'm-gone',
  name: '',
  email: 'gone@cedarlane.example',
  status: 'inactive'
})
const invite = (
  id: string,
  email: string,
  role: 'admin' | 'staff',
  at: string
) => ({ id, email, role, expiresAt: at }) satisfies PendingInvite
const fresh = invite(
  'i-new',
  'new@cedarlane.example',
  'admin',
  '2026-11-20T00:00:00Z'
)
const old = invite(
  'i-old',
  'old@cedarlane.example',
  'staff',
  '2026-11-01T00:00:00Z'
)

type Team = NonNullable<SettingsView['team']>
/** The card as Settings draws it; only `team` is read. */
const teamCard = (over: Partial<Team> | null = {}) => (
  <TeamCard
    view={
      {
        team:
          over === null
            ? null
            : {
                members: 3,
                openInvites: 1,
                canManage: true,
                roster: [me, sam, ana, gone],
                invites: [fresh, old],
                now: Date.parse('2026-11-16T12:00:00Z'),
                ...over
              }
      } as SettingsView
    }
    unread={<p>The team could not be read just now.</p>}
  />
)

const card = () => screen.getByRole('region', { name: 'Team' })
const fieldsOf = (button: HTMLElement) =>
  Object.fromEntries(
    new FormData(button.closest('form')!) as unknown as [string, string][]
  )
const sent = (mock: ReturnType<typeof vi.fn>) =>
  Object.fromEntries(
    mock.mock.calls[0]![1] as FormData as unknown as [string, string][]
  )
/** The card's one line for its rows' answers. */
const answerLine = () =>
  card().querySelector<HTMLElement>('p[aria-live][tabindex="-1"]')!

describe('Team card on Settings (UI-SETb)', () => {
  it('shows a manager the team, the pending invites and the buttons that change them', () => {
    render(teamCard())
    const c = card()
    expect(within(c).getByText('Members').parentElement).toHaveTextContent(
      'Members3'
    )
    expect(within(c).getByText('Open invites').parentElement).toHaveTextContent(
      'Open invites1'
    )
    const rows = within(
      within(c).getByRole('list', { name: 'Members' })
    ).getAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('p')!.textContent)).toEqual([
      'Olive Owner (you)',
      'Sam Staff',
      'Ana Lee',
      'gone@cedarlane.example'
    ])
    expect(rows[0]).toHaveTextContent('owner@cedarlane.example · Owner')
    expect(rows[2]).toHaveTextContent('ana@cedarlane.example · Manager')
    // No name: the email speaks for them.
    expect(rows[3]).toHaveTextContent('Staff · Deactivated')
    // The owner's row and your own have no buttons; each other names its person.
    expect(within(rows[0]!).queryByRole('button')).toBeNull()
    expect(
      fieldsOf(
        within(rows[1]!).getByRole('button', {
          name: 'Make Manager: Sam Staff'
        })
      )
    ).toEqual({
      id: 'm-sam',
      updatedAt: '2026-11-06T11:00:00.123456+00:00',
      name: 'Sam Staff',
      change: 'role',
      role: 'admin',
      status: 'active'
    })
    expect(
      fieldsOf(
        within(rows[1]!).getByRole('button', { name: 'Deactivate: Sam Staff' })
      )
    ).toMatchObject({ change: 'deactivate', role: 'staff', status: 'inactive' })
    expect(
      fieldsOf(
        within(rows[2]!).getByRole('button', { name: 'Make Staff: Ana Lee' })
      )
    ).toMatchObject({ change: 'role', role: 'staff', status: 'active' })
    // A deactivated teammate can only come back.
    const back = within(rows[3]!).getAllByRole('button')
    expect(back.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Reactivate: gone@cedarlane.example'
    ])
    expect(fieldsOf(back[0]!)).toMatchObject({
      name: 'gone@cedarlane.example',
      change: 'reactivate',
      status: 'active'
    })

    const invites = within(
      within(c).getByRole('list', { name: 'Pending invites' })
    ).getAllByRole('listitem')
    // The tile counts open invites; the list also shows the expired one.
    expect(invites).toHaveLength(2)
    expect(invites[0]).toHaveTextContent(
      'new@cedarlane.exampleInvited as Manager · Expires in 3 days'
    )
    expect(invites[1]).toHaveTextContent('Invited as Staff · Expired')
    // Each button names the address it changes.
    for (const name of [
      'Resend: new@cedarlane.example',
      'Cancel invite: new@cedarlane.example'
    ])
      expect(
        fieldsOf(within(invites[0]!).getByRole('button', { name }))
      ).toEqual({ id: 'i-new' })
    expect(
      within(invites[1]!).getByRole('button', {
        name: 'Resend: old@cedarlane.example'
      })
    ).toBeVisible()

    // One main button: Invite as Staff.
    expect(within(c).getByLabelText('Email')).toHaveAttribute('type', 'email')
    const main = within(c)
      .getAllByRole('button')
      .filter((b) => b.className.includes('bg-[var(--forest)]'))
    expect(main.map((b) => b.textContent)).toEqual(['Invite as Staff'])
    expect(
      within(c).getByRole('button', { name: 'Invite as Manager' }).className
    ).toContain('gros-button-outline')
    // What each role may do, by its button; the hint describes Email.
    expect(
      within(c).getByRole('button', { name: 'Invite as Staff' })
    ).toHaveAccessibleDescription(
      'Staff work on campaigns but cannot manage the team.'
    )
    expect(
      within(c).getByRole('button', { name: 'Invite as Manager' })
    ).toHaveAccessibleDescription(
      'Managers can invite people, change their access and see reports and usage. Only the owner approves copy, designs and sending.'
    )
    expect(within(c).getByLabelText('Email')).toHaveAccessibleDescription(
      'No email is sent yet. Ask them to sign up with this address.'
    )
    // Who changed what is the Recent changes card: no link to /team.
    expect(within(c).queryByRole('link')).toBeNull()
  })

  it('never lets a manager change the owner or their own access', () => {
    // A manager (Ana) looks: the owner is someone else.
    render(
      teamCard({
        roster: [{ ...me, isMe: false }, { ...ana, isMe: true }, sam]
      })
    )
    const rows = within(
      within(card()).getByRole('list', { name: 'Members' })
    ).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Olive Owner')
    expect(rows[0]).not.toHaveTextContent('(you)')
    expect(within(rows[0]!).queryByRole('button')).toBeNull()
    expect(rows[1]).toHaveTextContent('Ana Lee (you)')
    expect(within(rows[1]!).queryByRole('button')).toBeNull()
    expect(within(rows[2]!).getAllByRole('button')).toHaveLength(2)
  })

  it('shows staff the team with no buttons, no invites and no form', () => {
    render(teamCard({ canManage: false, openInvites: null, invites: null }))
    const c = card()
    expect(
      within(within(c).getByRole('list', { name: 'Members' })).getAllByRole(
        'listitem'
      )
    ).toHaveLength(4)
    expect(within(c).queryByRole('button')).toBeNull()
    expect(within(c).queryByRole('textbox')).toBeNull()
    expect(within(c).queryByRole('link')).toBeNull()
    expect(within(c).queryByText('Open invites')).toBeNull()
    expect(c).toHaveTextContent(
      'Only the owner or a manager can invite people and change access.'
    )
  })

  it('shows only why when the team could not be read (also the demo)', () => {
    render(teamCard(null))
    expect(card()).toHaveTextContent('Team')
    expect(card()).toHaveTextContent('The team could not be read just now.')
    expect(within(card()).queryByRole('button')).toBeNull()
    expect(within(card()).queryByRole('textbox')).toBeNull()
    expect(within(card()).queryByRole('link')).toBeNull()
  })

  it('still lets a manager invite when the pending invites could not be read', () => {
    render(teamCard({ invites: null, openInvites: null }))
    const c = card()
    expect(c).toHaveTextContent(
      'The pending invites could not be read just now. Open Settings again in a minute.'
    )
    expect(within(c).queryByText('Open invites')).toBeNull()
    expect(within(c).getByRole('list', { name: 'Members' })).toBeVisible()
    expect(
      within(c).getByRole('button', { name: 'Invite as Staff' })
    ).toBeEnabled()
  })

  it('invites as Manager, says so, and empties Email for the next one', async () => {
    const user = userEvent.setup()
    team.inviteTeammate.mockResolvedValue({
      message: 'Invite saved for ana@example.com as Manager.'
    })
    render(teamCard())
    const email = within(card()).getByLabelText('Email')
    await user.type(email, 'ana@example.com')
    await user.click(
      within(card()).getByRole('button', { name: 'Invite as Manager' })
    )
    await waitFor(() => expect(team.inviteTeammate).toHaveBeenCalledOnce())
    expect(sent(team.inviteTeammate)).toEqual({
      email: 'ana@example.com',
      role: 'admin'
    })
    // In the card's one line, which is a live region.
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent(
        'Invite saved for ana@example.com as Manager.'
      )
    )
    expect(answerLine()).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(email).toHaveValue(''))
    expect(email).not.toHaveAttribute('aria-invalid')
    expect(email).toHaveFocus()
  })

  it('invites as Staff with Enter; a refusal stays under Email, which keeps what was typed', async () => {
    const user = userEvent.setup()
    team.inviteTeammate.mockResolvedValue({
      error: 'This person is already on the team.',
      field: 'email'
    })
    render(teamCard())
    const email = within(card()).getByLabelText('Email')
    await user.type(email, 'sam@cedarlane.example{Enter}')
    await waitFor(() => expect(team.inviteTeammate).toHaveBeenCalledOnce())
    expect(sent(team.inviteTeammate)).toEqual({
      email: 'sam@cedarlane.example',
      role: 'staff'
    })
    expect(await within(card()).findByRole('alert')).toHaveTextContent(
      'This person is already on the team.'
    )
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveAccessibleDescription(
      'No email is sent yet. Ask them to sign up with this address. This person is already on the team.'
    )
    expect(email).toHaveValue('sam@cedarlane.example')
    expect(email).toHaveFocus()
    expect(answerLine()).toHaveTextContent('')
  })

  it('says a refusal about the session in the card’s line, not on Email', async () => {
    const user = userEvent.setup()
    team.inviteTeammate.mockResolvedValue({ error: 'Please sign in again.' })
    render(teamCard())
    const email = within(card()).getByLabelText('Email')
    await user.type(email, 'ana@example.com')
    await user.click(
      within(card()).getByRole('button', { name: 'Invite as Staff' })
    )
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent('Please sign in again.')
    )
    expect(answerLine().className).toContain('text-[var(--signal-ink)]')
    expect(within(card()).queryByRole('alert')).toBeNull()
    expect(email).not.toHaveAttribute('aria-invalid')
    expect(email).toHaveValue('ana@example.com')
  })

  it('shows one answer at a time: a row’s answer replaces the invite’s, and its error', async () => {
    const user = userEvent.setup()
    team.inviteTeammate
      .mockResolvedValueOnce({ message: 'Invite saved for ana@example.com.' })
      .mockResolvedValueOnce({
        error: 'Enter an email address like name@company.com.',
        field: 'email'
      })
    team.resendInvite.mockResolvedValue({
      message: 'Invite renewed for 7 more days.'
    })
    render(teamCard())
    const email = within(card()).getByLabelText('Email')
    const invite = within(card()).getByRole('button', {
      name: 'Invite as Staff'
    })
    const resend = within(card()).getByRole('button', {
      name: 'Resend: new@cedarlane.example'
    })
    await user.type(email, 'ana@example.com')
    await user.click(invite)
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent(
        'Invite saved for ana@example.com.'
      )
    )
    await user.click(resend)
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent('Invite renewed for 7 more days.')
    )
    expect(card()).not.toHaveTextContent('Invite saved')
    // A refusal about the address clears the line, and goes when a row answers.
    await user.type(email, 'nope')
    await user.click(invite)
    expect(await within(card()).findByRole('alert')).toHaveTextContent(
      'Enter an email address like name@company.com.'
    )
    expect(answerLine()).toHaveTextContent('')
    await user.click(resend)
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent('Invite renewed for 7 more days.')
    )
    expect(within(card()).queryByRole('alert')).toBeNull()
    expect(email).not.toHaveAttribute('aria-invalid')
  })

  it('resends an invite and answers in the card; a refusal answers there too', async () => {
    const user = userEvent.setup()
    team.resendInvite
      .mockResolvedValueOnce({ message: 'Invite renewed for 7 more days.' })
      .mockResolvedValueOnce({ error: 'This invite was already cancelled.' })
    render(teamCard())
    const resend = within(card()).getByRole('button', {
      name: 'Resend: new@cedarlane.example'
    })
    await user.click(resend)
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent('Invite renewed for 7 more days.')
    )
    expect(sent(team.resendInvite)).toEqual({ id: 'i-new' })
    expect(resend).toHaveAccessibleDescription(
      'Invite renewed for 7 more days.'
    )
    await user.click(resend)
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent(
        'This invite was already cancelled.'
      )
    )
    expect(answerLine().className).toContain('text-[var(--signal-ink)]')
  })

  it('cancels an invite: the answer stays when its row leaves, and takes the cursor', async () => {
    const user = userEvent.setup()
    team.cancelInvite.mockResolvedValue({ message: 'Invite cancelled.' })
    const { rerender } = render(teamCard())
    await user.click(
      within(card()).getByRole('button', {
        name: 'Cancel invite: new@cedarlane.example'
      })
    )
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent('Invite cancelled.')
    )
    expect(sent(team.cancelInvite)).toEqual({ id: 'i-new' })
    // The page comes back without the invite.
    rerender(teamCard({ invites: [old], openInvites: 0 }))
    expect(card()).not.toHaveTextContent('new@cedarlane.example')
    expect(answerLine()).toHaveTextContent('Invite cancelled.')
    await waitFor(() => expect(answerLine()).toHaveFocus())
  })

  it('changes a role after the confirm, and the cursor goes to the answer', async () => {
    const user = userEvent.setup()
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    team.changeMember.mockResolvedValue({
      message: 'Sam Staff is now a Manager.'
    })
    const { rerender } = render(teamCard())
    const make = within(card()).getByRole('button', {
      name: 'Make Manager: Sam Staff'
    })
    await user.click(make)
    expect(ask).toHaveBeenCalledWith(
      'Make Sam Staff a Manager? Managers can invite people, change their access and see reports and usage. Only the owner approves copy, designs and sending.'
    )
    expect(team.changeMember).not.toHaveBeenCalled()
    ask.mockReturnValue(true)
    await user.click(make)
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent('Sam Staff is now a Manager.')
    )
    expect(sent(team.changeMember)).toMatchObject({
      id: 'm-sam',
      change: 'role',
      role: 'admin'
    })
    // The page comes back with the new role: the button changed, so the
    // cursor waits on the answer.
    rerender(teamCard({ roster: [me, { ...sam, role: 'admin' }, ana, gone] }))
    expect(
      within(card()).getByRole('button', { name: 'Make Staff: Sam Staff' })
    ).toBeVisible()
    await waitFor(() => expect(answerLine()).toHaveFocus())
  })

  it('deactivates and reactivates only after the confirm', async () => {
    const user = userEvent.setup()
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false)
    team.changeMember
      .mockResolvedValueOnce({ message: 'Sam Staff was deactivated.' })
      .mockResolvedValueOnce({
        error: 'You cannot change your own access. Ask the owner.'
      })
    render(teamCard())
    const deactivate = within(card()).getByRole('button', {
      name: 'Deactivate: Sam Staff'
    })
    // No sends nothing.
    await user.click(deactivate)
    expect(ask).toHaveBeenCalledOnce()
    expect(team.changeMember).not.toHaveBeenCalled()
    ask.mockReturnValue(true)
    await user.click(deactivate)
    expect(ask).toHaveBeenLastCalledWith(
      'Deactivate Sam Staff? They can no longer open this workspace. Their past work stays, and you can reactivate them later.'
    )
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent('Sam Staff was deactivated.')
    )
    await user.click(
      within(card()).getByRole('button', {
        name: 'Reactivate: gone@cedarlane.example'
      })
    )
    expect(ask).toHaveBeenLastCalledWith(
      'Reactivate gone@cedarlane.example? They can open this workspace again as Staff.'
    )
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent(
        'You cannot change your own access. Ask the owner.'
      )
    )
    expect(
      Object.fromEntries(
        team.changeMember.mock.calls[1]![1] as FormData as unknown as [
          string,
          string
        ][]
      )
    ).toMatchObject({ id: 'm-gone', change: 'reactivate', status: 'active' })
  })

  it('keeps the row when Cancel invite is refused, and the cursor on its button', async () => {
    const user = userEvent.setup()
    team.cancelInvite.mockResolvedValue({
      error: 'This invite was already cancelled or accepted. Reload the page.'
    })
    render(teamCard())
    const cancel = within(card()).getByRole('button', {
      name: 'Cancel invite: new@cedarlane.example'
    })
    await user.click(cancel)
    await waitFor(() =>
      expect(answerLine()).toHaveTextContent(
        'This invite was already cancelled or accepted. Reload the page.'
      )
    )
    expect(answerLine().className).toContain('text-[var(--signal-ink)]')
    expect(card()).toHaveTextContent('new@cedarlane.example')
    expect(cancel).toHaveAccessibleDescription(
      'This invite was already cancelled or accepted. Reload the page.'
    )
    expect(cancel).toHaveFocus()
  })
})
