import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { Panel } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ActionAnswers, ActionButton } from '@/components/gros/action'
import { ButtonLink } from '@/components/gros/button'
import { Card, Tile } from '@/components/gros/card'
import { Field } from '@/components/gros/input'
import { ListRow, RowList } from '@/components/gros/list-row'
import { ErrorState } from '@/components/gros/states'
import { Status } from '@/components/gros/status'
import { SelectField, TextAreaField } from '@/features/admin/fields'
import { operationAction, acceptInvite } from './actions'
import { z } from 'zod'
import type { ReactNode } from 'react'
import { rewriteAvailability } from '@/features/email-generation/config'
import { connectionsEmptyText, rewriteStatus } from './provider-status'
import { modelsInUseNow, retirementWatch } from '@/features/ai/retirement-watch'
import { liveSwitches } from './live-switches'

/**
 * The admin Operations page's cards (UI-ADM): GROS white cards of rows
 * and tiles. A line that needs the admin carries the Needs you pill; the
 * rest say their state in words.
 */
function OpsCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card label={title}>
      <div className="flex flex-col gap-[var(--space-5)]">
        <h2 className="type-heading">{title}</h2>
        {children}
      </div>
    </Card>
  )
}

/** A line of words in a card: a fact, or what is not there yet. */
function Quiet({ children }: { children: ReactNode }) {
  return <p className="type-body break-words text-[var(--stone)]">{children}</p>
}

/** A row with no thumbnail and nothing to press: its words and a pill. */
function FactRow({
  title,
  details,
  needsYou = false,
  status
}: {
  title: string
  details: string[]
  needsYou?: boolean
  status?: ReactNode
}) {
  return (
    <ListRow
      thumbnail={null}
      title={title}
      details={details}
      wrap
      end={needsYou ? <Status kind="needs_you" /> : (status ?? null)}
    />
  )
}

/** The Operations page can try again: the address it reloads. */
const operationsHref = '/admin/operations' as const

/**
 * Owner pick #83: the models the app would call now, and when their
 * providers shut them down (whole UTC days). Its own card: it needs no
 * database, so it shows even when the diagnostics cannot be read.
 */
export async function RetirementWatchPanel() {
  await requireRequestContext('admin')
  const lines = retirementWatch(
    modelsInUseNow(),
    new Date().toISOString().slice(0, 10)
  )
  return (
    <OpsCard title="Model retirement watch">
      {lines.length ? (
        <RowList label="Models in use">
          {lines.map((l) => (
            <FactRow
              key={l.name}
              title={l.name}
              details={[l.detail]}
              needsYou={l.state !== 'ok'}
            />
          ))}
        </RowList>
      ) : (
        <Quiet>
          No AI model is in use: GROS’s agents run on the fake, and the older
          email rewriting is off.
        </Quiet>
      )}
    </OpsCard>
  )
}
/**
 * OPS-LIVE: which live switches the live app has on (its Vercel settings),
 * in plain words; never a value. Needs no database.
 */
export async function LiveSwitchesPanel() {
  await requireRequestContext('admin')
  return (
    <OpsCard title="Go-live switches">
      <RowList label="Go-live switches">
        {liveSwitches().map((s) => (
          <FactRow
            key={s.label}
            title={s.label}
            details={[s.detail]}
            needsYou={s.state === 'attention'}
          />
        ))}
      </RowList>
    </OpsCard>
  )
}
const money = (value: number) =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 4
  }).format(value / 1000000)
export async function InvitationPanel() {
  const db = await createClient()
  if (!db) return null
  const r = await db.rpc('my_pending_invites')
  return r.data?.length ? (
    <Panel title="Accept an invitation">
      {r.data.map((i) => (
        <ActionForm key={i.id} action={acceptInvite}>
          <input type="hidden" name="id" value={i.id} />
          <p className="mb-3">
            {i.tenant_name} · {i.role}
          </p>
          <SubmitButton>Accept verified invitation</SubmitButton>
        </ActionForm>
      ))}
    </Panel>
  ) : null
}

/** A ticket's kind and state, in words. */
const ticketWords: Record<string, string> = {
  support: 'Support',
  feedback: 'Feedback',
  open: 'Open',
  in_progress: 'In progress',
  closed: 'Closed'
}
const ticketWord = (value: string) => ticketWords[value] ?? value

/**
 * The members' support questions, for the platform admins: each thread's
 * messages and a reply that can change its state. Members ask and reply
 * on Settings (UI-SETd).
 */
export async function SupportPanel() {
  await requireRequestContext('admin')
  const db = await createClient()
  if (!db) return null
  const tickets = await db
    .from('support_tickets')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(30)
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
  if (tickets.error || messages.error)
    return (
      <ErrorState
        title="Support did not open"
        reason="Support data unavailable. Reload the page to try again."
        action={<ButtonLink href={operationsHref} label="Try again" />}
      />
    )
  return (
    <OpsCard title="Support queue">
      <ActionAnswers>
        {tickets.data?.length ? (
          <ul
            aria-label="Support threads"
            className="flex flex-col gap-[var(--space-3)]"
          >
            {tickets.data.map((t) => (
              <li
                key={t.id}
                className="gros-tile flex flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--mist)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-[var(--space-3)]">
                  <div className="flex min-w-0 flex-col gap-[var(--space-1)]">
                    <h3 className="type-body-strong break-words">
                      {t.subject}
                    </h3>
                    <p className="type-caption text-[var(--stone)]">
                      {ticketWord(t.kind)} · {ticketWord(t.state)}
                    </p>
                  </div>
                  {t.state === 'open' ? <Status kind="needs_you" /> : null}
                </div>
                <ul className="flex flex-col gap-[var(--space-3)]">
                  {messages.data
                    ?.filter((m) => m.ticket_id === t.id)
                    .map((m) => (
                      <li
                        className="type-body break-words whitespace-pre-wrap"
                        key={m.id}
                      >
                        {m.body}
                      </li>
                    ))}
                </ul>
                <ActionButton
                  action={operationAction}
                  label="Save thread reply"
                  spokenLabel={t.subject}
                  kind="outline"
                  size="row"
                  fields={{
                    surface: 'admin',
                    kind: 'reply_ticket',
                    tenant: t.tenant_id,
                    id: t.id,
                    revision: String(t.revision)
                  }}
                >
                  <TextAreaField
                    label="Thread reply"
                    name="body"
                    rows={2}
                    onTile
                  />
                  <SelectField
                    label="Ticket state"
                    name="state"
                    defaultValue={t.state}
                    onTile
                    options={['open', 'in_progress', 'closed'].map((s) => ({
                      value: s,
                      label: ticketWord(s)
                    }))}
                  />
                </ActionButton>
              </li>
            ))}
          </ul>
        ) : (
          <Quiet>No support threads yet.</Quiet>
        )}
      </ActionAnswers>
    </OpsCard>
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

/** A job's state as a pill: failed needs a person, waiting or running is working. */
const jobWords: Record<string, string> = {
  queued: 'Queued',
  leased: 'Starting',
  running: 'Running',
  retry_wait: 'Retrying',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled'
}
function JobStatus({ status }: { status: string }) {
  if (status === 'failed') return <Status kind="needs_you" />
  if (['queued', 'leased', 'running', 'retry_wait'].includes(status))
    return <Status kind="working" word={jobWords[status]} />
  return null
}

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
    return (
      <ErrorState
        title="Diagnostics did not open"
        reason="Sanitized diagnostics unavailable. Reload the page to try again."
        action={<ButtonLink href={operationsHref} label="Try again" />}
      />
    )
  const d = data.data
  const tenantName = (id: string) => d.tenants.find((t) => t.id === id)?.name
  const superAdmin = ctx.adminRole === 'super_admin'
  const packages = (p.data ?? []).map((x) => ({
    value: x.id,
    label: `${x.name} · revision ${x.revision}`
  }))
  return (
    <>
      <OpsCard title="Workspaces">
        {/*
          Sanitized: states and identifiers only. Private chats, job inputs,
          provider payloads and secrets are excluded; conversations are
          counts.
        */}
        <div className="grid grid-cols-2 gap-[var(--space-3)] sm:max-w-md">
          <Tile label="Conversations" value={d.chats.count} />
          <Tile label="Private" value={d.chats.privateCount} />
        </div>
        <ActionAnswers>
          {d.tenants.length ? (
            <ul
              aria-label="Workspaces"
              className="flex flex-col gap-[var(--space-3)]"
            >
              {d.tenants.map((t) => (
                <li
                  key={t.id}
                  className="gros-tile flex flex-col gap-[var(--space-4)] rounded-[var(--radius-md)] bg-[var(--mist)]"
                >
                  <div className="flex flex-col gap-[var(--space-1)]">
                    <h3 className="type-body-strong break-words">{t.name}</h3>
                    <p className="type-caption break-words text-[var(--stone)]">
                      {[
                        t.status,
                        t.timezone,
                        t.package ?? 'No cycle initialized',
                        `${money(t.usedMicro ?? 0)} used of ${money(t.allocationMicro ?? 0)} synthetic allowance`
                      ].join(' · ')}
                    </p>
                  </div>
                  {superAdmin ? (
                    <ActionButton
                      action={operationAction}
                      label="Assign fixture package"
                      spokenLabel={t.name}
                      kind="outline"
                      size="row"
                      confirm={`Assign this fixture package to ${t.name}? It makes a fixed cycle snapshot. Outstanding reservations must be resolved first. No payment is collected.`}
                      fields={{
                        surface: 'admin',
                        kind: 'assign_package',
                        tenant: t.id
                      }}
                    >
                      <SelectField
                        label={`Fixture package for ${t.name}`}
                        name="package"
                        onTile
                        options={packages}
                      />
                    </ActionButton>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Quiet>No workspaces yet.</Quiet>
          )}
        </ActionAnswers>
      </OpsCard>
      <OpsCard title="Job diagnostics">
        {d.jobs.length ? (
          <RowList label="Sanitized durable jobs">
            {d.jobs.map((j) => (
              <FactRow
                key={j.id}
                title={j.kind}
                details={[
                  tenantName(j.tenant_id) ?? '',
                  jobWords[j.status] ?? j.status,
                  `${j.attempt}/4 tries`,
                  j.error_code ? `Code ${j.error_code}` : ''
                ]}
                status={<JobStatus status={j.status} />}
              />
            ))}
          </RowList>
        ) : (
          <Quiet>No jobs yet.</Quiet>
        )}
      </OpsCard>
      <OpsCard title="Provider health">
        <RowList label="Email rewriting">
          {d.tenants.map((t) => {
            const s = rewriteStatus(
              rewriteAvailability(t.id),
              d.jobs.filter((j) => j.tenant_id === t.id)
            )
            return (
              <FactRow
                key={`ai-${t.id}`}
                title={t.name}
                details={[s.label, s.detail]}
                needsYou={s.state === 'attention'}
              />
            )
          })}
        </RowList>
        {d.connections.length === 0 ? (
          <Quiet>{connectionsEmptyText}</Quiet>
        ) : (
          <RowList label="Connections">
            {d.connections.map((c) => (
              <FactRow
                key={c.tenant_id + c.provider}
                title={`${tenantName(c.tenant_id) ?? ''} · ${c.provider}`}
                details={[
                  c.status,
                  `Last fixture sync ${c.last_sync_at ?? 'never'}`
                ]}
              />
            ))}
          </RowList>
        )}
        {d.assignmentRequests.length ? (
          <RowList label="Pending assignments">
            {d.assignmentRequests.map((a) => (
              <FactRow
                key={a.id}
                title="Pending assignment"
                details={[
                  `Campaign ${a.campaign_id}`,
                  tenantName(a.tenant_id) ?? ''
                ]}
              />
            ))}
          </RowList>
        ) : null}
      </OpsCard>
      {superAdmin ? (
        <OpsCard title="Fixture packages">
          <ActionButton
            action={operationAction}
            label="Save fixture package revision"
            fields={{ surface: 'admin', kind: 'define_package' }}
          >
            <div className="grid grid-cols-1 gap-[var(--space-4)] lg:grid-cols-3">
              <Field
                label="Package name"
                name="name"
                required
                autoComplete="off"
              />
              <Field
                label="Cycle allowance (micro USD)"
                name="allocation"
                type="number"
                min={1000}
                defaultValue={20000000}
                required
              />
              <Field
                label="Daily allowance (micro USD)"
                name="daily"
                type="number"
                min={1000}
                defaultValue={2000000}
                required
              />
            </div>
          </ActionButton>
        </OpsCard>
      ) : null}
    </>
  )
}
