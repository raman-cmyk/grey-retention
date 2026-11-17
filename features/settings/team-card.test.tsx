import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PendingInvite, TeamMember } from '@/features/team/rules'
import type { SettingsView } from './page-model'
import { TeamCard } from './team-card'

afterEach(cleanup)

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

describe('Team card on Settings (UI-SETb)', () => {
  it('shows a manager the team and the pending invites', () => {
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
      within(c).getByRole('list', { name: 'Pending invites' })
    ).getAllByRole('listitem')
    // The tile counts open invites; the list also shows the expired one.
    expect(invites).toHaveLength(2)
    expect(invites[0]).toHaveTextContent(
      'new@cedarlane.exampleInvited as Manager · Expires in 3 days'
    )
    expect(invites[1]).toHaveTextContent('Invited as Staff · Expired')
    expect(
      within(c).getByRole('link', { name: 'Manage team' })
    ).toHaveAttribute('href', '/team')
  })

  it('shows staff the members only, with no invites and no buttons', () => {
    render(teamCard({ canManage: false, openInvites: null, invites: null }))
    const c = card()
    expect(
      within(within(c).getByRole('list', { name: 'Members' })).getAllByRole(
        'listitem'
      )
    ).toHaveLength(4)
    expect(within(c).queryByRole('button')).toBeNull()
    expect(within(c).queryByText('Open invites')).toBeNull()
    expect(c).not.toHaveTextContent('could not be read')
    expect(within(c).getByRole('link', { name: 'See team' })).toBeVisible()
  })

  it('shows only why when the team could not be read (also the demo)', () => {
    render(teamCard(null))
    expect(card()).toHaveTextContent('The team could not be read just now.')
    expect(within(card()).queryByRole('list')).toBeNull()
    expect(within(card()).queryByRole('button')).toBeNull()
  })

  it('says when the pending invites could not be read, and still lists the team', () => {
    render(teamCard({ invites: null, openInvites: null }))
    const c = card()
    expect(c).toHaveTextContent(
      'The pending invites could not be read just now. Open Settings again in a minute.'
    )
    expect(within(c).queryByText('Open invites')).toBeNull()
    expect(within(c).getByRole('list', { name: 'Members' })).toBeVisible()
    // None at all is no sentence and no list.
    cleanup()
    render(teamCard({ invites: [], openInvites: 0 }))
    expect(card()).not.toHaveTextContent('could not be read')
    expect(
      within(card()).queryByRole('list', { name: 'Pending invites' })
    ).toBeNull()
  })
})
