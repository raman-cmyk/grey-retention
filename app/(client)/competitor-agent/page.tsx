import Link from 'next/link'
import {
  PageHeading,
  Panel,
  Notice,
  Field,
  controlClass
} from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { referenceWorkspace } from '@/features/references/data'
import { referenceAction } from '@/features/references/actions'
import { PlaybookPanel, ReferenceJobs } from '@/features/references/panels'
export default async function CompetitorAgentPage() {
  const { data, context, error } = await referenceWorkspace(),
    owner = context.tenantRole === 'owner'
  if (!data) return <Notice error>{error}</Notice>
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Competitor intelligence"
        description="Shared fictional capture, private workspace rules, transparent evidence and structural playbooks. No opt-in email or live capture is sent."
      />
      <div className="space-y-6">
        <Panel title="Subscribe to a synthetic reference source">
          {owner ? (
            <ActionForm
              action={referenceAction}
              className="grid gap-4 sm:grid-cols-2"
            >
              <input name="kind" type="hidden" value="subscribe" />
              <Field label="Fictional capture domain">
                <TextField
                  name="domain"
                  required
                  placeholder="reference.example"
                />
              </Field>
              <Field label="Reference label">
                <TextField name="label" required />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Private workspace rules">
                  <textarea
                    name="rules"
                    className={controlClass}
                    rows={2}
                    maxLength={5000}
                  />
                </Field>
              </div>
              <div>
                <SubmitButton>Save private subscription</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <Notice>Read-only evidence. Owner manages subscriptions.</Notice>
          )}
        </Panel>
        <Panel title="Subscribed capture profiles">
          <div className="grid gap-5 lg:grid-cols-3">
            {data.subscriptions.map((s) => (
              <article
                key={s.id}
                className="min-w-0 rounded-xl border border-[var(--line)] p-4 text-sm"
              >
                <h3 className="font-semibold">{s.label}</h3>
                <p className="mt-2 break-words">
                  {s.capture?.domain ?? 'Inactive source'} ·{' '}
                  {s.active
                    ? (s.capture?.status ?? 'opt-in pending')
                    : 'inactive'}{' '}
                  · Synthetic
                </p>
                <p className="mt-2">{s.profile.emails}/10 captured emails</p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  {s.profile.emailsPerWeek ?? '—'} emails/week ·{' '}
                  {s.profile.discountShare ?? '—'}% discounted ·{' '}
                  {s.profile.spanDays} day evidence span
                </p>
                {s.health && <Notice error>{s.health}</Notice>}
                <p className="my-3 text-xs">
                  {s.profile.themes.join(' · ') || 'No extracted themes yet.'}
                </p>
                <Link href={`/competitor-agent/${s.id}`} className="underline">
                  Profile, sequences and emails
                </Link>
                {owner && (
                  <>
                    <ActionForm action={referenceAction} className="mt-4">
                      <input type="hidden" name="kind" value="capture" />
                      <input type="hidden" name="subscription" value={s.id} />
                      {s.active && (
                        <SubmitButton variant="secondary">
                          Queue fixture capture for {s.label}
                        </SubmitButton>
                      )}
                    </ActionForm>
                    <ActionForm
                      key={s.revision}
                      action={referenceAction}
                      className="mt-4 grid gap-3"
                    >
                      <input type="hidden" name="kind" value="update" />
                      <input type="hidden" name="subscription" value={s.id} />
                      <input type="hidden" name="revision" value={s.revision} />
                      <Field label={`Private rules for ${s.label}`}>
                        <textarea
                          name="rules"
                          className={controlClass}
                          rows={2}
                          defaultValue={s.private_rules}
                        />
                      </Field>
                      <Field label={`Subscription status for ${s.label}`}>
                        <select
                          name="active"
                          className={controlClass}
                          defaultValue={String(s.active)}
                        >
                          <option value="true">Active</option>
                          <option value="false">Inactive</option>
                        </select>
                      </Field>
                      <SubmitButton variant="secondary">
                        Save source rules
                      </SubmitButton>
                    </ActionForm>
                  </>
                )}
              </article>
            ))}
          </div>
          {!data.subscriptions.length && (
            <Notice>
              No subscriptions. Add fictional sources to start a persisted
              capture job.
            </Notice>
          )}
        </Panel>
        <p className="text-sm">
          <Link className="underline" href="/email-library">
            Open subscribed email library
          </Link>
        </p>
        <PlaybookPanel data={data} owner={owner} />
        <ReferenceJobs data={data} owner={owner} />
      </div>
    </div>
  )
}
