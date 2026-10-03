import { Panel, Notice } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { DataTable } from '@/components/ui/data-table'
import { referenceAction } from './actions'
import type { referenceWorkspace } from './data'
type Data = NonNullable<Awaited<ReturnType<typeof referenceWorkspace>>['data']>
export function ReferenceJobs({ data, owner }: { data: Data; owner: boolean }) {
  return (
    <Panel title="Capture and synthesis jobs">
      {owner && (
        <ActionForm action={referenceAction} className="mb-4">
          <input type="hidden" name="kind" value="run" />
          <SubmitButton variant="secondary">
            Run reference fixture jobs
          </SubmitButton>
        </ActionForm>
      )}
      <DataTable
        caption="Persisted reference jobs"
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
    </Panel>
  )
}
export function PlaybookPanel({ data, owner }: { data: Data; owner: boolean }) {
  return (
    <Panel title="Tenant-private structural playbooks">
      <Notice>
        Patterns are synthetic and evidence-linked. They guide structure and
        timing; source wording is never fed into fixture client copy. Owner
        facts, prohibitions and planning guards take precedence.
      </Notice>
      {owner && (
        <ActionForm action={referenceAction} className="mt-4">
          <input type="hidden" name="kind" value="playbook" />
          <SubmitButton variant="secondary">Queue brand playbook</SubmitButton>
        </ActionForm>
      )}
      {data.playbooks.length ? (
        data.playbooks.map((p) => (
          <article
            key={p.id}
            className="mt-5 rounded-lg border border-[var(--line)] p-4 text-sm"
          >
            <h3 className="font-semibold">
              Playbook v{p.revision} · brand v{p.brand_revision} · Synthetic
            </h3>
            <ul className="my-3 list-disc space-y-2 pl-5">
              {(p.patterns as string[]).map((pattern, i) => (
                <li key={i}>{pattern}</li>
              ))}
            </ul>
            <p className="text-xs text-[var(--text-muted)]">
              {p.source_count} complete sources · {p.evidence_ids.length} email
              evidence records · {p.created_at}
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer">
                Evidence IDs and subscription versions
              </summary>
              <p className="mt-2 text-xs break-all">
                {p.evidence_ids.join(', ')}
              </p>
              <p className="mt-2 text-xs break-all">
                {JSON.stringify(p.subscription_revisions)}
              </p>
            </details>
          </article>
        ))
      ) : (
        <p className="mt-4 text-sm text-[var(--text-muted)]">
          No playbook yet. Synthesis requires an approved current brand and
          three LIVE sources with ten emails each.
        </p>
      )}
    </Panel>
  )
}
