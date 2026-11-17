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
  it('shows a manager the team, the open invites and the buttons that change them', () => {
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

    const invites = within(
      within(c).getByRole('list', { name: 'Open invites' })
    ).getAllByRole('listitem')
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
    expect(c).toHaveTextContent('No email is sent yet.')
    expect(
      within(c).getByRole('link', { name: 'See team changes' })
    ).toHaveAttribute('href', '/team')
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

  it('still lets a manager invite when the open invites could not be read', () => {
    render(teamCard({ invites: null, openInvites: null }))
    const c = card()
    expect(c).toHaveTextContent(
      'The open invites could not be read just now. Open Settings again in a minute.'
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
    expect(
      await within(card()).findByText(
        'Invite saved for ana@example.com as Manager.'
      )
    ).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(email).toHaveValue(''))
    expect(email).not.toHaveAttribute('aria-invalid')
    expect(email).toHaveFocus()
  })

  it('invites as Staff with Enter; a refusal stays under Email, which keeps what was typed', async () => {
    const user = userEvent.setup()
    team.inviteTeammate.mockResolvedValue({
      error: 'This person is already on the team.'
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
      'This person is already on the team.'
    )
    expect(email).toHaveValue('sam@cedarlane.example')
    expect(email).toHaveFocus()
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
})
