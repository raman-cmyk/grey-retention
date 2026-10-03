import { notFound } from 'next/navigation'
import { z } from 'zod'
import { PageHeading, Panel, Notice } from '@/components/ui/workspace'
import { referenceWorkspace } from '@/features/references/data'
import { microSchema } from '@/features/references/intelligence'
export default async function EmailPreview({
  params
}: {
  params: Promise<{ emailId: string }>
}) {
  const { emailId } = await params
  if (!z.uuid().safeParse(emailId).success) notFound()
  const { data } = await referenceWorkspace(),
    e = data?.emails.find((e) => e.id === emailId)
  if (!e) notFound()
  const micro = microSchema.parse(e.micro)
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title={e.subject}
        description={`Synthetic source · received ${e.received_at} · record ${e.id}`}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Sandboxed safe preview">
          <Notice>
            Text-only escaped preview. Scripts, remote images, forms and
            tracking are excluded.
          </Notice>
          <iframe
            title="Synthetic reference email preview"
            sandbox=""
            srcDoc={e.safe_html}
            className="mt-5 h-[30rem] w-full rounded-lg border border-[var(--line)]"
          />
        </Panel>
        <Panel title="Structural micro record">
          <dl className="space-y-4 text-sm">
            {[
              ['Theme', micro.theme],
              ['Strips', micro.strips.join(' → ')],
              ['Offer code', micro.offerCode ?? 'None'],
              ['Product', micro.product ?? 'Unresolved'],
              ['Discount percent', String(micro.discountPercent)],
              ['Sequence hint', micro.sequenceHint ?? 'None']
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="font-semibold">{k}</dt>
                <dd className="mt-1">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-xs text-[var(--text-muted)]">
            Fixture extraction, not a real email/vision accuracy evaluation. Use
            structure and timing; client copy uses original brand facts.
          </p>
        </Panel>
      </div>
    </div>
  )
}
