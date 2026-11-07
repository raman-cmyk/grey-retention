'use client'
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useState
} from 'react'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { SubmitButton, type FormResult } from '@/components/ui/action-form'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { TextField } from '@/components/ui/text-field'
import { controlClass } from '@/components/ui/control'
import { cn } from '@/lib/utils'
import {
  cancelInvite,
  changeMember,
  inviteTeammate,
  resendInvite
} from './actions'
import {
  assignableRoles,
  expiryText,
  initial,
  isExpired,
  ownerOnlyNote,
  roleHelp,
  roleLabel,
  type AssignableRole,
  type PendingInvite,
  type TeamEvent,
  type TeamMember
} from './rules'

const labelClass =
  'tracking-label block font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'
const cardClass =
  'space-y-5 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6'

/**
 * A polite live region that is always rendered (never display:none), so
 * every screen reader announces what appears in it.
 */
function Status({
  state,
  pending,
  id
}: {
  state: FormResult
  pending: boolean
  id?: string
}) {
  const text = pending ? '' : (state.error ?? state.message ?? '')
  return (
    <p
      id={id}
      aria-live="polite"
      className={cn(
        'text-sm',
        !text
          ? 'sr-only'
          : state.error
            ? 'rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[var(--danger-ink)]'
            : 'rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-[var(--brand-ink)]'
      )}
    >
      {text}
    </p>
  )
}

/** Moves keyboard focus to an element once it is on the page. */
function useFocus() {
  const [target, setTarget] = useState<{ id: string } | null>(null)
  useEffect(() => {
    if (target) document.getElementById(target.id)?.focus()
  }, [target])
  return (id: string) => setTarget({ id })
}

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

/** "Invite a teammate". */
export function InviteCard() {
  const idBase = useId()
  // A new, empty form after each invite; typed values stay on an error.
  const [round, setRound] = useState(0)
  const [state, dispatch, pending] = useActionState(
    async (previous: FormResult, data: FormData) => {
      const result = await inviteTeammate(previous, data)
      if (result.message) setRound((n) => n + 1)
      return result
    },
    {}
  )
  useEffect(() => {
    if (round > 0) document.getElementById(`${idBase}-${round}-email`)?.focus()
  }, [round, idBase])
  const id = `${idBase}-${round}`
  // After a refusal the cursor goes back to Email, which points at the reason.
  useEffect(() => {
    if (state.error) document.getElementById(`${id}-email`)?.focus()
  }, [state, id])
  return (
    <section aria-labelledby={`${idBase}-title`} className={cardClass}>
      <div className="space-y-1">
        <h2 id={`${idBase}-title`} className="text-lg font-semibold">
          Invite a teammate
        </h2>
        <p className="text-sm text-[var(--text-muted)]">
          Email sending is not switched on yet, so no email is sent. Ask them to
          sign up with this email address: the invite waits for them there.
        </p>
      </div>
      <form
        key={round}
        action={dispatch}
        noValidate
        onReset={(event) => event.preventDefault()}
        className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
      >
        <div className="space-y-2">
          <label htmlFor={`${id}-email`} className={labelClass}>
            Email
          </label>
          <TextField
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="teammate@company.com"
            maxLength={254}
            required
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? `${idBase}-status` : undefined}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor={`${id}-role`} className={labelClass}>
            Role
          </label>
          <select
            id={`${id}-role`}
            name="role"
            defaultValue="staff"
            className={controlClass}
          >
            {assignableRoles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton pendingLabel="Saving…">Send invite</SubmitButton>
      </form>
      <p className="text-sm text-[var(--text-muted)]">
        <strong className="text-[var(--text)]">Manager:</strong>{' '}
        {roleHelp.admin} <strong className="text-[var(--text)]">Staff:</strong>{' '}
        {roleHelp.staff} {ownerOnlyNote}
      </p>
      <Status state={state} pending={pending} id={`${idBase}-status`} />
    </section>
  )
}

type Pending =
  | { kind: 'role'; member: TeamMember; role: AssignableRole }
  | { kind: 'deactivate' | 'reactivate'; member: TeamMember }

function MemberRow({
  member,
  canManage,
  busy,
  idBase,
  onAsk
}: {
  member: TeamMember
  canManage: boolean
  busy: boolean
  idBase: string
  onAsk: (change: Pending) => void
}) {
  const editable = canManage && member.role !== 'owner' && !member.isMe
  const name = member.name || member.email
  // The role picked in the list; nothing changes until "Change role" and Yes.
  const [picked, setPicked] = useState<AssignableRole>(
    member.role === 'admin' ? 'admin' : 'staff'
  )
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] py-4 last:border-b-0">
      <span
        aria-hidden="true"
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-full font-semibold',
          member.status === 'active'
            ? 'bg-[var(--brand-soft)] text-[var(--brand-ink)]'
            : 'bg-[var(--surface)] text-[var(--text-muted)]'
        )}
      >
        {initial(member)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold break-words">
          {name}
          {member.isMe && (
            <span className="font-normal text-[var(--text-muted)]"> (you)</span>
          )}
        </p>
        {member.name && (
          <p className="text-sm break-all text-[var(--text-muted)]">
            {member.email}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {member.status === 'inactive' && (
          <Pill tone="warning">Deactivated</Pill>
        )}
        {!editable || member.status === 'inactive' ? (
          <Pill tone={member.role === 'owner' ? 'solid' : 'neutral'}>
            {roleLabel[member.role]}
          </Pill>
        ) : (
          <>
            <label htmlFor={`${idBase}-role-${member.id}`} className="sr-only">
              Role for {name}
            </label>
            <select
              id={`${idBase}-role-${member.id}`}
              value={picked}
              disabled={busy}
              onChange={(event) =>
                setPicked(event.target.value === 'admin' ? 'admin' : 'staff')
              }
              className={cn(controlClass, 'w-auto')}
            >
              {assignableRoles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy || picked === member.role}
              aria-label={`Change role for ${name}`}
              onClick={() => onAsk({ kind: 'role', member, role: picked })}
            >
              Change role
            </Button>
          </>
        )}
        {editable && (
          <Button
            id={`${idBase}-toggle-${member.id}`}
            type="button"
            size="sm"
            variant={member.status === 'active' ? 'danger' : 'secondary'}
            disabled={busy}
            aria-label={`${member.status === 'active' ? 'Deactivate' : 'Reactivate'} ${name}`}
            onClick={() =>
              onAsk({
                kind: member.status === 'active' ? 'deactivate' : 'reactivate',
                member
              })
            }
          >
            {member.status === 'active' ? 'Deactivate' : 'Reactivate'}
          </Button>
        )}
      </div>
    </li>
  )
}

const question = (change: Pending) => {
  const name = change.member.name || change.member.email
  if (change.kind === 'role')
    return {
      title: `Make ${name} ${change.role === 'admin' ? 'a Manager' : 'Staff'}?`,
      body: `${roleHelp[change.role]} ${ownerOnlyNote}`,
      confirm: 'Change role',
      tone: 'primary' as const
    }
  if (change.kind === 'deactivate')
    return {
      title: `Deactivate ${name}?`,
      body: 'They can no longer open this workspace. Their past work stays. You can reactivate them later.',
      confirm: 'Deactivate',
      tone: 'danger' as const
    }
  return {
    title: `Reactivate ${name}?`,
    body: `They can open this workspace again as ${roleLabel[change.member.role]}.`,
    confirm: 'Reactivate',
    tone: 'primary' as const
  }
}

/** "Members (N)". */
export function MembersCard({
  members,
  canManage
}: {
  members: TeamMember[]
  canManage: boolean
}) {
  const idBase = useId()
  const focus = useFocus()
  const [asking, setAsking] = useState<Pending | null>(null)
  const [state, dispatch, pending] = useActionState(
    async (previous: FormResult, data: FormData) => {
      const result = await changeMember(previous, data)
      // The Deactivate/Reactivate button changes, so the cursor waits on
      // the card heading, next to the message.
      if (result.message && data.get('change') !== 'role')
        focus(`${idBase}-title`)
      return result
    },
    {}
  )
  const active = members.filter((m) => m.status === 'active').length
  const inactive = members.length - active
  const ask = asking ? question(asking) : null
  return (
    <section aria-labelledby={`${idBase}-title`} className={cardClass}>
      <h2
        id={`${idBase}-title`}
        tabIndex={-1}
        className="text-lg font-semibold outline-none"
      >
        Members ({active})
        {inactive > 0 && (
          <span className="font-normal text-[var(--text-muted)]">
            {' '}
            · {inactive} deactivated
          </span>
        )}
      </h2>
      <Status state={state} pending={pending} />
      <ul>
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            canManage={canManage}
            busy={pending}
            idBase={idBase}
            onAsk={setAsking}
          />
        ))}
      </ul>
      {!canManage && (
        <p className="text-sm text-[var(--text-muted)]">
          Only the owner or a manager can invite people and change access.
        </p>
      )}
      <AlertDialog
        open={asking !== null}
        title={ask?.title ?? ''}
        confirmLabel={ask?.confirm ?? 'Confirm'}
        tone={ask?.tone ?? 'primary'}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          if (!asking) return
          const m = asking.member
          const data = form({
            id: m.id,
            updatedAt: m.updatedAt,
            name: m.name || m.email,
            change: asking.kind,
            role: asking.kind === 'role' ? asking.role : m.role,
            status:
              asking.kind === 'deactivate'
                ? 'inactive'
                : asking.kind === 'reactivate'
                  ? 'active'
                  : m.status
          })
          setAsking(null)
          startTransition(() => dispatch(data))
        }}
      >
        {ask?.body}
      </AlertDialog>
    </section>
  )
}

/** "Pending invites (N)": open and expired invites, with Resend / Cancel. */
export function InvitesCard({
  invites,
  now
}: {
  invites: PendingInvite[]
  now: number
}) {
  const idBase = useId()
  const focus = useFocus()
  const [resent, resend, resending] = useActionState(resendInvite, {})
  const [cancelled, cancel, cancelling] = useActionState(
    async (previous: FormResult, data: FormData) => {
      const result = await cancelInvite(previous, data)
      if (result.message) focus(`${idBase}-title`)
      return result
    },
    {}
  )
  // The latest answer, whichever button was used.
  const [last, setLast] = useState<'resend' | 'cancel'>('resend')
  const busy = resending || cancelling
  return (
    <section aria-labelledby={`${idBase}-title`} className={cardClass}>
      <h2
        id={`${idBase}-title`}
        tabIndex={-1}
        className="text-lg font-semibold outline-none"
      >
        Pending invites ({invites.length})
      </h2>
      <Status state={last === 'resend' ? resent : cancelled} pending={busy} />
      {invites.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No pending invites.</p>
      ) : (
        <ul>
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] py-4 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="font-semibold break-all">{invite.email}</p>
                <p className="text-sm text-[var(--text-muted)]">
                  {roleLabel[invite.role]} ·{' '}
                  <span
                    className={cn(
                      isExpired(invite.expiresAt, now) &&
                        'text-[var(--danger-ink)]'
                    )}
                  >
                    {expiryText(invite.expiresAt, now)}
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  aria-label={`Resend invite to ${invite.email}`}
                  onClick={() => {
                    setLast('resend')
                    startTransition(() => resend(form({ id: invite.id })))
                  }}
                >
                  Resend
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  aria-label={`Cancel invite to ${invite.email}`}
                  onClick={() => {
                    setLast('cancel')
                    startTransition(() => cancel(form({ id: invite.id })))
                  }}
                >
                  Cancel
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** "Recent team changes" (owners and managers): who changed what, when. */
export function ActivityCard({
  events,
  timezone
}: {
  events: TeamEvent[]
  timezone: string
}) {
  const id = useId()
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric'
  })
  return (
    <section aria-labelledby={id} className={cardClass}>
      <h2 id={id} className="text-lg font-semibold">
        Recent team changes
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">No changes yet.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {events.map((event) => (
            <li key={event.id}>
              {event.text}
              <span className="text-[var(--text-muted)]">
                {' '}
                · by {event.by} · {date.format(new Date(event.at))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
