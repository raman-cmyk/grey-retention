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
import { onboardingWorkspace } from '@/features/onboarding/data'
import { onboardingAction } from '@/features/onboarding/actions'
import { ReadinessPanel, SetupJobs } from '@/features/onboarding/panels'
export default async function ConnectionsPage() {
  const { setup, context, error } = await onboardingWorkspace(),
    owner = context.tenantRole === 'owner'
  if (!setup)
    return <Notice error>{error ?? 'Connection evidence unavailable.'}</Notice>
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Fixture connections"
        description="Read-only synthetic sources. These controls persist diagnostics and queue fixtures; they never connect a live account."
      />
      <div className="space-y-6">
        <ReadinessPanel setup={setup} />
        <div className="grid gap-5 lg:grid-cols-3">
          {(['klaviyo', 'shopify', 'drive'] as const).map((provider) => {
            const c = setup.connections.find((c) => c.provider === provider)
            return (
              <Panel key={provider} title={provider}>
                <p className="mb-3 text-sm">
                  {c?.status ?? 'disconnected'} · Fixture only
                </p>
                <p className="mb-4 text-xs break-words text-[var(--text-muted)]">
                  Last sync: {c?.last_sync_at ?? 'Not synced'}
                  {c?.last_error ? ` · ${c.last_error}` : ''}
                </p>
                {owner && (
                  <>
                    <ActionForm
                      key={c?.revision ?? 0}
                      action={onboardingAction}
                      className="grid gap-3"
                    >
                      <input type="hidden" name="kind" value="connection" />
                      <input type="hidden" name="provider" value={provider} />
                      <Field label={`${provider} fixture status`}>
                        <select
                          name="status"
                          className={controlClass}
                          defaultValue={c?.status ?? 'connected'}
                        >
                          {[
                            'connected',
                            'disconnected',
                            'expired',
                            'error'
                          ].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </select>
                      </Field>
                      {provider === 'drive' ? (
                        <Field label="Read-only fixture folder">
                          <TextField
                            name="folder"
                            defaultValue={
                              c?.folder_id ?? 'fixture:brand-assets'
                            }
                            required
                          />
                        </Field>
                      ) : (
                        <input type="hidden" name="folder" value="" />
                      )}
                      <SubmitButton variant="secondary">
                        Save {provider} fixture
                      </SubmitButton>
                    </ActionForm>
                    {provider !== 'klaviyo' && c?.status === 'connected' && (
                      <ActionForm action={onboardingAction} className="mt-4">
                        <input type="hidden" name="kind" value="queue" />
                        <input
                          type="hidden"
                          name="job"
                          value={
                            provider === 'drive'
                              ? 'drive.sync'
                              : 'commerce.sync'
                          }
                        />
                        <input type="hidden" name="sourceText" value="" />
                        <SubmitButton>
                          Queue {provider} fixture sync
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </>
                )}
              </Panel>
            )
          })}
        </div>
        <p className="text-sm">
          <Link href="/assets" className="underline">
            Review private assets and matches
          </Link>{' '}
          ·{' '}
          <Link href="/brand" className="underline">
            Brand facts, kit and catalog
          </Link>
        </p>
        <SetupJobs setup={setup} owner={owner} />
      </div>
    </div>
  )
}
