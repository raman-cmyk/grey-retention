import type { ReactNode } from 'react'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { Card } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import type { FeatureRequest, RequestStatus } from '@/features/feedback/rules'
import { operationAction } from '@/features/operations/actions'
import { formatBrandDateTime } from '@/lib/brand-time'
import type { SettingsView } from './page-model'

/**
 * Support on Settings (UI-SETd): ask the team a question and follow its
 * threads, newest first, with each message's author and time in the
 * brand's timezone and a reply under each. Any member may ask and reply;
 * the support commands check membership again. The heading is the
 * `#support` the old menu opens. BRAND.md has no multi-line field: the
 * message is a plain one on the GROS tokens until design gives it a look.
 */
export function SupportCard({
  view,
  unread
}: {
  view: SettingsView
  /** What the card says when the threads could not be read (or the demo). */
  unread: ReactNode
}) {
  const title = 'Support'
  const support = view.support
  const zone = view.timezone?.saved ?? 'UTC'
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <ActionAnswers>
          <h2 id="support" className="type-heading">
            {title}
          </h2>
          {!support ? (
            unread
          ) : (
            <>
              {support.threads.length === 0 ? (
                <p className="type-body text-[var(--stone)]">
                  No questions yet.
                </p>
              ) : (
                <ul
                  aria-label="Your questions"
                  className="flex flex-col gap-[var(--space-3)]"
                >
                  {support.threads.map((thread) => (
                    <li
                      key={thread.id}
                      className="gros-tile flex flex-col gap-[var(--space-3)] rounded-[var(--radius-md)] bg-[var(--mist)]"
                    >
                      <div className="flex flex-col gap-[var(--space-1)]">
                        <h3 className="type-body-strong break-words">
                          {thread.subject}
                        </h3>
                        <p className="type-caption text-[var(--stone)]">
                          {stateWord[thread.status]}
                        </p>
                      </div>
                      <Messages thread={thread} zone={zone} />
                      <ActionButton
                        action={operationAction}
                        label="Send reply"
                        spokenLabel={thread.subject}
                        kind="outline"
                        size="row"
                        fields={{
                          surface: 'client',
                          kind: 'reply_ticket',
                          id: thread.id,
                          tenant: support.tenantId,
                          revision: String(thread.revision),
                          // A reply reopens a closed thread, else keeps it.
                          state:
                            thread.status === 'done'
                              ? 'open'
                              : stateOf[thread.status]
                        }}
                      >
                        <TextBox
                          label="Your reply"
                          name="body"
                          rows={2}
                          onTile
                        />
                      </ActionButton>
                    </li>
                  ))}
                </ul>
              )}
              <ActionButton
                action={operationAction}
                label="Send to support"
                fields={{
                  surface: 'client',
                  kind: 'open_ticket',
                  ticketKind: 'support'
                }}
              >
                <Field
                  label="Subject"
                  name="subject"
                  autoComplete="off"
                  maxLength={200}
                  required
                />
                <TextBox label="Your question" name="body" rows={4} />
              </ActionButton>
            </>
          )}
        </ActionAnswers>
      </div>
    </Card>
  )
}

/** The support team's state of a thread, in the owner's words. */
const stateWord: Record<RequestStatus, string> = {
  open: 'Open',
  planned: 'Being looked at',
  done: 'Closed'
}
const stateOf: Record<RequestStatus, string> = {
  open: 'open',
  planned: 'in_progress',
  done: 'closed'
}

/**
 * A ticket's messages, oldest first: the question, then the replies, each
 * with its author and time in the brand's timezone (also Feature requests).
 */
export function Messages({
  thread,
  zone
}: {
  thread: FeatureRequest
  zone: string
}) {
  return (
    <ol className="flex flex-col gap-[var(--space-3)]">
      {[
        {
          id: `${thread.id}-question`,
          author: thread.by,
          body: thread.details,
          createdAt: thread.createdAt
        },
        ...thread.replies
      ].map((message) => (
        <li key={message.id} className="flex flex-col gap-[var(--space-1)]">
          <p className="type-caption text-[var(--stone)]">
            {[message.author, formatBrandDateTime(message.createdAt, zone)]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="type-body break-words whitespace-pre-wrap">
            {message.body}
          </p>
        </li>
      ))}
    </ol>
  )
}

/**
 * A multi-line field with a real label, on the GROS tokens: mist on the
 * white card, white on a mist tile.
 */
export function TextBox({
  label,
  name,
  rows,
  onTile = false
}: {
  label: string
  name: string
  rows: number
  onTile?: boolean
}) {
  return (
    <label className="flex flex-col gap-[var(--space-2)]">
      <span className="gros-field-label text-[var(--ink)]">{label}</span>
      <textarea
        name={name}
        rows={rows}
        maxLength={5000}
        required
        className={`type-body w-full rounded-[var(--radius-md)] border-2 border-transparent px-[var(--space-4)] py-[var(--space-3)] text-[var(--ink)] focus:border-[var(--forest)] focus:bg-[var(--white)] focus:outline-none ${onTile ? 'bg-[var(--white)]' : 'bg-[var(--mist)]'}`}
      />
    </label>
  )
}
