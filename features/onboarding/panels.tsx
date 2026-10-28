import { Panel, Notice, Field, controlClass } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { TextField } from '@/components/ui/text-field'
import { DataTable } from '@/components/ui/data-table'
import { onboardingAction } from './actions'
import type { onboardingWorkspace } from './data'
type Setup = NonNullable<
  Awaited<ReturnType<typeof onboardingWorkspace>>['setup']
>
export function ReadinessPanel({ setup }: { setup: Setup }) {
  return (
    <Panel
      title={`Learning readiness · ${setup.readiness.ready ? 'fixture evidence complete' : 'requirements remaining'}`}
    >
      <Notice>
        Development evidence only. Classification and connections are simulated;
        real vision accuracy and learning quality remain unverified. Setup
        resumes from these persisted inputs.
      </Notice>
      <ul className="mt-4 space-y-4 text-sm">
        {setup.readiness.gates.map((g) => (
          <li key={g.name}>
            <strong>
              {g.met ? '✓' : '○'} {g.name}
            </strong>
            <p className="mt-1 text-[var(--text-muted)]">{g.detail}</p>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
export function SetupJobs({ setup, owner }: { setup: Setup; owner: boolean }) {
  return (
    <Panel title="Setup jobs and resumable state">
      {owner && (
        <ActionForm action={onboardingAction} className="mb-4">
          <input type="hidden" name="kind" value="run" />
          <SubmitButton variant="secondary">Run queued setup jobs</SubmitButton>
        </ActionForm>
      )}
      {setup.jobs.length ? (
        <DataTable
          caption="Persisted onboarding jobs"
          headers={['Operation', 'State', 'Attempts', 'Diagnostic']}
        >
          {setup.jobs.map((j) => (
            <tr key={j.id}>
              <td className="p-3">{j.kind}</td>
              <td className="p-3">{j.status}</td>
              <td className="p-3">{j.attempt}/4</td>
              <td className="p-3">{j.error_code ?? '—'}</td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <Notice>No setup jobs yet.</Notice>
      )}
    </Panel>
  )
}
export function BrandEvidence({
  setup,
  owner
}: {
  setup: Setup
  owner: boolean
}) {
  return (
    <div className="space-y-6">
      <ReadinessPanel setup={setup} />
      <Panel title="Brand kit extraction and owner review">
        <p className="mb-4 text-sm text-[var(--text-muted)]">
          Fixture text extraction recognizes six-digit hex colors and “font:
          Name”. It does not inspect PDF documents, fetch a website, or infer
          unprovided facts.
        </p>
        {owner && (
          <ActionForm action={onboardingAction} className="grid gap-4">
            <input type="hidden" name="kind" value="queue" />
            <input type="hidden" name="job" value="brand.extract" />
            <Field label="Brand kit source text">
              <textarea
                name="sourceText"
                className={controlClass}
                rows={3}
                required
                maxLength={10000}
                placeholder="#18302C; font: Inter"
              />
            </Field>
            <div>
              <SubmitButton variant="secondary">
                Queue fixture kit extraction
              </SubmitButton>
            </div>
          </ActionForm>
        )}
        {setup.kit && (
          <div className="mt-5 text-sm">
            <p>Kit v{setup.kit.revision} · Synthetic extraction</p>
            <p className="mt-2">
              Colors: {setup.kit.colors.join(', ') || 'No supplied colors'}
            </p>
            <p>Fonts: {setup.kit.fonts.join(', ') || 'No supplied fonts'}</p>
            {owner && !setup.kit.approved_by && (
              <ActionForm action={onboardingAction} className="mt-4">
                <input type="hidden" name="kind" value="kit_approve" />
                <input
                  type="hidden"
                  name="revision"
                  value={setup.kit.revision}
                />
                <SubmitButton>Approve kit v{setup.kit.revision}</SubmitButton>
              </ActionForm>
            )}
            {setup.kit.approved_by && (
              <Notice>Owner approved this kit version.</Notice>
            )}
          </div>
        )}
      </Panel>
      <Panel title="Brand correction and approval history">
        <DataTable
          caption="Recorded brand versions and owner events"
          headers={['Version', 'Event', 'Recorded UTC']}
        >
          {setup.events.map((e) => (
            <tr key={e.id}>
              <td className="p-3">v{e.revision}</td>
              <td className="p-3">{e.action.replaceAll('_', ' ')}</td>
              <td className="p-3">{new Date(e.created_at).toISOString()}</td>
            </tr>
          ))}
        </DataTable>
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-medium">
            Saved fact snapshots
          </summary>
          {setup.versions.map((v) => (
            <article
              className="my-3 rounded-lg bg-[var(--surface-muted)] p-4 text-xs break-words whitespace-pre-wrap"
              key={v.id}
            >
              <strong>Version {v.revision}</strong>
              <p>{JSON.stringify(v.snapshot, null, 2)}</p>
            </article>
          ))}
        </details>
      </Panel>
      <SetupJobs setup={setup} owner={owner} />
    </div>
  )
}
export function StockRefresh({
  product
}: {
  product: { id: string; title: string; stock: number }
}) {
  return (
    <ActionForm
      action={onboardingAction}
      className="mt-3 flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="kind" value="stock" />
      <input type="hidden" name="product" value={product.id} />
      <Field label={`Verified stock for ${product.title}`}>
        <TextField
          name="stock"
          type="number"
          min={0}
          defaultValue={product.stock}
          className="max-w-40"
        />
      </Field>
      <SubmitButton variant="secondary">Refresh stock evidence</SubmitButton>
    </ActionForm>
  )
}
