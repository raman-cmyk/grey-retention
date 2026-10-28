import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { PageHeading, Panel, Notice } from '@/components/ui/workspace'
import { referenceWorkspace } from '@/features/references/data'
export default async function CompetitorProfile({
  params
}: {
  params: Promise<{ subscriptionId: string }>
}) {
  const { subscriptionId } = await params
  if (!z.uuid().safeParse(subscriptionId).success) notFound()
  const { data } = await referenceWorkspace(),
    s = data?.subscriptions.find((s) => s.id === subscriptionId)
  if (!s || !data) notFound()
  const emails = data.emails.filter((e) => e.capture_id === s.capture_id)
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title={s.label}
        description={`${s.capture?.domain ?? 'Inactive'} · ${s.profile.emails} fictional emails · source state ${s.capture?.status ?? 'unavailable'}`}
      />
      <div className="space-y-6">
        <Panel title="Private workspace rules">
          <p className="text-sm whitespace-pre-wrap">
            {s.private_rules || 'No private rules saved.'}
          </p>
        </Panel>
        <Panel title="Capture health and profile">
          {s.health ? (
            <Notice error>{s.health}</Notice>
          ) : (
            <Notice>
              Fixture source has evidence. This does not verify a live mailbox
              or provider.
            </Notice>
          )}
          <p className="mt-4 text-sm">
            {s.profile.emailsPerWeek ?? 'Insufficient evidence for'} emails/week
            across {s.profile.spanDays} days. Discounted sends:{' '}
            {s.profile.discountShare ?? 'unknown'}%.
          </p>
          <p className="mt-2 text-sm">{s.profile.themes.join(' · ')}</p>
          {!s.profile.complete && (
            <p className="mt-3 text-sm">
              Incomplete source: at least ten records are required for playbook
              readiness.
            </p>
          )}
        </Panel>
        <Panel title="Evidence-linked sequence hypotheses">
          {s.sequences.length ? (
            s.sequences.map((q) => (
              <article key={q.id} className="mb-4 text-sm">
                <h3 className="font-semibold">
                  {q.confidence} · {q.evidence_ids.length} records
                </h3>
                <p className="my-2">{q.pattern}</p>
                <p className="text-xs break-all text-[var(--text-muted)]">
                  {q.evidence_ids.join(', ')}
                </p>
              </article>
            ))
          ) : (
            <Notice>
              No supported sequence. A shared subject or nearby date alone does
              not establish one.
            </Notice>
          )}
        </Panel>
        <Panel title="Captured synthetic emails">
          <ul className="space-y-4 text-sm">
            {emails.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/email-library/${e.id}`}
                  className="font-medium underline"
                >
                  {e.subject}
                </Link>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {e.received_at} · Synthetic
                </p>
              </li>
            ))}
          </ul>
          {!emails.length && <Notice>No captured records yet.</Notice>}
        </Panel>
      </div>
    </div>
  )
}
