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
import { assignDesigner } from '@/features/designers/actions'
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
    </div>
  )
}
