'use client'
import { startTransition, useActionState, useId, useState } from 'react'
import type { FormResult } from '@/components/ui/action-form'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { useHydrated } from '@/components/ui/use-hydrated'
import { formatBrandDateTimeWithZone } from '@/lib/brand-time'
import { cn } from '@/lib/utils'
import { decideProposal, proposeChange } from './actions'
import type { GrosProposal } from './data'

type Intent =
  | 'edit_goal'
  | 'select_reference'
  | 'schedule'
  | 'cancel'
  | 'request_assignment'

const intentLabel: Record<Intent, string> = {
  edit_goal: 'Change the goal',
  select_reference: 'Use a reference email',
  schedule: 'Schedule it to send',
  cancel: 'Cancel the scheduled send',
  request_assignment: 'Ask for a designer'
}

/** What a proposal would do, in words, with the exact details. */
export function proposalText(
  p: Pick<
    GrosProposal,
    'kind' | 'campaignTitle' | 'goal' | 'referenceSubject' | 'plannedAt'
  >,
  timezone: string
) {
  const name = `“${p.campaignTitle}”`
  switch (p.kind) {
    case 'edit_goal':
      return `Set the goal of ${name} to “${p.goal ?? ''}”.`
    case 'select_reference':
      return p.referenceSubject
        ? `Use the competitor email “${p.referenceSubject}” as the reference for ${name}.`
        : `Use the chosen competitor email as the reference for ${name}.`
    case 'schedule':
      return p.plannedAt
        ? `Schedule ${name} to send on ${formatBrandDateTimeWithZone(p.plannedAt, timezone)}.`
        : `Schedule ${name} to send at its planned time.`
    case 'cancel':
      return `Cancel the scheduled send of ${name}.`
    case 'request_assignment':
      return `Ask for a designer for ${name}.`
    default:
      return `Change ${name}.`
  }
}

/** Who a waiting proposal waits for, in plain words. */
function statusPill(
  status: string,
  mine: boolean
): { tone: 'warning' | 'success' | 'neutral'; label: string } {
  if (status === 'pending')
    return {
      tone: 'warning',
      label: mine ? 'Waiting for you' : 'Waiting for the person who asked'
    }
  if (status === 'confirmed') return { tone: 'success', label: 'Applied' }
  if (status === 'rejected') return { tone: 'neutral', label: 'Dismissed' }
  return { tone: 'neutral', label: 'Expired' }
}

function Status({ state }: { state: FormResult }) {
  const text = state.error ?? state.message ?? ''
  return (
    <p
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

/**
 * Changes GROS proposed in this chat. Nothing changes until the person who
 * asked applies it, and applying asks first (owner approval stays explicit).
 */
export function ProposalList({
  chat,
  proposals,
  timezone
}: {
  chat: string
  proposals: GrosProposal[]
  timezone: string
}) {
  const hydrated = useHydrated()
  const [state, decide, deciding] = useActionState(decideProposal, {})
  const [confirm, setConfirm] = useState<{
    p: GrosProposal
    decision: 'confirmed' | 'rejected'
  } | null>(null)
  if (!proposals.length) return null
  return (
    <section aria-label="Proposed changes" className="space-y-2">
      <h3 className="text-sm font-semibold">Proposed changes</h3>
      <ul className="space-y-2">
        {proposals.map((p) => {
          const pill = statusPill(p.status, p.mine)
          return (
            <li
              key={p.id}
              className="space-y-2 rounded-[var(--radius-control)] border border-[var(--line)] p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={pill.tone}>{pill.label}</Pill>
                <span className="min-w-0 flex-1 break-words">
                  {proposalText(p, timezone)}
                </span>
              </div>
              {p.status === 'expired' && (
                <p className="text-xs text-[var(--text-muted)]">
                  Proposals stay open for 15 minutes. Ask again for a fresh one.
                </p>
              )}
              {p.status === 'pending' && (
                <p className="text-xs text-[var(--text-muted)]">
                  Open until{' '}
                  {formatBrandDateTimeWithZone(p.expiresAt, timezone)}.
                  {p.mine
                    ? ''
                    : ' Only the person who asked for it can apply it.'}
                </p>
              )}
              {p.status === 'pending' && p.mine && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={!hydrated || deciding}
                    onClick={() => setConfirm({ p, decision: 'confirmed' })}
                  >
                    Apply change
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!hydrated || deciding}
                    onClick={() => setConfirm({ p, decision: 'rejected' })}
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <Status state={deciding ? {} : state} />
      <AlertDialog
        open={confirm !== null}
        tone={confirm?.decision === 'rejected' ? 'danger' : 'primary'}
        title={
          confirm?.decision === 'rejected'
            ? 'Dismiss this change?'
            : 'Apply this change?'
        }
        confirmLabel={
          confirm?.decision === 'rejected' ? 'Dismiss' : 'Apply change'
        }
        pending={deciding}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return
          const data = new FormData()
          data.set('chat', chat)
          data.set('proposal', confirm.p.id)
          data.set('hash', confirm.p.hash)
          data.set('decision', confirm.decision)
          startTransition(() => {
            decide(data)
            setConfirm(null)
          })
        }}
      >
        {confirm && <p>{proposalText(confirm.p, timezone)}</p>}
        {confirm?.decision === 'confirmed' && (
          <p className="mt-2">
            GROS checks the campaign again first. Changing the goal or the
            reference resets the copy and design approvals, so they are approved
            again. A scheduled send is only a request until Klaviyo confirms it.
          </p>
        )}
      </AlertDialog>
    </section>
  )
}

/**
 * "Propose a change": GROS turns one request about one campaign into a
 * proposal the owner applies or dismisses. Scheduling, cancelling and
 * asking for a designer are for the owner only.
 */
export function ProposeChange({
  chat,
  campaigns,
  references,
  owner
}: {
  chat: string
  campaigns: { id: string; title: string }[]
  references: { id: string; subject: string }[]
  owner: boolean
}) {
  const id = useId()
  const hydrated = useHydrated()
  const [intent, setIntent] = useState<Intent>('edit_goal')
  const [state, propose, proposing] = useActionState(proposeChange, {})
  const intents: Intent[] = owner
    ? [
        'edit_goal',
        'select_reference',
        'schedule',
        'cancel',
        'request_assignment'
      ]
    : ['edit_goal', 'select_reference']
  if (!campaigns.length) return null
  const field =
    'w-full rounded-[var(--radius-control)] border border-[var(--line-strong)] bg-[var(--surface-raised)] px-3 py-2 text-sm text-[var(--text)]'
  return (
    <details className="rounded-[var(--radius-control)] border border-[var(--line)]">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-[var(--brand-secondary)]">
        Propose a change to a campaign
      </summary>
      {/* A refused proposal keeps what was typed (React resets a form after its action). */}
      <form
        action={propose}
        onReset={(event) => event.preventDefault()}
        className="grid gap-3 border-t border-[var(--line)] p-3 sm:grid-cols-2"
      >
        <input type="hidden" name="chat" value={chat} />
        <div className="grid gap-1 text-sm">
          <label htmlFor={`${id}-campaign`}>Campaign</label>
          <select
            id={`${id}-campaign`}
            name="campaign"
            required
            defaultValue=""
            className={field}
          >
            <option value="" disabled>
              Choose a campaign
            </option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1 text-sm">
          <label htmlFor={`${id}-intent`}>Change</label>
          <select
            id={`${id}-intent`}
            name="intent"
            value={intent}
            onChange={(event) => setIntent(event.target.value as Intent)}
            className={field}
          >
            {intents.map((i) => (
              <option key={i} value={i}>
                {intentLabel[i]}
              </option>
            ))}
          </select>
        </div>
        {intent === 'edit_goal' && (
          <div className="grid gap-1 text-sm sm:col-span-2">
            <label htmlFor={`${id}-goal`}>New goal</label>
            <textarea
              id={`${id}-goal`}
              name="value"
              rows={2}
              maxLength={5000}
              required
              className={field}
            />
          </div>
        )}
        {intent === 'select_reference' &&
          (references.length ? (
            <div className="grid gap-1 text-sm sm:col-span-2">
              <label htmlFor={`${id}-reference`}>Reference email</label>
              <select
                id={`${id}-reference`}
                name="value"
                required
                defaultValue=""
                className={field}
              >
                <option value="" disabled>
                  Choose a competitor email you follow
                </option>
                {references.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.subject}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="text-sm text-[var(--text-muted)] sm:col-span-2">
              No competitor emails yet. Track a competitor in Inspiration first.
            </p>
          ))}
        <div className="grid gap-1 text-sm sm:col-span-2">
          <label htmlFor={`${id}-reason`}>Why</label>
          <textarea
            id={`${id}-reason`}
            name="question"
            rows={2}
            maxLength={5000}
            required
            className={field}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            disabled={!hydrated || proposing}
          >
            {proposing ? 'Proposing…' : 'Propose change'}
          </Button>
          <p className="text-xs text-[var(--text-muted)]">
            Nothing changes until you apply it.
          </p>
        </div>
        <div className="sm:col-span-2">
          <Status state={proposing ? {} : state} />
        </div>
      </form>
    </details>
  )
}
