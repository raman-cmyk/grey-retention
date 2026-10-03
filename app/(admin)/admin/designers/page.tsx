import {
  PageHeading,
  Panel,
  Notice,
  Field,
  controlClass
} from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { DataTable } from '@/components/ui/data-table'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { assignDesigner, designEscalation } from '@/features/designers/actions'
export default async function AdminDesigners() {
  await requireRequestContext('admin')
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return (
      <Notice error>
        Sign in through local Supabase for assignment operations.
      </Notice>
    )
  const result = await db.rpc('design_operations')
  const escalations = await db.rpc('design_escalation_operations')
  if (result.error)
    return <Notice error>Assignment diagnostics are unavailable.</Notice>
  const rows = await Promise.all(
    (result.data ?? []).map(async (c) => ({
      ...c,
      designers:
        (await db.rpc('assignable_designers', { t: c.tenant_id })).data ?? []
    }))
  )
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Design assignments"
        description="Assign approved briefs, track the 24-hour SLA and resolve escalation. Brand owners retain creative review and final approval."
      />
      <Panel title="Approved-copy queue">
        {rows.length === 0 ? (
          <Notice>No approved copy is waiting for assignment.</Notice>
        ) : (
          <DataTable
            caption="Approved campaign assignment operations"
            headers={['Campaign', 'Workflow / SLA', 'Assignment']}
          >
            {rows.map((c) => (
              <tr key={c.campaign_id}>
                <td className="min-w-44 p-3">
                  <h3 className="font-semibold">{c.title}</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Copy v{c.copy_revision}
                  </p>
                </td>
                <td className="min-w-40 p-3">
                  {c.design_state.replaceAll('_', ' ')}
                  {c.due_at && (
                    <p className="mt-1 text-xs">
                      Due {new Date(c.due_at).toISOString()} UTC
                    </p>
                  )}
                </td>
                <td className="min-w-64 p-3">
                  {c.design_state === 'owner_approved' ? (
                    <p className="text-sm">Owner approved current design.</p>
                  ) : (
                    <ActionForm action={assignDesigner}>
                      <input type="hidden" name="tenant" value={c.tenant_id} />
                      <input
                        type="hidden"
                        name="campaign"
                        value={c.campaign_id}
                      />
                      <input
                        type="hidden"
                        name="copy"
                        value={c.copy_revision}
                      />
                      <Field label={`Designer for ${c.title}`}>
                        <select
                          name="designer"
                          className={controlClass}
                          required
                        >
                          <option value="">Select permitted designer</option>
                          {c.designers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <div className="mt-3">
                        <SubmitButton variant="secondary">
                          {c.assignment_id
                            ? 'Reassign approved brief'
                            : 'Assign approved brief'}
                        </SubmitButton>
                      </div>
                    </ActionForm>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      <div className="mt-6">
        <Panel title="SLA issues and escalation">
          <Notice>
            Record blocked work or a verified overdue designer SLA. Escalation
            and resolution preserve owner copy and design approvals.
          </Notice>
          {escalations.error ? (
            <Notice error>Escalation diagnostics unavailable.</Notice>
          ) : (
            escalations.data?.map((c) => (
              <article
                key={c.campaign_id}
                className="mt-5 rounded-lg border border-[var(--line)] p-4"
              >
                <h3 className="font-semibold">
                  {c.title} · escalation {c.issue_state}
                </h3>
                <p className="my-3 text-sm">
                  Design workflow v{c.design_revision}
                  {c.due_at
                    ? ` · Due ${new Date(c.due_at).toISOString()} UTC${c.sla_overdue ? ' · overdue' : ''}`
                    : ' · No active designer assignment'}
                </p>
                {c.reason && (
                  <p className="mb-3 text-sm break-words">{c.reason}</p>
                )}
                {c.issue_state === 'open' && c.escalation_id ? (
                  <ActionForm action={designEscalation} className="grid gap-3">
                    <input type="hidden" name="kind" value="resolve" />
                    <input type="hidden" name="tenant" value={c.tenant_id} />
                    <input
                      type="hidden"
                      name="escalation"
                      value={c.escalation_id}
                    />
                    <Field label="Administrative resolution">
                      <textarea
                        name="notes"
                        className={controlClass}
                        required
                        minLength={10}
                        maxLength={2000}
                      />
                    </Field>
                    <SubmitButton variant="secondary">
                      Resolve design issue
                    </SubmitButton>
                  </ActionForm>
                ) : c.can_escalate ? (
                  <ActionForm action={designEscalation} className="grid gap-3">
                    <input type="hidden" name="kind" value="escalate" />
                    <input type="hidden" name="tenant" value={c.tenant_id} />
                    <input
                      type="hidden"
                      name="campaign"
                      value={c.campaign_id}
                    />
                    <input
                      type="hidden"
                      name="revision"
                      value={c.design_revision}
                    />
                    <Field label="Design issue">
                      <select name="category" className={controlClass}>
                        <option value="blocked">Blocked workflow</option>
                        <option value="sla_overdue">
                          Overdue designer SLA
                        </option>
                        <option value="no_designer">
                          No available designer
                        </option>
                      </select>
                    </Field>
                    <Field label="Escalation reason">
                      <textarea
                        name="notes"
                        className={controlClass}
                        required
                        minLength={10}
                        maxLength={2000}
                      />
                    </Field>
                    <SubmitButton variant="secondary">
                      Record design issue
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="text-sm">
                    Owner approved the current design; administrative history is
                    retained.
                  </p>
                )}
              </article>
            ))
          )}
        </Panel>
      </div>
    </div>
  )
}
