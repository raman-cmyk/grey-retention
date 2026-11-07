'use client'
import { Plus, Search, X } from 'lucide-react'
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState
} from 'react'
import type { FormResult } from '@/components/ui/action-form'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { TextField } from '@/components/ui/text-field'
import { cn } from '@/lib/utils'
import type { TrackedDomain } from '@/features/library/reference-library/data'
import { stopTracking, trackDomain } from './actions'

const statusPill = {
  live: { tone: 'success', label: 'LIVE' },
  pending: { tone: 'warning', label: 'PENDING' },
  error: { tone: 'danger', label: 'ERROR' }
} as const

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
 * "Your competitor domains (n/10)" (spec §9): the domains this workspace
 * follows, with LIVE / PENDING, a Track form and a confirmed Remove. Only
 * the owner changes them; staff see the list.
 */
export function TrackedDomains({
  tracked,
  limit,
  owner
}: {
  tracked: TrackedDomain[]
  limit: number
  owner: boolean
}) {
  const id = useId()
  const [domain, setDomain] = useState('')
  // A tracked domain empties the field; a refused one keeps it.
  const [added, track, tracking] = useActionState(
    async (previous: FormResult, data: FormData) => {
      const result = await trackDomain(previous, data)
      if (result.message) setDomain('')
      return result
    },
    {}
  )
  const [removed, remove, removing] = useActionState(stopTracking, {})
  const [last, setLast] = useState<'track' | 'remove'>('track')
  const [confirm, setConfirm] = useState<TrackedDomain | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const full = tracked.length >= limit
  // After a refusal the cursor goes back to the field, next to the reason.
  useEffect(() => {
    if (added.error) input.current?.focus()
  }, [added])
  const state = last === 'track' ? added : removed
  const anyPending = tracked.some((d) => d.status === 'pending')
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-4 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl space-y-1">
          <h2
            id={`${id}-title`}
            className="flex items-center gap-2 text-base font-semibold"
          >
            <Search className="size-4" aria-hidden="true" />
            Your competitor domains ({tracked.length}/{limit})
          </h2>
          <p className="text-sm text-[var(--text-muted)]">
            Add a brand you want to learn from. We subscribe to their newsletter
            and show their designs once they send us emails — their latest 20
            sends show up below and in the Competitor tab of every design
            picker.
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            This workspace uses sample data: only sample domains that end in
            .example can be tracked, and their emails are sample emails.
          </p>
        </div>
        {owner && (
          <form
            action={(data) => {
              setLast('track')
              startTransition(() => track(data))
            }}
            onReset={(event) => event.preventDefault()}
            className="flex w-full flex-wrap items-start gap-2 sm:w-auto"
          >
            <label htmlFor={`${id}-domain`} className="sr-only">
              Competitor domain
            </label>
            <TextField
              ref={input}
              id={`${id}-domain`}
              name="domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="brand.com"
              autoComplete="off"
              spellCheck={false}
              maxLength={300}
              aria-invalid={last === 'track' && Boolean(added.error)}
              aria-describedby={full ? `${id}-full` : undefined}
              disabled={full}
              className="min-w-0 flex-1 sm:w-56"
            />
            <Button type="submit" disabled={full || tracking || !domain.trim()}>
              <Plus className="size-4" aria-hidden="true" />
              {tracking ? 'Tracking…' : 'Track'}
            </Button>
            {full && (
              <p
                id={`${id}-full`}
                className="w-full text-xs text-[var(--text-muted)]"
              >
                You track {limit} domains, the most at a time. Remove one to add
                another.
              </p>
            )}
          </form>
        )}
      </div>
      {tracked.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)]">
          No domains yet.
          {owner
            ? ' Track one above to start your library.'
            : ' The workspace owner can add them.'}
        </p>
      ) : (
        <ul aria-label="Tracked domains" className="flex flex-wrap gap-2">
          {tracked.map((d) => (
            <li
              key={d.subscriptionId}
              className="flex items-center gap-2 rounded-full border border-[var(--line-strong)] py-1 pr-1 pl-3 text-sm"
            >
              <span className="font-semibold">{d.domain}</span>
              <Pill tone={statusPill[d.status].tone}>
                {statusPill[d.status].label}
              </Pill>
              {owner ? (
                <button
                  type="button"
                  onClick={() => setConfirm(d)}
                  className="grid size-7 place-items-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  <X className="size-4" aria-hidden="true" />
                  <span className="sr-only">Remove {d.domain}</span>
                </button>
              ) : (
                <span className="pr-2" />
              )}
            </li>
          ))}
        </ul>
      )}
      {anyPending && (
        <p className="text-xs text-[var(--text-muted)]">
          PENDING means we are waiting for their first email. With a real
          newsletter this usually takes 1–7 days after their next send.
        </p>
      )}
      <Status state={tracking || removing ? {} : state} />
      <AlertDialog
        open={confirm !== null}
        title={confirm ? `Stop tracking ${confirm.domain}?` : 'Stop tracking?'}
        confirmLabel="Stop tracking"
        pending={removing}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return
          const data = new FormData()
          data.set('subscription', confirm.subscriptionId)
          data.set('revision', String(confirm.revision))
          data.set('domain', confirm.domain)
          setLast('remove')
          startTransition(() => {
            remove(data)
            setConfirm(null)
          })
        }}
      >
        <p>Its emails will disappear from your library.</p>
      </AlertDialog>
    </section>
  )
}
