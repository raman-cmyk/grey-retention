import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { TextField } from '@/components/ui/text-field'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { grosAction } from './actions'
import { conversationReferenceChoices } from './reference-choices'
import { z } from 'zod'
export async function GrosPanel({
  chatId,
  before
}: {
  chatId?: string
  before?: number
}) {
  const ctx = await requireRequestContext('client'),
    db = await createClient()
  if (!db) return <Notice error>Supabase authentication required.</Notice>
  const [chats, campaigns, selected, references] = await Promise.all([
    db
      .from('conversations')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('campaigns')
      .select('id,title')
      .eq('tenant_id', ctx.tenantId)
      .is('superseded_by_plan', null)
      .order('planned_at')
      .limit(100),
    chatId
      ? db
          .from('conversations')
          .select('*')
          .eq('tenant_id', ctx.tenantId)
          .eq('id', chatId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    conversationReferenceChoices(db, ctx.tenantId)
  ])
  if (chats.error || campaigns.error || selected.error || references.error)
    return <Notice error>Conversation data unavailable.</Notice>
  const active = selected.data
  const [messages, proposals] = active
    ? await Promise.all([
        db
          .from('chat_messages')
          .select('*')
          .eq('tenant_id', ctx.tenantId)
          .eq('conversation_id', active.id)
          .lt('message_index', before ?? Number.MAX_SAFE_INTEGER)
          .order('message_index', { ascending: false })
          .limit(100),
        db
          .from('chat_proposals')
          .select('*')
          .eq('tenant_id', ctx.tenantId)
          .eq('conversation_id', active.id)
          .order('created_at', { ascending: false })
          .limit(30)
      ])
    : [
        { data: [], error: null },
        { data: [], error: null }
      ]
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="space-y-6">
        <Panel title="Visible conversations">
          <nav aria-label="Conversations">
            <ul className="space-y-2 text-sm">
              {chats.data?.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/gros?chat=${c.id}`}
                    aria-current={active?.id === c.id ? 'page' : undefined}
                    className={`block rounded-lg border px-3 py-3 ${
                      active?.id === c.id
                        ? 'border-[var(--line-strong)] bg-[var(--surface-hover)]'
                        : 'border-transparent hover:bg-[var(--surface-hover)]'
                    }`}
                  >
                    <span className="block font-semibold break-words">
                      {c.title}
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-[var(--text-muted)]">
                      {c.visibility === 'private' ? 'Private' : 'Shared'} ·{' '}
                      {c.creator_id === ctx.userId
                        ? 'Created by you'
                        : 'Workspace conversation'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          {!chats.data?.length && (
            <p className="text-sm leading-6 text-[var(--text-muted)]">
              No conversations yet. Start one below to keep your campaign
              questions and decisions together.
            </p>
          )}
          {chatId && !active && (
            <Notice error>
              Conversation unavailable to your active membership.
            </Notice>
          )}
        </Panel>
        <Panel title="New conversation">
          <ActionForm action={grosAction} className="grid gap-3">
            <input name="kind" type="hidden" value="create" />
            <Field label="Conversation title">
              <TextField name="title" required maxLength={200} />
            </Field>
            <Field label="Conversation visibility">
              <select
                name="visibility"
                className={controlClass}
                defaultValue="private"
              >
                <option value="private">Private · creator only</option>
                <option value="shared">
                  Shared · active workspace members
                </option>
              </select>
            </Field>
            <SubmitButton>Create conversation</SubmitButton>
          </ActionForm>
        </Panel>
      </div>
      <div className="space-y-6">
        {active ? (
          <>
            <Panel title={`${active.title} · ${active.visibility}`}>
              <Notice>
                Original synthetic GROS answers use authorized persisted
                evidence. Shared visibility does not permit another member to
                execute your proposal. Proposals expire after 15 minutes;
                material changes require a new proposal.
              </Notice>
              {active.creator_id === ctx.userId && (
                <div className="mt-4">
                  <ConfirmDialog
                    label="Review conversation visibility"
                    title="Confirm conversation visibility"
                    description="Sharing exposes the complete conversation to active permitted workspace members. Creator-private conversations are excluded from admin diagnostics."
                  >
                    <ActionForm action={grosAction}>
                      <input name="kind" type="hidden" value="visibility" />
                      <input name="chat" type="hidden" value={active.id} />
                      <Field label="New visibility">
                        <select
                          name="visibility"
                          className={controlClass}
                          defaultValue={active.visibility}
                        >
                          <option value="private">Private</option>
                          <option value="shared">Shared</option>
                        </select>
                      </Field>
                      <SubmitButton>Confirm visibility</SubmitButton>
                    </ActionForm>
                  </ConfirmDialog>
                </div>
              )}
              {messages.data?.length ? (
                <ol
                  aria-label="Conversation messages"
                  className="my-6 space-y-5"
                >
                  {messages.data?.toReversed().map((m) => (
                    <li
                      key={m.id}
                      className={`max-w-[94%] rounded-xl p-4 sm:max-w-[88%] ${
                        m.role === 'assistant'
                          ? 'border border-[var(--line)] bg-[var(--surface-raised)]'
                          : 'ml-auto bg-[var(--surface-hover)]'
                      }`}
                    >
                      <p
                        className={`mb-2 text-xs font-semibold ${m.role === 'assistant' ? 'text-[var(--brand-ink)]' : 'text-[var(--text-muted)]'}`}
                      >
                        {m.role === 'assistant'
                          ? 'Synthetic GROS'
                          : m.actor_id === ctx.userId
                            ? 'You'
                            : 'Workspace member'}
                      </p>
                      <p className="text-sm leading-6 break-words whitespace-pre-wrap">
                        {m.body}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="my-6 rounded-xl border border-dashed border-[var(--line-strong)] bg-[var(--surface-hover)] px-5 py-7">
                  <h3 className="text-sm font-semibold">
                    {before
                      ? 'No earlier messages'
                      : 'Your conversation starts here'}
                  </h3>
                  <p className="mt-2 max-w-[54ch] text-sm leading-6 text-[var(--text-muted)]">
                    {before
                      ? 'You have reached the beginning of this conversation. Return to the latest messages to continue.'
                      : 'Choose a campaign and ask about its progress, or propose a change for review. Proposed changes need your confirmation.'}
                  </p>
                </div>
              )}
              {(!!messages.data?.length || before) && (
                <p className="my-3 text-xs text-[var(--text-faint)]">
                  Messages are paged in groups of 100.{' '}
                  {messages.data?.at(-1)?.message_index &&
                    messages.data.at(-1)!.message_index > 1 && (
                      <Link
                        className="mr-3 underline"
                        href={`/gros?chat=${active.id}&before=${messages.data.at(-1)!.message_index}`}
                      >
                        Earlier messages
                      </Link>
                    )}
                  {before && (
                    <Link
                      className="underline"
                      href={`/gros?chat=${active.id}`}
                    >
                      Latest messages
                    </Link>
                  )}
                </p>
              )}
              <ActionForm
                action={grosAction}
                className="grid gap-4 border-t border-[var(--line)] pt-5"
              >
                <input name="kind" type="hidden" value="ask" />
                <input name="chat" type="hidden" value={active.id} />
                <Field label="Campaign context">
                  <select name="campaign" className={controlClass} required>
                    <option value="">Choose an authorized campaign</option>
                    {campaigns.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Question or reason">
                  <textarea
                    name="question"
                    className={controlClass}
                    rows={3}
                    required
                    maxLength={5000}
                  />
                </Field>
                <Field label="GROS request">
                  <select name="intent" className={controlClass}>
                    <option value="explain">Explain why and show status</option>
                    <option value="edit_goal">Propose a goal edit</option>
                    {ctx.tenantRole === 'owner' && (
                      <>
                        <option value="schedule">
                          Propose exact package scheduling
                        </option>
                        <option value="cancel">Propose cancellation</option>
                        <option value="request_assignment">
                          Request platform assignment
                        </option>
                      </>
                    )}
                  </select>
                </Field>
                <Field label="Proposed goal">
                  <textarea
                    name="value"
                    className={controlClass}
                    rows={2}
                    maxLength={5000}
                    placeholder="Enter the new goal when proposing a goal edit."
                  />
                </Field>
                <SubmitButton>Ask fixture GROS</SubmitButton>
              </ActionForm>
              <details className="mt-6 border-t border-[var(--line)] pt-4">
                <summary className="text-sm font-medium text-[var(--brand-secondary)]">
                  Propose a campaign reference
                </summary>
                {references.data?.length ? (
                  <ActionForm action={grosAction} className="mt-4 grid gap-4">
                    <input name="kind" type="hidden" value="ask" />
                    <input name="chat" type="hidden" value={active.id} />
                    <input
                      name="intent"
                      type="hidden"
                      value="select_reference"
                    />
                    <Field label="Campaign for this reference">
                      <select name="campaign" className={controlClass} required>
                        <option value="">Choose an authorized campaign</option>
                        {campaigns.data?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Authorized campaign reference">
                      <select
                        name="value"
                        className={controlClass}
                        required
                        defaultValue=""
                      >
                        <option value="">Choose a subscribed reference</option>
                        {references.data.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.subject}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Reference request reason">
                      <textarea
                        name="question"
                        className={controlClass}
                        rows={2}
                        required
                        maxLength={5000}
                      />
                    </Field>
                    <p className="text-xs leading-5 text-[var(--text-muted)]">
                      Available references come from your active subscriptions.
                      Review the proposal before applying it to the campaign.
                      {references.data.length === 20 &&
                        ' Showing the 20 most recent references.'}
                    </p>
                    <div>
                      <SubmitButton variant="secondary">
                        Propose reference
                      </SubmitButton>
                    </div>
                  </ActionForm>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
                    No subscribed references are available. Add a subscription
                    in{' '}
                    <Link
                      href="/competitor-agent"
                      className="text-[var(--brand-secondary)] underline"
                    >
                      Competitor Agent
                    </Link>{' '}
                    to select a reference here.
                  </p>
                )}
              </details>
            </Panel>
            <Panel title="Exact proposals">
              {proposals.data?.length ? (
                proposals.data.map((p) => (
                  <div
                    className="mb-5 rounded-lg border border-[var(--line)] p-4 text-sm"
                    key={p.id}
                  >
                    <h3 className="font-semibold">
                      {p.kind} · {p.status}
                    </h3>
                    <p className="my-3">{p.consequence}</p>
                    <details className="my-3">
                      <summary className="text-xs font-medium text-[var(--brand-secondary)]">
                        Inspect exact payload
                      </summary>
                      <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--surface-hover)] p-3 text-xs break-words whitespace-pre-wrap">
                        {JSON.stringify(p.payload, null, 2)}
                      </pre>
                    </details>
                    <p className="my-3">
                      Expires{' '}
                      {new Intl.DateTimeFormat('en', {
                        timeZone: ctx.timezone,
                        dateStyle: 'short',
                        timeStyle: 'short'
                      }).format(new Date(p.expires_at))}
                    </p>
                    {p.status === 'pending' && p.actor_id === ctx.userId && (
                      <ConfirmDialog
                        label="Review proposal confirmation"
                        title="Confirm this exact proposal"
                        description="Recheck your authority, payload and all current campaign revisions. Scheduling is still a durable intent; it is not a provider confirmation."
                      >
                        <ActionForm action={grosAction}>
                          <input name="kind" type="hidden" value="decide" />
                          <input name="proposal" type="hidden" value={p.id} />
                          <input
                            name="hash"
                            type="hidden"
                            value={p.payload_hash ?? ''}
                          />
                          <Field label="Proposal decision">
                            <select name="decision" className={controlClass}>
                              <option value="confirmed">Confirm</option>
                              <option value="rejected">Reject</option>
                            </select>
                          </Field>
                          <SubmitButton>Confirm proposal decision</SubmitButton>
                        </ActionForm>
                      </ConfirmDialog>
                    )}
                  </div>
                ))
              ) : (
                <Notice>
                  No action proposals yet. Questions can be answered without
                  proposing a mutation.
                </Notice>
              )}
            </Panel>
          </>
        ) : (
          <Panel
            title={
              chats.data?.length
                ? 'Choose a conversation'
                : 'Start your first conversation'
            }
          >
            <p className="max-w-[54ch] text-sm leading-6 text-[var(--text-muted)]">
              Keep campaign questions, proposed changes and decisions in one
              place. Select a conversation or create one to get started.
            </p>
            <p className="mt-4 text-xs leading-5 text-[var(--text-faint)]">
              Conversations are private by default. GROS uses synthetic answers
              with persisted evidence; proposed changes always need
              confirmation.
            </p>
          </Panel>
        )}
        {[messages, proposals].some((r) => r.error) && (
          <Notice error>Some conversation records are unavailable.</Notice>
        )}
      </div>
    </div>
  )
}
export function validChatId(value: unknown) {
  return z.uuid().safeParse(value).success ? (value as string) : undefined
}

export function validMessageCursor(value: unknown) {
  const parsed = z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .safeParse(value)
  return parsed.success ? parsed.data : undefined
}
