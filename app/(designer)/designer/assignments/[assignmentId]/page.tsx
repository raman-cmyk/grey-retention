import { notFound } from 'next/navigation'
import { z } from 'zod'
import { Card } from '@/components/ui/card'
import { DetailPage } from '@/components/ui/detail-page'
import { Notice, Field, controlClass } from '@/components/ui/workspace'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { assignmentDetail } from '@/features/designers/data'
import { submitDesign } from '@/features/designers/actions'
import {
  ApprovedCopy,
  BrandFacts,
  BriefHeader,
  InspirationPack,
  OwnerFeedback,
  SubmissionHistory
} from '@/features/designers/assignment-parts'
import {
  assignmentStatus,
  canSubmit,
  closedReason,
  dueLine
} from '@/features/designers/model'

export default async function AssignmentPage({
  params
}: {
  params: Promise<{ assignmentId: string }>
}) {
  const { assignmentId } = await params
  if (!z.uuid().safeParse(assignmentId).success) notFound()
  // Only the assigned designer can read the brief; anyone else gets 404.
  const data = await assignmentDetail(assignmentId)
  if (!data) notFound()
  const b = data.brief
  const now = new Date()
  const status = assignmentStatus(data.state, data.stale)
  return (
    <DetailPage
      backHref="/designer/dashboard"
      backLabel="Back to assignment desk"
    >
      <BriefHeader
        title={b.title}
        brand={b.brandName}
        copyRevision={b.copyRevision}
        status={status}
        due={dueLine(data.dueAt, data.state, now)}
      />
      {data.error && <Notice error>{data.error}</Notice>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          <ApprovedCopy
            subject={b.subject}
            preheader={b.preheader}
            body={b.body}
            cta={b.cta}
            url={b.url}
          />
          <BrandFacts
            brandName={b.brandName}
            brandRevision={b.brandRevision}
            voice={b.voice}
            prohibitions={b.prohibitions}
            sequenceBrief={b.sequenceBrief}
            referenceStructure={b.referenceStructure}
            kit={b.kit}
          />
          <InspirationPack assets={data.inspirationAssets} />
        </div>
        <div className="min-w-0 space-y-5">
          <Card title="Submit a design">
            {canSubmit(data.state, data.stale) ? (
              <ActionForm action={submitDesign} className="grid gap-4">
                <input name="assignment" type="hidden" value={assignmentId} />
                <input
                  name="revision"
                  type="hidden"
                  value={data.designRevision}
                />
                {data.state === 'revisions_requested' && (
                  <p className="text-sm">
                    Read the owner feedback below, then upload the new version.
                  </p>
                )}
                <Field label="Design image">
                  <input
                    type="file"
                    name="design"
                    accept="image/png,image/jpeg,image/webp"
                    required
                    className={controlClass}
                  />
                </Field>
                <p className="text-xs leading-5 text-[var(--text-muted)]">
                  PNG, JPEG or WebP, up to 10 MB. It stays private: only this
                  brand and platform admin can see it.
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
              <p className="text-sm leading-6 text-[var(--text-muted)]">
                {closedReason(data.state, data.stale)}
              </p>
            )}
          </Card>
          <OwnerFeedback reviews={data.reviews} now={now} />
        </div>
      </div>
      <SubmissionHistory submissions={data.submissions} now={now} />
    </DetailPage>
  )
}
