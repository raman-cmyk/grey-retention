import { Panel, Field, controlClass } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { klaviyoMode } from '@/features/connections/live-klaviyo'
import { onboardingAction } from '@/features/onboarding/actions'
import type { onboardingWorkspace } from '@/features/onboarding/data'

type Setup = NonNullable<
  Awaited<ReturnType<typeof onboardingWorkspace>>['setup']
>

/**
 * Names in the sample tools. The product fixture still uses the old
 * `shopify` provider row internally (its job needs it), but v2 is Klaviyo
 * only (BUILD_BRIEF D2), so the screen calls it the sample catalog.
 */
const fixtureName = {
  klaviyo: 'klaviyo',
  shopify: 'sample catalog',
  drive: 'drive'
} as const

/**
 * The sample data tools (test controls for the sample data used before
 * live connections are switched on; they never contact Klaviyo or Google
 * Drive). UI-OLDc moved them here from the retired Connections page, whose
 * Klaviyo card is on Settings now; the Assets page they feed keeps them
 * until it is rebuilt.
 */
export function SampleDataTools({
  setup,
  owner
}: {
  setup: Setup
  owner: boolean
}) {
  const live = klaviyoMode() === 'live'
  // With live Klaviyo on, the sample tools offer no Klaviyo panel, and the
  // onboarding action refuses a Klaviyo fixture status (KLV-001).
  const tools = live
    ? (['shopify', 'drive'] as const)
    : (['klaviyo', 'shopify', 'drive'] as const)
  return (
    <details className="rounded-[var(--radius-panel)] border border-[var(--line)] p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Sample data tools
      </summary>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        Test controls for the sample data used before live connections are
        switched on. They never contact Klaviyo or Google Drive. “Sample
        catalog” fills the product list until the live Klaviyo catalog is
        connected.
      </p>
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        {tools.map((provider) => {
          const c = setup.connections.find((c) => c.provider === provider)
          return (
            <Panel key={provider} title={fixtureName[provider]}>
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
                    <Field label={`${fixtureName[provider]} fixture status`}>
                      <select
                        name="status"
                        className={controlClass}
                        defaultValue={c?.status ?? 'connected'}
                      >
                        {['connected', 'disconnected', 'expired', 'error'].map(
                          (s) => (
                            <option key={s}>{s}</option>
                          )
                        )}
                      </select>
                    </Field>
                    {provider === 'drive' ? (
                      <Field label="Read-only fixture folder">
                        <TextField
                          name="folder"
                          defaultValue={c?.folder_id ?? 'fixture:brand-assets'}
                          required
                        />
                      </Field>
                    ) : (
                      <input type="hidden" name="folder" value="" />
                    )}
                    <SubmitButton variant="secondary">
                      Save {fixtureName[provider]} fixture
                    </SubmitButton>
                  </ActionForm>
                  {provider !== 'klaviyo' && c?.status === 'connected' && (
                    <ActionForm action={onboardingAction} className="mt-4">
                      <input type="hidden" name="kind" value="queue" />
                      <input
                        type="hidden"
                        name="job"
                        value={
                          provider === 'drive' ? 'drive.sync' : 'commerce.sync'
                        }
                      />
                      <input type="hidden" name="sourceText" value="" />
                      <SubmitButton>
                        Queue {fixtureName[provider]} fixture sync
                      </SubmitButton>
                    </ActionForm>
                  )}
                </>
              )}
            </Panel>
          )
        })}
      </div>
    </details>
  )
}
