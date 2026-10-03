import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { TextField } from '@/components/ui/text-field'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { grosAction } from './actions'
import { z } from 'zod'
export async function GrosPanel({ chatId }: { chatId?: string }) {
  const ctx = await requireRequestContext('client'),
    db = await createClient()
  if (!db) return <Notice error>Supabase authentication required.</Notice>
  const [chats, campaigns] = await Promise.all([
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
      .limit(100)
  ])
  if (chats.error || campaigns.error)
    return <Notice error>Conversation data unavailable.</Notice>
  const active = chats.data?.find((c) => c.id === chatId)
  const [messages, proposals] = active
    ? await Promise.all([
        db
          .from('chat_messages')
          .select('*')
          .eq('tenant_id', ctx.tenantId)
          .eq('conversation_id', active.id)
          .order('created_at')
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
          <ul className="space-y-3 text-sm">
            {chats.data?.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/gros?chat=${c.id}`}
                  className="font-semibold break-words underline"
                >
                  {c.title}
                </Link>
                <p>
                  {c.visibility} ·{' '}
                  {c.creator_id === ctx.userId
                    ? 'you created this'
                    : 'workspace shared'}
                </p>
              </li>
            ))}
          </ul>
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
              <ol className="my-5 space-y-4">
                {messages.data?.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-lg border border-[var(--line)] p-4"
                  >
                    <p className="mb-2 text-xs font-semibold uppercase">
                      {m.role === 'assistant'
                        ? 'Synthetic GROS'
                        : m.actor_id === ctx.userId
                          ? 'You'
                          : 'Workspace member'}
                    </p>
                    <p className="text-sm break-words whitespace-pre-wrap">
                      {m.body}
                    </p>
                  </li>
                ))}
              </ol>
              <ActionForm action={grosAction} className="grid gap-4">
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
                    <option value="select_reference">
                      Propose a subscribed reference UUID
                    </option>
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
                <Field label="Proposed goal or reference UUID">
                  <textarea
                    name="value"
                    className={controlClass}
                    rows={2}
                    maxLength={5000}
                  />
                </Field>
                <SubmitButton>Ask fixture GROS</SubmitButton>
              </ActionForm>
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
                    <pre className="overflow-x-auto rounded-lg bg-[var(--surface-hover)] p-3 text-xs whitespace-pre-wrap">
                      {JSON.stringify(p.payload, null, 2)}
                    </pre>
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
          <Notice>
            Select or create a conversation. Private visibility is the default.
          </Notice>
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
