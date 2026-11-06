import { createClient } from '@/lib/supabase/server'
import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { TextField } from '@/components/ui/text-field'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable } from '@/components/ui/data-table'
import { LocalDateTimeField } from '@/components/ui/local-date-time-field'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { deliveryAction } from './actions'
import type { Database } from '@/lib/supabase/database.types'
type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export async function PolicyPanel({
  tenantId,
  owner
}: {
  tenantId: string
  owner: boolean
}) {
  const db = await createClient()
  if (!db) return null
  const [p, b, registry] = await Promise.all([
    db
      .from('delivery_policies')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db.from('brand_profiles').select('*').eq('tenant_id', tenantId).single(),
    db.from('segment_registry').select('*').eq('tenant_id', tenantId)
  ])
  if (p.error || b.error || registry.error)
    return <Notice error>Delivery settings unavailable.</Notice>
  const defaults = (p.data?.defaults ?? {}) as Record<string, string>,
    brand = b.data
  return (
    <div className="space-y-6">
      <Panel title="Delivery policy">
        <Notice>
          Current policy: {p.data?.level ?? 'L0'} ·{' '}
          {p.data?.enabled
            ? 'background fixture scheduling enabled'
            : 'explicit scheduling confirmation'}
          . L1 still requires exact owner calendar, copy and design approval.
          Disabling a policy stops new requests; already accepted schedules need
          explicit cancellation. Live delivery and L2 remain unavailable.
        </Notice>
        {owner && (
          <ConfirmDialog
            label="Review delivery policy"
            title="Confirm owner delivery policy"
            description="L1 grants standing permission to schedule ready reviewed packages with the fixture provider. This does not send to real recipients."
          >
            <ActionForm action={deliveryAction} className="grid gap-4">
              <input type="hidden" name="kind" value="policy" />
              <input
                type="hidden"
                name="revision"
                value={p.data?.revision ?? 0}
              />
              <Field label="Delivery level">
                <select
                  name="level"
                  className={controlClass}
                  defaultValue={p.data?.level ?? 'L0'}
                >
                  <option>L0</option>
                  <option>L1</option>
                </select>
              </Field>
              <Field label="Background fixture scheduling">
                <select
                  name="enabled"
                  className={controlClass}
                  defaultValue={String(p.data?.enabled ?? false)}
                >
                  <option value="false">Disabled</option>
                  <option value="true">Enabled for L1</option>
                </select>
              </Field>
              <Field label="Default sender name">
                <TextField
                  name="senderName"
                  defaultValue={defaults.senderName ?? brand?.brand_name}
                  required
                />
              </Field>
              <Field label="Default sender email">
                <TextField
                  name="senderEmail"
                  defaultValue={
                    defaults.senderEmail ?? `studio@${brand?.domain}`
                  }
                  type="email"
                  required
                />
              </Field>
              <Field label="Default postal address">
                <TextField
                  name="address"
                  defaultValue={defaults.address}
                  required
                />
              </Field>
              <Field label="Default unsubscribe URL">
                <TextField
                  name="unsubscribeUrl"
                  defaultValue={
                    defaults.unsubscribeUrl ??
                    `https://${brand?.domain}/unsubscribe`
                  }
                  type="url"
                  required
                />
              </Field>
              <Field label="Default privacy URL">
                <TextField
                  name="privacyUrl"
                  defaultValue={
                    defaults.privacyUrl ?? `https://${brand?.domain}/privacy`
                  }
                  type="url"
                  required
                />
              </Field>
              <SubmitButton>Save owner delivery policy</SubmitButton>
            </ActionForm>
          </ConfirmDialog>
        )}
      </Panel>
      <Panel title="Canonical fixture audiences">
        {registry.data?.length ? (
          <DataTable
            caption="Account-scoped synthetic segment registry"
            headers={[
              'Account',
              'Canonical key',
              'Provider identity',
              'Definition'
            ]}
          >
            {registry.data.map((r) => (
              <tr key={r.canonical_key + r.account_id}>
                <td className="p-3">{r.account_id}</td>
                <td className="p-3">{r.canonical_key}</td>
                <td className="p-3">{r.provider_id}</td>
                <td className="p-3">{r.definition}</td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <Notice>
            Registry is initialized by saving owner delivery defaults or
            validating a push. Real segment provisioning is disabled pending
            definitions.
          </Notice>
        )}
      </Panel>
    </div>
  )
}
export async function DeliveryOperations({
  campaign: c,
  owner
}: {
  campaign: Row<'campaigns'>
  owner: boolean
}) {
  const db = await createClient()
  if (!db) return null
  const { timezone } = await requireRequestContext('client')
  const [p, j, fault] = await Promise.all([
    db
      .from('delivery_packages')
      .select('id')
      .eq('tenant_id', c.tenant_id)
      .eq('campaign_id', c.id),
    db
      .from('job_runs')
      .select('*')
      .eq('tenant_id', c.tenant_id)
      .eq('campaign_id', c.id)
      .in('status', ['failed', 'retry_wait']),
    db
      .from('fixture_fault_controls')
      .select('*')
      .eq('tenant_id', c.tenant_id)
      .eq('campaign_id', c.id)
      .maybeSingle()
  ])
  const f = p.data?.length
    ? await db
        .from('fixture_deliveries')
        .select('*')
        .eq('tenant_id', c.tenant_id)
        .in(
          'package_id',
          p.data.map((r) => r.id)
        )
        .order('updated_at', { ascending: false })
    : { data: [], error: null }
  if ([p, f, j, fault].some((r) => r.error))
    return <Notice error>Provider diagnostics unavailable.</Notice>
  const records = f.data ?? [],
    latest = records[0]
  return (
    <Panel title="Persisted provider confirmation">
      <Notice>
        Campaign delivery: {c.delivery_state}. Provider preparation, scheduling
        and simulated sending are distinct. Faults below affect local fixtures
        only.
      </Notice>
      <div className="my-4 space-y-3 text-sm">
        {records.map((r) => (
          <p key={r.id}>
            Fixture identity {r.id} · {r.state} · scheduled{' '}
            {r.scheduled_at ?? '—'} · sent {r.sent_at ?? '—'}
          </p>
        ))}
      </div>
      {owner && (
        <div className="space-y-5">
          <ActionForm
            action={deliveryAction}
            className="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="kind" value="fault" />
            <input type="hidden" name="id" value={c.id} />
            <Field label="Synthetic fault scenario">
              <select
                className={controlClass}
                name="scenario"
                defaultValue={fault.data?.scenario ?? 'none'}
              >
                {[
                  'none',
                  'transient_once',
                  'rate_limit_once',
                  'auth_permanent',
                  'validation_permanent',
                  'timeout_after_success',
                  'unknown_reconcile',
                  'cancel_rejected'
                ].map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitButton variant="secondary">Save fixture fault</SubmitButton>
          </ActionForm>
          {latest?.state === 'scheduled' &&
            c.delivery_state === 'scheduled' && (
              <>
                <ConfirmDialog
                  label="Review rescheduling"
                  title="Confirm exact schedule revision"
                  description="Owner confirms a new calendar time and immutable package. Existing provider identity is retained; confirmation is pending until reconciliation."
                >
                  <ActionForm action={deliveryAction}>
                    <input type="hidden" name="kind" value="reschedule" />
                    <input type="hidden" name="id" value={c.id} />
                    <input
                      type="hidden"
                      name="revision"
                      value={c.delivery_revision}
                    />
                    <LocalDateTimeField
                      name="scheduledAt"
                      label="New send time"
                      timezone={timezone}
                      defaultValue={
                        new Date(new Date(c.planned_at).getTime() + 3600000)
                      }
                    />
                    <SubmitButton>Confirm fixture reschedule</SubmitButton>
                  </ActionForm>
                </ConfirmDialog>
                <ConfirmDialog
                  label="Review simulated send clock"
                  title="Advance fixture clock to scheduled send"
                  description="Confirm a simulated send at the displayed schedule. This contacts no real recipients and saves an own-tenant skeleton."
                >
                  <ActionForm action={deliveryAction}>
                    <input type="hidden" name="kind" value="sent" />
                    <input type="hidden" name="id" value={latest.id} />
                    <input
                      type="hidden"
                      name="observedAt"
                      value={latest.scheduled_at ?? ''}
                    />
                    <SubmitButton>Confirm synthetic send</SubmitButton>
                  </ActionForm>
                </ConfirmDialog>
              </>
            )}
          {j.data
            ?.filter((r) => r.kind.startsWith('delivery.'))
            .map((r) => (
              <div
                className="rounded-lg border border-[var(--line)] p-4 text-sm"
                key={r.id}
              >
                <p className="mb-3">
                  {r.kind}: {r.failure_class} · {r.attempt}/4 attempts
                </p>
                <div className="flex flex-wrap gap-3">
                  <ActionForm action={deliveryAction}>
                    <input type="hidden" name="kind" value="retry" />
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton variant="secondary">
                      Retry resolved fixture job
                    </SubmitButton>
                  </ActionForm>
                  <ActionForm action={deliveryAction}>
                    <input type="hidden" name="kind" value="resolve" />
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton variant="secondary">
                      Reconcile known outcome only
                    </SubmitButton>
                  </ActionForm>
                </div>
              </div>
            ))}
        </div>
      )}
    </Panel>
  )
}
