import Link from 'next/link'
import type { Route } from 'next'
import type { Database } from '@/lib/supabase/database.types'
import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { TextField } from '@/components/ui/text-field'
import { planningAction } from './actions'
import { planningData } from './data'
type Campaign = Database['public']['Tables']['campaigns']['Row']
export function PlanningCommand({
  kind,
  id,
  children
}: {
  kind: string
  id?: string
  children: React.ReactNode
}) {
  return (
    <ActionForm action={planningAction}>
      <input name="kind" type="hidden" value={kind} />
      {id && <input name="id" type="hidden" value={id} />} {children}
    </ActionForm>
  )
}
export async function PlanningPanel({
  tenantId,
  owner,
  campaigns,
  audiences
}: {
  tenantId: string
  owner: boolean
  campaigns: Campaign[]
  audiences: Database['public']['Tables']['audiences']['Row'][]
}) {
  const data = await planningData(tenantId)
  if (!data) return <Notice error>Planning data unavailable.</Notice>
  const p = data.preferences
  return (
    <div className="mt-6 space-y-6">
      <Panel title="Guarded 30-day planning">
        <Notice>
          Synthetic planning uses approved inputs and private evidence. Five
          sends per audience/week, at most 40% discounted sends, and seven days
          between sitewide campaigns. Owner review is required. Review-speed
          goals remain unmeasured targets.
        </Notice>
        {owner && (
          <ActionForm
            action={planningAction}
            className="mt-4 grid gap-4 sm:grid-cols-2"
          >
            <input name="kind" type="hidden" value="plan" />
            <Field label="Rolling start (ISO timestamp with timezone)">
              <TextField
                name="start"
                required
                defaultValue={new Date(
                  new Date().getTime() + 86400000
                ).toISOString()}
              />
            </Field>
            <Field label="Planning audience">
              <select name="audience" className={controlClass}>
                {audiences.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <SubmitButton>Queue rolling fixture plan</SubmitButton>
            </div>
          </ActionForm>
        )}
        {data.plans.map((plan) => {
          const entries = campaigns.filter(
            (c) =>
              c.lineage &&
              typeof c.lineage === 'object' &&
              !Array.isArray(c.lineage) &&
              c.lineage.planId === plan.id &&
              !c.superseded_by_plan
          )
          return (
            <details
              className="mt-5 rounded-lg border border-[var(--line)] p-4"
              key={plan.id}
              open={plan.id === data.plans[0]?.id}
            >
              <summary>
                30-day plan ·{' '}
                {new Date(plan.starts_at).toLocaleDateString('en')} ·{' '}
                {entries.length} retained entries
              </summary>
              <div className="my-4 grid gap-3 sm:grid-cols-2">
                {entries.map((c) => (
                  <Link
                    key={c.id}
                    href={`/campaigns/${c.id}` as Route}
                    className="rounded border border-[var(--line)] p-3 text-sm"
                  >
                    {c.title}
                    <span className="block text-xs">
                      {c.planned_at} · calendar v{c.calendar_revision} ·{' '}
                      {c.calendar_state} · sequence step{' '}
                      {c.sequence_position ?? '—'}
                    </span>
                  </Link>
                ))}
              </div>
              {owner &&
                entries.some((c) => c.calendar_state === 'proposed') && (
                  <ConfirmDialog
                    label="Review plan approval"
                    title="Approve exact proposed plan"
                    description="Review every retained entry above. Edits after generation require individual review. This approves calendar versions only."
                  >
                    <PlanningCommand kind="approve_plan" id={plan.id}>
                      <SubmitButton>
                        Approve reviewed calendar plan
                      </SubmitButton>
                    </PlanningCommand>
                  </ConfirmDialog>
                )}
              <details className="mt-3 text-xs">
                <summary>Input and evidence lineage</summary>
                <pre className="overflow-auto">
                  {JSON.stringify(plan.input_revisions, null, 2)}
                </pre>
              </details>
            </details>
          )
        })}
      </Panel>
      {owner && (
        <Panel title="Planning preferences">
          <ActionForm
            action={planningAction}
            className="grid gap-4 sm:grid-cols-3"
          >
            <input name="kind" type="hidden" value="preferences" />
            <input name="revision" type="hidden" value={p?.revision ?? 1} />
            <Field label="Weekly audience cap">
              <TextField
                name="weekly"
                type="number"
                min={1}
                max={5}
                defaultValue={p?.weekly_cap ?? 5}
                required
              />
            </Field>
            <Field label="Maximum discounted share (%)">
              <TextField
                name="discount"
                type="number"
                min={0}
                max={40}
                defaultValue={p?.discount_cap ?? 40}
                required
              />
            </Field>
            <Field label="Sitewide spacing (days)">
              <TextField
                name="gap"
                type="number"
                min={7}
                max={60}
                defaultValue={p?.sitewide_gap ?? 7}
                required
              />
            </Field>
            <div>
              <SubmitButton variant="secondary">
                Save guarded preferences
              </SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      )}
      <PlanningJobs data={data} owner={owner} />
    </div>
  )
}
export function PlanningJobs({
  data,
  owner
}: {
  data: NonNullable<Awaited<ReturnType<typeof planningData>>>
  owner: boolean
}) {
  return (
    <Panel title="Planning and copy jobs">
      {owner && (
        <PlanningCommand kind="run">
          <SubmitButton variant="secondary">
            Run planning fixture jobs
          </SubmitButton>
        </PlanningCommand>
      )}
      <ul className="mt-4 space-y-2 text-sm">
        {data.jobs.map((j) => (
          <li key={j.id}>
            {j.kind} · {j.status} · attempt {j.attempt}/4{' '}
            {j.error_code && `· ${j.error_code}`}
          </li>
        ))}
      </ul>
      {data.rules.length > 0 && (
        <details className="mt-4">
          <summary>Explicit owner standing prohibitions</summary>
          {data.rules.map((r) => (
            <p key={r.id} className="mt-2 text-sm">
              {r.scope}: “{r.forbidden_phrase}” · revision {r.revision}
            </p>
          ))}
        </details>
      )}
    </Panel>
  )
}
export function RejectionForm({
  campaign: c,
  versionKind = 'copy'
}: {
  campaign: Campaign
  versionKind?: 'copy' | 'calendar'
}) {
  return (
    <details className="mt-5">
      <summary>Reject an exact version and set explicit rule scope</summary>
      <ActionForm action={planningAction} className="mt-4 grid gap-4">
        <input name="kind" type="hidden" value="reject" />
        <input name="id" type="hidden" value={c.id} />
        <input
          name="revision"
          type="hidden"
          value={versionKind === 'copy' ? c.copy_revision : c.calendar_revision}
        />
        <input name="versionKind" type="hidden" value={versionKind} />
        <Field label="Rejection reason">
          <textarea
            name="reason"
            className={controlClass}
            required
            minLength={5}
          />
        </Field>
        <Field label="Rule scope">
          <select name="scope" className={controlClass}>
            <option value="single">This entry only</option>
            {c.sequence_id && <option value="sequence">Entire sequence</option>}
            <option value="audience">This audience</option>
          </select>
        </Field>
        <Field label="Optional literal phrase to prohibit">
          <TextField name="phrase" maxLength={200} />
        </Field>
        <Notice>
          Only the selected version is rejected. An entered phrase becomes a
          visible standing prohibition at the selected scope; other entries are
          checked on their next approval.
        </Notice>
        <div>
          <SubmitButton variant="danger">
            Reject {versionKind} v
            {versionKind === 'copy' ? c.copy_revision : c.calendar_revision}
          </SubmitButton>
        </div>
      </ActionForm>
    </details>
  )
}
