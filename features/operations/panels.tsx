import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { TextField } from '@/components/ui/text-field'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable } from '@/components/ui/data-table'
import { operationAction } from './actions'
import { z } from 'zod'
import { rewriteAvailability } from '@/features/email-generation/config'
import { connectionsEmptyText, rewriteStatus } from './provider-status'
import { modelsInUseNow, retirementWatch } from '@/features/ai/retirement-watch'
import { liveSwitches } from './live-switches'

/**
 * Owner pick #83: the models the app would call now, and when their
 * providers shut them down (whole UTC days). Its own panel: it needs no
 * database, so it shows even when the diagnostics cannot be read.
 */
export async function RetirementWatchPanel() {
  await requireRequestContext('admin')
  const lines = retirementWatch(
    modelsInUseNow(),
    new Date().toISOString().slice(0, 10)
  )
  return (
    <Panel title="Model retirement watch">
      {lines.length ? (
        <ul className="space-y-2 text-sm">
          {lines.map((l) => (
            <li key={l.name} className="flex flex-wrap gap-x-2">
              <span className="font-medium">{l.name}</span>
              <span
                className={
                  l.state === 'ok'
                    ? 'text-[var(--text)]'
                    : 'font-medium text-[var(--danger-ink)]'
                }
              >
                · {l.detail}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          No AI model is in use: GROS’s agents run on the fake, and the older
          email rewriting is off.
        </p>
      )}
    </Panel>
  )
}
/**
 * OPS-LIVE: which live switches the live app has on (its Vercel settings),
 * in plain words; never a value. Needs no database.
 */
export async function LiveSwitchesPanel() {
  await requireRequestContext('admin')
  return (
    <Panel title="Go-live switches">
      <ul className="space-y-2 text-sm">
        {liveSwitches().map((s) => (
          <li key={s.label} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{s.label}</span>
            <span
              className={
                s.state === 'on'
                  ? 'text-[var(--text)]'
                  : s.state === 'attention'
                    ? 'font-medium text-[var(--danger-ink)]'
                    : 'text-[var(--text-muted)]'
              }
            >
              · {s.detail}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
const money = (value: number) =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4
  }).format(value / 1000000)
export async function SupportPanel({ admin = false }: { admin?: boolean }) {
  const ctx = await requireRequestContext(admin ? 'admin' : 'client'),
    db = await createClient()
  if (!db) return null
  let q = db
    .from('support_tickets')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(30)
  if (ctx.kind === 'client') q = q.eq('tenant_id', ctx.tenantId)
  const tickets = await q
  const messages = tickets.data?.length
    ? await db
        .from('support_messages')
        .select('*')
        .in(
          'ticket_id',
          tickets.data.map((t) => t.id)
        )
        .order('created_at')
    : { data: [], error: null }
  return (
    <div className="space-y-6">
      {!admin && (
        <Panel title="Open support or share feedback">
          <ActionForm action={operationAction} className="grid gap-3">
            <input name="kind" type="hidden" value="open_ticket" />
            <Field label="Request type">
              <select name="ticketKind" className={controlClass}>
                <option value="support">Support</option>
                <option value="feedback">Feedback</option>
              </select>
            </Field>
            <Field label="Ticket subject">
              <TextField name="subject" required maxLength={200} />
            </Field>
            <Field label="Support message">
              <textarea
                name="body"
                className={controlClass}
                rows={4}
                required
                maxLength={5000}
              />
            </Field>
            <SubmitButton>Save support request</SubmitButton>
          </ActionForm>
        </Panel>
      )}
      <Panel title={admin ? 'Tenant support queue' : 'Support threads'}>
        {tickets.error || messages.error ? (
          <Notice error>Support data unavailable.</Notice>
        ) : tickets.data?.length ? (
          tickets.data.map((t) => (
            <article
              className="mb-5 rounded-lg border border-[var(--line)] p-4"
              key={t.id}
            >
              <h3 className="font-semibold">
                {t.subject} · {t.kind} · {t.state}
              </h3>
              <ul className="my-4 space-y-3 text-sm">
                {messages.data
                  ?.filter((m) => m.ticket_id === t.id)
                  .map((m) => (
                    <li className="break-words whitespace-pre-wrap" key={m.id}>
                      {m.body}
                    </li>
                  ))}
              </ul>
              <ActionForm action={operationAction} className="grid gap-3">
                <input
                  name="surface"
                  type="hidden"
                  value={admin ? 'admin' : 'client'}
                />
                <input name="kind" type="hidden" value="reply_ticket" />
                <input name="tenant" type="hidden" value={t.tenant_id} />
                <input name="id" type="hidden" value={t.id} />
                <input name="revision" type="hidden" value={t.revision} />
                <Field label="Thread reply">
                  <textarea
                    name="body"
                    className={controlClass}
                    rows={2}
                    required
                    maxLength={5000}
                  />
                </Field>
                <Field label="Ticket state">
                  <select
                    name="state"
                    className={controlClass}
                    defaultValue={t.state}
                  >
                    <option>open</option>
                    <option>in_progress</option>
                    <option>closed</option>
                  </select>
                </Field>
                <SubmitButton variant="secondary">
                  Save thread reply
                </SubmitButton>
              </ActionForm>
            </article>
          ))
        ) : (
          <Notice>No support threads yet.</Notice>
        )}
      </Panel>
    </div>
  )
}
const diagnostics = z.object({
  tenants: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      status: z.string(),
      timezone: z.string(),
      package: z.string().nullable(),
      usedMicro: z.number().nullable(),
      reservedMicro: z.number().nullable(),
      allocationMicro: z.number().nullable()
    })
  ),
  jobs: z.array(
    z.object({
      id: z.uuid(),
      tenant_id: z.uuid(),
      kind: z.string(),
      status: z.string(),
      attempt: z.number(),
      error_code: z.string().nullable()
    })
  ),
  connections: z.array(
    z.object({
      tenant_id: z.uuid(),
      provider: z.string(),
      status: z.string(),
      last_sync_at: z.string().nullable()
    })
  ),
  assignmentRequests: z.array(
    z.object({
      id: z.uuid(),
      tenant_id: z.uuid(),
      campaign_id: z.uuid(),
      state: z.string()
    })
  ),
  chats: z.object({ count: z.number(), privateCount: z.number() })
})
export async function OperatorPanel() {
  const ctx = await requireRequestContext('admin'),
    db = await createClient()
  if (!db) return null
  const [r, p] = await Promise.all([
      db.rpc('operator_diagnostics'),
      db.from('packages').select('*').eq('active', true)
    ]),
    data = diagnostics.safeParse(r.data)
  if (r.error || !data.success || p.error)
    return <Notice error>Sanitized diagnostics unavailable.</Notice>
  return (
    <div className="space-y-6">
      <Panel title="Scoped workspace operations">
        <Notice>
          Sanitized diagnostics contain states and identifiers. Private chats,
          job inputs, provider payloads and secrets are excluded.{' '}
          {data.data.chats.count} conversations ({data.data.chats.privateCount}{' '}
          private) are represented only by counts.
        </Notice>
        <div className="mt-4 space-y-4">
          {data.data.tenants.map((t) => (
            <div
              key={t.id}
              className="rounded-lg border border-[var(--line)] p-4"
            >
              <p className="font-semibold">
                {t.name} · {t.status} · {t.timezone}
              </p>
              <p className="my-3 text-sm">
                {t.package ?? 'No cycle initialized'} ·{' '}
                {money(t.usedMicro ?? 0)} used / {money(t.allocationMicro ?? 0)}{' '}
                synthetic allowance.
              </p>
              {ctx.adminRole === 'super_admin' && (
                <ConfirmDialog
                  label={`Review package for ${t.name}`}
                  title="Confirm fixture package assignment"
                  description="Create an immutable cycle snapshot. Outstanding reservations must be resolved first. No payment is collected."
                >
                  <ActionForm action={operationAction}>
                    <input name="surface" type="hidden" value="admin" />
                    <input name="kind" type="hidden" value="assign_package" />
                    <input name="tenant" type="hidden" value={t.id} />
                    <Field label="Fixture package">
                      <select name="package" className={controlClass}>
                        {p.data?.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · revision {p.revision}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <SubmitButton>Assign fixture package</SubmitButton>
                  </ActionForm>
                </ConfirmDialog>
              )}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Job diagnostics">
        <DataTable
          caption="Sanitized durable jobs"
          headers={['Tenant', 'Operation', 'State', 'Attempts', 'Code']}
        >
          {data.data.jobs.map((j) => (
            <tr key={j.id}>
              <td className="p-3">
                {data.data.tenants.find((t) => t.id === j.tenant_id)?.name}
              </td>
              <td className="p-3">{j.kind}</td>
              <td className="p-3">{j.status}</td>
              <td className="p-3">{j.attempt}/4</td>
              <td className="p-3">{j.error_code ?? '—'}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>
      <Panel title="Provider health">
        <ul className="space-y-3 text-sm">
          {data.data.tenants.map((t) => {
            const s = rewriteStatus(
              rewriteAvailability(t.id),
              data.data.jobs.filter((j) => j.tenant_id === t.id)
            )
            return (
              <li key={`ai-${t.id}`} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{t.name}</span>
                <span>· {s.label} ·</span>
                <span
                  className={
                    s.state === 'ok'
                      ? 'text-[var(--text)]'
                      : s.state === 'attention'
                        ? 'font-medium text-[var(--danger-ink)]'
                        : 'text-[var(--text-muted)]'
                  }
                >
                  {s.detail}
                </span>
              </li>
            )
          })}
        </ul>
        {data.data.connections.length === 0 && (
          <p className="mt-4 text-sm text-[var(--text-muted)]">
            {connectionsEmptyText}
          </p>
        )}
        <ul className="mt-4 space-y-3 text-sm">
          {data.data.connections.map((c) => (
            <li key={c.tenant_id + c.provider}>
              {data.data.tenants.find((t) => t.id === c.tenant_id)?.name} ·{' '}
              {c.provider} · {c.status} · last fixture sync{' '}
              {c.last_sync_at ?? 'never'}
            </li>
          ))}
        </ul>
        <ul className="mt-5 space-y-2 text-sm">
          {data.data.assignmentRequests.map((a) => (
            <li key={a.id}>
              Pending assignment · campaign {a.campaign_id} ·{' '}
              {data.data.tenants.find((t) => t.id === a.tenant_id)?.name}. Use
              the designer assignment workspace.
            </li>
          ))}
        </ul>
      </Panel>
      {ctx.adminRole === 'super_admin' && (
        <Panel title="Fixture package definitions">
          <ActionForm
            action={operationAction}
            className="grid gap-3 sm:grid-cols-3"
          >
            <input name="surface" type="hidden" value="admin" />
            <input name="kind" type="hidden" value="define_package" />
            <Field label="Package name">
              <TextField name="name" required />
            </Field>
            <Field label="Cycle allowance (micro USD)">
              <TextField
                name="allocation"
                type="number"
                min={1000}
                defaultValue={20000000}
                required
              />
            </Field>
            <Field label="Daily allowance (micro USD)">
              <TextField
                name="daily"
                type="number"
                min={1000}
                defaultValue={2000000}
                required
              />
            </Field>
            <SubmitButton>Save fixture package revision</SubmitButton>
          </ActionForm>
        </Panel>
      )}
      <SupportPanel admin />
    </div>
  )
}
