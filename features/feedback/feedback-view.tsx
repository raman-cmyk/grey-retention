'use client'
import { useActionState, useEffect, useId, useState } from 'react'
import { Lightbulb, Plus, Search } from 'lucide-react'
import type { FormResult } from '@/components/ui/action-form'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Modal } from '@/components/ui/modal'
import { Pill } from '@/components/ui/pill'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { TextField } from '@/components/ui/text-field'
import { controlClass } from '@/components/ui/control'
import { cn } from '@/lib/utils'
import { sendFeatureRequest } from './actions'
import {
  categories,
  categoryLabel,
  matches,
  readyToSend,
  statusLabel,
  type Category,
  type FeatureRequest,
  type RequestStatus
} from './rules'

const labelClass =
  'tracking-label block font-mono text-[0.6875rem] font-semibold text-[var(--text-muted)] uppercase'

const statusTone = {
  open: 'info',
  planned: 'warning',
  done: 'success'
} as const

/**
 * A polite live region that is always rendered (never display:none), so
 * every screen reader announces what appears in it.
 */
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

/** "Nov 6" (and the year when it is not this year), in the brand's timezone. */
function dateText(at: string, timezone: string, now: number) {
  const zone = (date: Date, part: 'year') =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      [part]: 'numeric'
    }).format(date)
  const date = new Date(at)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'short',
    day: 'numeric',
    ...(zone(date, 'year') !== zone(new Date(now), 'year')
      ? { year: 'numeric' }
      : {})
  }).format(date)
}

/** The "Request a Feature" modal: type, subject and details, then Send. */
function RequestModal({
  open,
  onClose,
  onSent
}: {
  open: boolean
  onClose: () => void
  onSent: (message: string) => void
}) {
  const id = useId()
  const [category, setCategory] = useState<Category>('feature')
  const [subject, setSubject] = useState('')
  const [details, setDetails] = useState('')
  const [state, dispatch, pending] = useActionState(
    async (previous: FormResult, data: FormData) => {
      const result = await sendFeatureRequest(previous, data)
      if (result.message) onSent(result.message)
      return result
    },
    {}
  )
  const ready = readyToSend(subject, details)
  return (
    <Modal
      open={open}
      size="sm"
      title="Request a Feature"
      subtitle="Tell us what you’d love to see, what’s broken, or what would make your day."
      dirty={subject.trim() !== '' || details.trim() !== ''}
      onClose={onClose}
      footer={
        <Button
          type="submit"
          form={`${id}-form`}
          disabled={!ready || pending}
          aria-describedby={ready ? undefined : `${id}-why`}
        >
          {pending ? 'Sending…' : 'Send'}
        </Button>
      }
    >
      <form
        id={`${id}-form`}
        action={dispatch}
        noValidate
        onReset={(event) => event.preventDefault()}
        className="space-y-5"
      >
        <fieldset className="space-y-2">
          <legend className={labelClass}>Type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {categories.map((c) => (
              <label
                key={c.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border p-3 text-sm',
                  category === c.value
                    ? 'border-[var(--brand-secondary)] bg-[var(--brand-soft)]'
                    : 'border-[var(--line)]'
                )}
              >
                <input
                  type="radio"
                  name="category"
                  value={c.value}
                  checked={category === c.value}
                  onChange={() => setCategory(c.value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-semibold">{c.label}</span>
                  <span className="block text-[var(--text-muted)]">
                    {c.help}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-2">
          <label htmlFor={`${id}-subject`} className={labelClass}>
            Subject
          </label>
          <TextField
            id={`${id}-subject`}
            name="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="e.g. Add a ‘duplicate campaign’ button"
            maxLength={200}
            required
          />
        </div>
        <div className="space-y-2">
          <label htmlFor={`${id}-details`} className={labelClass}>
            Details
          </label>
          <textarea
            id={`${id}-details`}
            name="details"
            rows={5}
            maxLength={5000}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            placeholder="What were you trying to do, and what would help? The more context, the better."
            className={controlClass}
            required
          />
        </div>
        {!ready && (
          <p id={`${id}-why`} className="text-sm text-[var(--text-muted)]">
            Fill in the subject and details to send.
          </p>
        )}
        <Status state={pending ? {} : state.error ? state : {}} />
      </form>
    </Modal>
  )
}

function RequestItem({
  request,
  timezone,
  now
}: {
  request: FeatureRequest
  timezone: string
  now: number
}) {
  return (
    <li className="space-y-3 border-b border-[var(--line)] py-5 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 font-semibold break-words">{request.subject}</h3>
        <div className="flex flex-wrap gap-2">
          {request.category && (
            <Pill tone="neutral">{categoryLabel[request.category]}</Pill>
          )}
          <Pill tone={statusTone[request.status]}>
            {statusLabel[request.status]}
          </Pill>
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {request.by} · {dateText(request.createdAt, timezone, now)}
      </p>
      <p className="text-sm break-words whitespace-pre-wrap">
        {request.details}
      </p>
      {request.replies.length > 0 && (
        <ul
          aria-label={`Replies to ${request.subject}`}
          className="space-y-3 border-l-2 border-[var(--line)] pl-4"
        >
          {request.replies.map((reply) => (
            <li key={reply.id} className="space-y-1">
              <p className="text-xs text-[var(--text-muted)]">
                <span
                  className={cn(
                    'font-semibold',
                    reply.fromTeam && 'text-[var(--brand-ink)]'
                  )}
                >
                  {reply.author}
                </span>{' '}
                · {dateText(reply.createdAt, timezone, now)}
              </p>
              <p className="text-sm break-words whitespace-pre-wrap">
                {reply.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

type Filter = 'all' | RequestStatus

/** The Feature Requests page: button, search, status filters and the list. */
export function FeedbackBoard({
  requests,
  timezone,
  now
}: {
  requests: FeatureRequest[]
  timezone: string
  now: number
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  // A fresh, empty modal each time it opens.
  const [round, setRound] = useState(0)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [notice, setNotice] = useState<FormResult>({})
  const [focusList, setFocusList] = useState(0)
  useEffect(() => {
    if (focusList > 0) document.getElementById(`${id}-list`)?.focus()
  }, [focusList, id])
  const count = (status: RequestStatus) =>
    requests.filter((r) => r.status === status).length
  const options = [
    { value: 'all', label: `All ${requests.length}` },
    { value: 'open', label: `Open ${count('open')}` },
    { value: 'planned', label: `Planned ${count('planned')}` },
    { value: 'done', label: `Done ${count('done')}` }
  ] as const
  const shown = requests.filter(
    (r) => (filter === 'all' || r.status === filter) && matches(r, query)
  )
  const start = () => {
    setNotice({})
    setRound((n) => n + 1)
    setOpen(true)
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={start}>
          <Plus className="size-4" aria-hidden="true" />
          New request
        </Button>
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor={`${id}-search`} className="sr-only">
            Search your requests
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <TextField
            id={`${id}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search your requests…"
            className="pl-9"
          />
        </div>
      </div>
      <SegmentedControl
        name={`${id}-filter`}
        legend="Show"
        hideLegend
        options={options}
        value={filter}
        onValueChange={(value) => setFilter(value)}
      />
      <Status state={notice} />
      <section
        id={`${id}-list`}
        tabIndex={-1}
        aria-label="Your requests"
        className="rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] px-6 outline-none"
      >
        {requests.length === 0 ? (
          <div className="py-6">
            <Lightbulb
              className="mb-3 size-6 text-[var(--brand-ink)]"
              aria-hidden="true"
            />
            <EmptyState
              title="Nothing here yet"
              description="Ask for what would make your day — we read every request."
              action={
                <Button type="button" variant="secondary" onClick={start}>
                  New request
                </Button>
              }
            />
          </div>
        ) : shown.length === 0 ? (
          <p className="py-6 text-sm text-[var(--text-muted)]">
            No requests match.{' '}
            <button
              type="button"
              className="underline"
              onClick={() => {
                setQuery('')
                setFilter('all')
              }}
            >
              Show all
            </button>
          </p>
        ) : (
          <ul>
            {shown.map((request) => (
              <RequestItem
                key={request.id}
                request={request}
                timezone={timezone}
                now={now}
              />
            ))}
          </ul>
        )}
      </section>
      <RequestModal
        key={round}
        open={open}
        onClose={() => setOpen(false)}
        onSent={(message) => {
          setOpen(false)
          setNotice({ message })
          setFilter('all')
          setQuery('')
          setFocusList((n) => n + 1)
        }}
      />
    </div>
  )
}
