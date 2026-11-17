import { Mail } from 'lucide-react'
import type { ReactNode } from 'react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card, Tile } from '@/components/gros/card'
import { ListRow, RowList } from '@/components/gros/list-row'
import { cancelInvite, resendInvite } from '@/features/team/actions'
import {
  expiryText,
  initial,
  roleLabel,
  type PendingInvite,
  type TeamMember
} from '@/features/team/rules'
import { InviteForm } from './invite-form'
import type { SettingsView } from './page-model'

/**
 * The Team card on Settings (UI-SETb): who is on the team and the open
 * invites, and for the owner and managers the buttons that change them
 * (invite, resend, cancel), each calling the Team page's server actions,
 * which check the role again. Staff see the list only. The rows' answers
 * show in one place (`ActionAnswers`), so an answer stays when its row
 * goes with the change it made (a cancelled invite). "Who changed what" is
 * still on the old Team page until UI-SETc.
 */
export function TeamCard({
  view,
  unread
}: {
  view: SettingsView
  /** What the card says when the team could not be read (or in the demo). */
  unread: ReactNode
}) {
  const title = 'Team'
  const team = view.team
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {!team ? (
          unread
        ) : (
          <>
            <div className="grid grid-cols-2 gap-[var(--space-3)]">
              <Tile label="Members" value={team.members} />
              {team.openInvites !== null ? (
                <Tile label="Open invites" value={team.openInvites} />
              ) : null}
            </div>
            <ActionAnswers>
              <RowList label="Members">
                {team.roster.map((member) => (
                  <MemberRow key={member.id} member={member} />
                ))}
              </RowList>
              {!team.canManage ? null : team.invites ? (
                team.invites.length ? (
                  <RowList label="Open invites">
                    {team.invites.map((invite) => (
                      <InviteRow
                        key={invite.id}
                        invite={invite}
                        now={team.now}
                      />
                    ))}
                  </RowList>
                ) : null
              ) : (
                <p className="type-body text-[var(--stone)]">
                  The open invites could not be read just now. Open Settings
                  again in a minute.
                </p>
              )}
            </ActionAnswers>
            {team.canManage ? (
              <>
                <InviteForm />
                {/* Until UI-SETc brings who changed what onto Settings. */}
                <ButtonLink
                  href="/team"
                  label="See team changes"
                  kind="quiet"
                  size="row"
                />
              </>
            ) : (
              <p className="type-body text-[var(--stone)]">
                Only the owner or a manager can invite people and change access.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

function Thumb({ children }: { children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="gros-thumb type-body-strong flex shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--mist)] text-[var(--stone)]"
    >
      {children}
    </span>
  )
}

/** One person: their name or email, the email, the role, Deactivated. */
function MemberRow({ member }: { member: TeamMember }) {
  const name = member.name || member.email
  return (
    <ListRow
      thumbnail={<Thumb>{initial(member)}</Thumb>}
      title={member.isMe ? `${name} (you)` : name}
      details={[
        member.name ? member.email : '',
        roleLabel[member.role],
        member.status === 'inactive' ? 'Deactivated' : ''
      ]}
      end={null}
    />
  )
}

/** An open or expired invite, with Resend (7 more days) and Cancel invite. */
function InviteRow({ invite, now }: { invite: PendingInvite; now: number }) {
  return (
    <ListRow
      thumbnail={
        <Thumb>
          <Mail size={18} strokeWidth={2} />
        </Thumb>
      }
      title={invite.email}
      details={[
        `Invited as ${roleLabel[invite.role]}`,
        expiryText(invite.expiresAt, now)
      ]}
      end={
        <div className="flex flex-wrap gap-[var(--space-3)]">
          <ActionButton
            action={resendInvite}
            label="Resend"
            spokenLabel={invite.email}
            kind="outline"
            size="row"
            fields={{ id: invite.id }}
          />
          <ActionButton
            action={cancelInvite}
            label="Cancel invite"
            spokenLabel={invite.email}
            kind="quiet"
            size="row"
            fields={{ id: invite.id }}
          />
        </div>
      }
    />
  )
}
