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
import { klaviyoMode } from '@/features/connections/live-klaviyo'
import { onboardingAction } from '@/features/onboarding/actions'
import { ReadinessPanel, SetupJobs } from '@/features/onboarding/panels'
import {
  ConnectionsBoard,
  type ConnectionView
} from '@/features/connections/board'
import type { Database } from '@/lib/supabase/database.types'

type Row = Database['public']['Tables']['workspace_connections']['Row']
// Older hosted databases may not have the display columns yet (migration
// 20260914090017); the fields are then undefined and the cards show the
// status only.
function view(row: Row | undefined): ConnectionView | null {
  if (!row) return null
  return {
    status: row.status,
    accountLabel: row.account_label ?? null,
    credentialHint: row.credential_hint ?? null,
    templateCount: row.template_count ?? null,
    mode: row.mode === 'live' ? 'live' : 'fixture'
  }
}

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

export default async function ConnectionsPage() {
  const { setup, context, error } = await onboardingWorkspace(),
    owner = context.tenantRole === 'owner'
  if (!setup)
    return <Notice error>{error ?? 'Connection details unavailable.'}</Notice>
  const rows = setup.connections
  const live = klaviyoMode() === 'live'
  // With live Klaviyo on, the sample tools never touch the Klaviyo connection.
  const tools = live
    ? (['shopify', 'drive'] as const)
    : (['klaviyo', 'shopify', 'drive'] as const)
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="Connections"
        description="Connect your tools to unlock the agents."
      />
      <ConnectionsBoard
        owner={owner}
        live={live}
        klaviyo={view(rows.find((c) => c.provider === 'klaviyo'))}
      />
      <details className="mt-10 rounded-[var(--radius-panel)] border border-[var(--line)] p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Sample data tools
        </summary>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          Test controls for the sample data used before live connections are
          switched on. They never contact Klaviyo or Google Drive. “Sample
          catalog” fills the product list until the live Klaviyo catalog is
          connected.
        </p>
        <div className="mt-6 space-y-6">
          <ReadinessPanel setup={setup} />
          <div className="grid gap-5 lg:grid-cols-3">
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
                        <Field
                          label={`${fixtureName[provider]} fixture status`}
                        >
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
                              provider === 'drive'
                                ? 'drive.sync'
                                : 'commerce.sync'
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
      </details>
    </div>
  )
}
