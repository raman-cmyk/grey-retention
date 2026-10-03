import Image from 'next/image'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import {
  PageHeading,
  Panel,
  Notice,
  Field,
  controlClass
} from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { assignmentDetail } from '@/features/designers/data'
import { submitDesign } from '@/features/designers/actions'
export default async function AssignmentPage({
  params
}: {
  params: Promise<{ assignmentId: string }>
}) {
  const { assignmentId } = await params
  if (!z.uuid().safeParse(assignmentId).success) notFound()
  const data = await assignmentDetail(assignmentId)
  if (!data) notFound()
  const b = data.brief
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title={b.title}
        description={`Approved copy v${b.copyRevision} · due ${data.dueAt} UTC · ${data.state.replaceAll('_', ' ')}`}
      />
      {data.stale && (
        <Notice error>
          The approved brief changed. Platform admin must assign the current
          version before submission.
        </Notice>
      )}
      {data.error && <Notice error>{data.error}</Notice>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Inspiration pack and approved brief">
          <dl className="space-y-4 text-sm">
            {[
              ['Brand', b.brandName],
              ['Brand revision', String(b.brandRevision ?? 'Snapshot')],
              ['Sequence brief', b.sequenceBrief ?? 'Standalone entry'],
              [
                'Brand kit',
                b.kit
                  ? `${b.kit.colors.join(', ')} · ${b.kit.fonts.join(', ')} · ${b.kit.approved ? 'owner approved' : 'awaiting approval'}`
                  : 'No kit in the assigned snapshot'
              ],
              ['Subject', b.subject],
              ['Preview', b.preheader],
              ['Body', b.body],
              ['CTA', b.cta],
              ['Destination', b.url],
              ['Voice', b.voice],
              ['Prohibitions', b.prohibitions],
              [
                'Reference structure',
                b.referenceStructure || 'No external structure selected.'
              ]
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="mb-1 font-semibold">{k}</dt>
                <dd className="leading-6 break-words whitespace-pre-wrap">
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {data.inspirationAssets.map(
              (a) =>
                a.preview && (
                  <Image
                    key={a.path}
                    src={a.preview}
                    width={200}
                    height={200}
                    unoptimized
                    alt="Private asset included in this assigned inspiration pack"
                    className="h-auto w-full rounded border border-[var(--line)]"
                  />
                )
            )}
          </div>
        </Panel>
        <div className="space-y-6">
          <Panel title="Submit a design revision">
            {!data.stale &&
            ['assigned', 'revisions_requested'].includes(data.state) ? (
              <ActionForm action={submitDesign} className="grid gap-4">
                <input name="assignment" type="hidden" value={assignmentId} />
                <input
                  name="revision"
                  type="hidden"
                  value={data.designRevision}
                />
                <Field label="Design image">
                  <input
                    type="file"
                    name="design"
                    accept="image/png,image/jpeg,image/webp"
                    required
                    className={controlClass}
                  />
                </Field>
                <p className="text-xs text-[var(--text-muted)]">
                  Private PNG, JPEG or WebP, maximum 10 MiB. The server checks
                  file signatures and assignment access.
                </p>
                <Field label="Submission notes">
                  <textarea
                    name="notes"
                    className={controlClass}
                    rows={4}
                    maxLength={5000}
                  />
                </Field>
                <div>
                  <SubmitButton>Submit design version</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <Notice>
                Waiting for owner review or a renewed approved brief.
              </Notice>
            )}
          </Panel>
          <Panel title="Owner section feedback">
            {data.reviews.length ? (
              data.reviews.map((r) => (
                <article className="mb-4 text-sm" key={r.id}>
                  <h3 className="font-semibold">
                    {r.decision} · {r.section}
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap">{r.feedback}</p>
                </article>
              ))
            ) : (
              <Notice>No owner feedback yet.</Notice>
            )}
          </Panel>
        </div>
      </div>
      <Panel title="Submission history" className="mt-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {data.submissions.map((s) => (
            <article key={s.id}>
              <h3 className="mb-3 font-semibold">
                Design v{s.revision} · copy v{s.copy_revision}
              </h3>
              {s.preview && (
                <Image
                  src={s.preview}
                  alt={`Your submitted design version ${s.revision}`}
                  width={600}
                  height={800}
                  unoptimized
                  className="h-auto max-h-[40rem] w-auto max-w-full rounded-lg border border-[var(--line)]"
                />
              )}
              <p className="mt-3 text-sm">{s.notes}</p>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  )
}
