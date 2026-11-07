import { DeliveryOperations } from '@/features/delivery/panels'
import { RejectionForm } from '@/features/planning/panels'
import { RenderPanel } from '@/features/rendering/panel'
import type { Database } from '@/lib/supabase/database.types'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable } from '@/components/ui/data-table'
import { Field, Panel, Notice, controlClass } from '@/components/ui/workspace'
import { TextField } from '@/components/ui/text-field'
import { workflowData } from './workflow-data'
import { workflowAction } from './workflow-actions'
type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
function Command({
  kind,
  id,
  revision,
  children
}: {
  kind: string
  id: string
  revision: number
  children: React.ReactNode
}) {
  return (
    <ActionForm action={workflowAction}>
      <input name="kind" type="hidden" value={kind} />
      <input name="id" type="hidden" value={id} />
      <input name="revision" type="hidden" value={revision} />
      {children}
    </ActionForm>
  )
}
export async function WorkflowPanel({
  campaign: c,
  content,
  owner,
  brand
}: {
  campaign: Row<'campaigns'>
  content: Row<'campaign_content'> | null
  owner: boolean
  brand: Row<'brand_profiles'> | null
}) {
  const data = await workflowData(c.id)
  if (!data) return null
  const pkg = data.package
  const currentPackage = pkg?.revision === c.delivery_revision
  return (
    <div className="mt-6 space-y-6">
      {data.error && <Notice error>{data.error}</Notice>}
      <Panel id="copy" title={`Copy review · version ${c.copy_revision}`}>
        {c.calendar_state !== 'approved' ? (
          <Notice>
            Approve the calendar entry before generating or approving copy.
          </Notice>
        ) : (
          <>
            {owner && c.copy_state !== 'approved' && (
              <Command
                kind="generate_copy"
                id={c.id}
                revision={c.copy_revision}
              >
                <SubmitButton variant="secondary">
                  Queue original fixture copy
                </SubmitButton>
              </Command>
            )}
            {content?.validation_errors.length ? (
              <Notice error>{content.validation_errors.join(', ')}</Notice>
            ) : null}
            {content?.body && (
              <>
                <p className="my-4 text-xs text-[var(--text-muted)]">
                  Original fixture copy. Structured discount, deadline and
                  owner-prohibition guards run on every approval. Real
                  factual/creative quality remains unverified.
                </p>
                <ActionForm
                  key={c.copy_revision}
                  action={workflowAction}
                  className="grid gap-4"
                >
                  <input name="kind" type="hidden" value="save_copy" />
                  <input name="id" type="hidden" value={c.id} />
                  <input
                    name="revision"
                    type="hidden"
                    value={c.copy_revision}
                  />
                  <Field label="Selected subject">
                    <TextField
                      name="subject"
                      defaultValue={content.subject}
                      required
                      maxLength={200}
                      list={`subjects-${c.id}`}
                    />
                  </Field>
                  <datalist id={`subjects-${c.id}`}>
                    {content.subject_options.map((s) => (
                      <option key={s} value={s} />
                    ))}
                  </datalist>
                  <Field label="Preview text">
                    <TextField
                      name="preheader"
                      defaultValue={content.preheader}
                      maxLength={300}
                    />
                  </Field>
                  <Field label="Approved copy body">
                    <textarea
                      name="body"
                      rows={8}
                      className={controlClass}
                      defaultValue={content.body}
                      required
                      maxLength={20000}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="CTA label">
                      <TextField
                        name="cta"
                        defaultValue={content.cta}
                        required
                      />
                    </Field>
                    <Field label="Primary HTTPS destination">
                      <TextField
                        name="url"
                        defaultValue={content.primary_url}
                        required
                        type="url"
                      />
                    </Field>
                  </div>
                  {(owner || c.copy_state !== 'approved') && (
                    <div>
                      <SubmitButton variant="secondary">
                        Save copy revision
                      </SubmitButton>
                    </div>
                  )}
                </ActionForm>
                {owner && c.copy_state === 'pending_approval' && (
                  <div className="mt-5">
                    <Command
                      kind="approve_copy"
                      id={c.id}
                      revision={c.copy_revision}
                    >
                      <SubmitButton>
                        Approve copy v{c.copy_revision}
                      </SubmitButton>
                    </Command>
                  </div>
                )}
              </>
            )}
            {owner && <RejectionForm campaign={c} />}
            {c.copy_state === 'approved' && (
              <Notice>
                Owner approved copy v{c.copy_revision}.
                {['unassigned', 'revisions_requested'].includes(
                  c.design_state
                ) &&
                  (owner
                    ? ' Next: make the design below.'
                    : ' Next: the owner makes the design below.')}
              </Notice>
            )}
          </>
        )}
      </Panel>
      <div id="design" className="scroll-mt-24">
        <RenderPanel campaign={c} owner={owner} />
      </div>
      <div id="delivery" className="scroll-mt-24 space-y-6">
        {owner && c.design_state === 'owner_approved' && (
          <Panel title="Assemble a reviewed delivery package">
            <p className="mb-4 text-sm leading-6 text-[var(--text-muted)]">
              The immutable package takes copy and design from current owner
              approvals. Link, stock and audience validation use local fixtures.
              Enter a complete sender/footer; live execution remains disabled.
            </p>
            <ActionForm action={workflowAction} className="grid gap-4">
              <input type="hidden" name="kind" value="package" />
              <input type="hidden" name="id" value={c.id} />
              <input
                type="hidden"
                name="revision"
                value={c.delivery_revision}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Sender name">
                  <TextField
                    name="senderName"
                    defaultValue={
                      data.defaults.senderName ?? brand?.brand_name ?? ''
                    }
                    required
                  />
                </Field>
                <Field label="Sender email">
                  <TextField
                    name="senderEmail"
                    type="email"
                    defaultValue={
                      data.defaults.senderEmail ??
                      (brand?.domain ? `studio@${brand.domain}` : '')
                    }
                    required
                  />
                </Field>
              </div>
              <Field label="Footer postal address">
                <TextField
                  name="address"
                  defaultValue={data.defaults.address}
                  required
                  minLength={5}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Unsubscribe HTTPS URL">
                  <TextField
                    name="unsubscribeUrl"
                    type="url"
                    defaultValue={
                      data.defaults.unsubscribeUrl ??
                      (brand?.domain
                        ? `https://${brand.domain}/unsubscribe`
                        : '')
                    }
                    required
                  />
                </Field>
                <Field label="Privacy HTTPS URL">
                  <TextField
                    name="privacyUrl"
                    type="url"
                    defaultValue={
                      data.defaults.privacyUrl ??
                      (brand?.domain ? `https://${brand.domain}/privacy` : '')
                    }
                    required
                  />
                </Field>
              </div>
              <div>
                <SubmitButton variant="secondary">
                  Validate fixture delivery package
                </SubmitButton>
              </div>
            </ActionForm>
          </Panel>
        )}
        {pkg && (
          <Panel
            title={`Final delivery preview · package v${pkg.revision}${currentPackage ? '' : ' · superseded'}`}
          >
            <Notice>
              Simulation only. Provider acceptance, links and recipients have
              not been evaluated against a live account.
            </Notice>
            <dl className="my-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-[var(--text-muted)]">Audience/account</dt>
                <dd>
                  {pkg.audience.accountId} · {pkg.audience.includes.join(', ')}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">
                  Required exclusions
                </dt>
                <dd>{pkg.audience.excludes.join(', ')}</dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Sender</dt>
                <dd>
                  {pkg.sender.name} · {pkg.sender.email}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--text-muted)]">Schedule</dt>
                <dd>
                  {new Intl.DateTimeFormat('en', {
                    timeZone: pkg.timezone,
                    dateStyle: 'full',
                    timeStyle: 'short'
                  }).format(new Date(pkg.scheduledAt))}{' '}
                  · {pkg.timezone}
                </dd>
              </div>
            </dl>
            <iframe
              title="Final email preview"
              sandbox=""
              srcDoc={pkg.html
                .replace('cid:design-artifact', data.artifactPreviews[0] ?? '')
                .replace('cid:hero', data.artifactPreviews[0] ?? '')
                .replace('cid:copy', data.artifactPreviews[1] ?? '')
                .replace('cid:cta', data.artifactPreviews[2] ?? '')}
              className="mb-5 h-[36rem] w-full rounded-lg border border-[var(--line)] bg-white"
            />
            {owner && currentPackage && c.delivery_state === 'ready' && (
              <ConfirmDialog
                label="Review scheduling confirmation"
                title="Confirm simulated scheduling"
                description={`Schedule immutable package v${pkg.revision} for the displayed audience and time. This records owner confirmation and queues a fixture job.`}
              >
                <Command kind="schedule" id={pkg.id} revision={pkg.revision}>
                  <SubmitButton>
                    Confirm package v{pkg.revision} scheduling
                  </SubmitButton>
                </Command>
              </ConfirmDialog>
            )}
            {owner &&
              ['scheduled', 'queued', 'reconciling', 'failed'].includes(
                c.delivery_state
              ) && (
                <ConfirmDialog
                  danger
                  label="Review cancellation"
                  title="Confirm cancellation request"
                  description="Cancellation becomes final only when the fixture provider confirms it. A sent campaign cannot be recalled."
                >
                  <Command
                    kind="cancel"
                    id={c.id}
                    revision={c.delivery_revision}
                  >
                    <SubmitButton variant="danger">
                      Request simulated cancellation
                    </SubmitButton>
                  </Command>
                </ConfirmDialog>
              )}
          </Panel>
        )}
        <DeliveryOperations campaign={c} owner={owner} />
      </div>
      <Panel title="Durable fixture jobs">
        {owner && (
          <ActionForm action={workflowAction} className="mb-5">
            <input type="hidden" name="kind" value="run_jobs" />
            <SubmitButton variant="secondary">
              Run queued fixture jobs
            </SubmitButton>
          </ActionForm>
        )}
        {data.jobs.length ? (
          <DataTable
            caption="Campaign background operations"
            headers={['Operation', 'State', 'Attempts', 'Diagnostic']}
          >
            {data.jobs.map((j) => (
              <tr key={j.id}>
                <td className="p-3">{j.kind}</td>
                <td className="p-3">{j.status}</td>
                <td className="p-3">{j.attempt}/4</td>
                <td className="p-3">{j.error_code ?? '—'}</td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <Notice>No background intents yet.</Notice>
        )}
      </Panel>
      {data.notifications.length > 0 && (
        <Panel title="In-app notifications and fake email audit">
          <ul className="space-y-3 text-sm">
            {data.notifications.map((n) => (
              <li key={n.id}>
                {n.message}
                <span className="block text-xs text-[var(--text-muted)]">
                  In-app persisted · email delivery simulated
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  )
}
