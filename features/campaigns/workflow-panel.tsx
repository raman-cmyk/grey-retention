import { RejectionForm } from '@/features/planning/panels'
import Image from 'next/image'
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
  const latest = data.submissions[0]
  const currentDesign =
    latest?.revision === c.design_revision &&
    latest.copy_revision === c.copy_revision
  const pkg = data.package
  const currentPackage = pkg?.revision === c.delivery_revision
  return (
    <div className="mt-6 space-y-6">
      {data.error && <Notice error>{data.error}</Notice>}
      <Panel title={`Copy review · version ${c.copy_revision}`}>
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
                Owner approved copy v{c.copy_revision}. Platform admin may
                assign the approved brief.
              </Notice>
            )}
          </>
        )}
      </Panel>
      <Panel title="Owner design review">
        {data.assignment ? (
          <div>
            <p className="mb-4 text-sm">
              Assignment {data.assignment.state.replaceAll('_', ' ')} · due{' '}
              {new Intl.DateTimeFormat('en', {
                timeZone: c.timezone,
                dateStyle: 'medium',
                timeStyle: 'short'
              }).format(new Date(data.assignment.due_at))}
              {new Date(data.assignment.due_at).getTime() <
                new Date().getTime() && data.assignment.state !== 'approved'
                ? ' · SLA escalation required'
                : ''}
            </p>
            {latest ? (
              <>
                <h3 className="mb-3 font-semibold">
                  Design v{latest.revision} · copy v{latest.copy_revision}
                </h3>
                {latest.preview ? (
                  <Image
                    src={latest.preview}
                    alt={`Submitted campaign design version ${latest.revision}`}
                    width={600}
                    height={800}
                    unoptimized
                    className="mb-4 h-auto max-h-[45rem] w-auto max-w-full rounded-lg border border-[var(--line)]"
                  />
                ) : (
                  <Notice error>
                    Private preview unavailable. Refresh for a new signed URL.
                  </Notice>
                )}
                <p className="mb-4 text-sm whitespace-pre-wrap">
                  {latest.notes}
                </p>
                {!currentDesign && (
                  <Notice error>
                    This submission refers to an older copy or design revision.
                    A new submission is required.
                  </Notice>
                )}
                {owner && currentDesign && c.design_state === 'submitted' && (
                  <div className="grid gap-5 sm:grid-cols-2">
                    <ActionForm action={workflowAction} className="grid gap-3">
                      <input type="hidden" name="kind" value="review_design" />
                      <input type="hidden" name="id" value={latest.id} />
                      <input
                        type="hidden"
                        name="revision"
                        value={c.design_revision}
                      />
                      <input type="hidden" name="decision" value="revision" />
                      <Field label="Design section">
                        <TextField
                          name="section"
                          required
                          placeholder="Hero, product strip, footer…"
                        />
                      </Field>
                      <Field label="Requested revision">
                        <textarea
                          name="feedback"
                          className={controlClass}
                          rows={3}
                          required
                          minLength={5}
                        />
                      </Field>
                      <div>
                        <SubmitButton variant="secondary">
                          Request section revision
                        </SubmitButton>
                      </div>
                    </ActionForm>
                    <Command
                      kind="review_design"
                      id={latest.id}
                      revision={c.design_revision}
                    >
                      <input name="decision" type="hidden" value="approved" />
                      <input
                        name="section"
                        type="hidden"
                        value="whole_design"
                      />
                      <input
                        name="feedback"
                        type="hidden"
                        value="Owner approved exact final version."
                      />
                      <p className="mb-4 text-sm leading-6">
                        Confirm that this exact design implements approved copy
                        v{c.copy_revision}. Later material changes need new
                        approval.
                      </p>
                      <SubmitButton>
                        Approve design v{c.design_revision}
                      </SubmitButton>
                    </Command>
                  </div>
                )}
                {c.design_state === 'owner_approved' && (
                  <Notice>
                    Brand owner approved exact design v{c.design_revision}.
                  </Notice>
                )}
              </>
            ) : (
              <Notice>
                Waiting for the assigned designer’s first submission.
              </Notice>
            )}
            <details className="mt-5">
              <summary className="cursor-pointer text-sm font-medium">
                Submission and section feedback history
              </summary>
              <div className="mt-3 space-y-3 text-sm">
                {data.submissions.map((s) => (
                  <p key={s.id}>
                    Design v{s.revision} · copy v{s.copy_revision} · {s.notes}
                  </p>
                ))}
                {data.reviews.map((r) => (
                  <p key={r.id}>
                    {r.decision} · {r.section}: {r.feedback}
                  </p>
                ))}
              </div>
            </details>
          </div>
        ) : (
          <Notice>
            {c.copy_state === 'approved'
              ? 'Approved copy is waiting for platform assignment.'
              : 'Approve copy before design assignment.'}
          </Notice>
        )}
      </Panel>
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
            <input type="hidden" name="revision" value={c.delivery_revision} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Sender name">
                <TextField
                  name="senderName"
                  defaultValue={brand?.brand_name ?? ''}
                  required
                />
              </Field>
              <Field label="Sender email">
                <TextField
                  name="senderEmail"
                  type="email"
                  defaultValue={brand?.domain ? `studio@${brand.domain}` : ''}
                  required
                />
              </Field>
            </div>
            <Field label="Footer postal address">
              <TextField name="address" required minLength={5} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Unsubscribe HTTPS URL">
                <TextField
                  name="unsubscribeUrl"
                  type="url"
                  defaultValue={
                    brand?.domain ? `https://${brand.domain}/unsubscribe` : ''
                  }
                  required
                />
              </Field>
              <Field label="Privacy HTTPS URL">
                <TextField
                  name="privacyUrl"
                  type="url"
                  defaultValue={
                    brand?.domain ? `https://${brand.domain}/privacy` : ''
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
            Simulation only. Provider acceptance, links and recipients have not
            been evaluated against a live account.
          </Notice>
          <dl className="my-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--text-muted)]">Audience/account</dt>
              <dd>
                {pkg.audience.accountId} · {pkg.audience.includes.join(', ')}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)]">Required exclusions</dt>
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
            srcDoc={pkg.html.replace(
              'cid:design-artifact',
              latest?.preview ?? ''
            )}
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
          {owner && c.delivery_state === 'scheduled' && (
            <ConfirmDialog
              danger
              label="Review cancellation"
              title="Confirm cancellation request"
              description="Cancellation becomes final only when the fixture provider confirms it. A sent campaign cannot be recalled."
            >
              <Command kind="cancel" id={c.id} revision={c.delivery_revision}>
                <SubmitButton variant="danger">
                  Request simulated cancellation
                </SubmitButton>
              </Command>
            </ConfirmDialog>
          )}
        </Panel>
      )}
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
