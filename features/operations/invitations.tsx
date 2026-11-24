import { ActionButton } from '@/components/gros/action'
import { createClient } from '@/lib/supabase/server'
import { acceptInvite } from './actions'

const roleWords = {
  owner: 'Owner',
  admin: 'Admin',
  staff: 'Staff'
} as const

/**
 * The invitations waiting for the signed-in person's verified email
 * (UI-AUTH, on /onboarding): each workspace in a mist tile with its role
 * and one Accept invite button (the RPC checks the email and the expiry
 * again, and opens the workspace). Nothing when there are none or the
 * list cannot be read: creating a workspace stays the way on.
 */
export async function PendingInvites() {
  const db = await createClient()
  if (!db) return null
  const invites = await db.rpc('my_pending_invites')
  if (!invites.data?.length) return null
  return (
    <section
      aria-labelledby="pending-invites"
      className="flex w-full flex-col gap-[var(--space-4)]"
    >
      <h2 id="pending-invites" className="type-heading">
        Your invites
      </h2>
      <ul className="flex flex-col gap-[var(--space-3)]">
        {invites.data.map((invite) => (
          <li
            key={invite.id}
            className="gros-tile flex flex-wrap items-center justify-between gap-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--mist)]"
          >
            <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
              <p className="type-body-strong break-words">
                {invite.tenant_name}
              </p>
              <p className="type-caption text-[var(--stone)]">
                {roleWords[invite.role] ?? invite.role}
              </p>
            </div>
            <ActionButton
              action={acceptInvite}
              label="Accept invite"
              spokenLabel={`Accept invite: ${invite.tenant_name}`}
              fields={{ id: invite.id }}
              kind="outline"
              size="row"
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
