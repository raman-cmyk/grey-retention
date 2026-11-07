import { notFound } from 'next/navigation'
import { z } from 'zod'
import { DetailPage } from '@/components/ui/detail-page'
import { Notice } from '@/components/ui/workspace'
import { assignmentDetail } from '@/features/designers/data'
import { SubmitDesignCard } from '@/features/designers/submit-card'
import {
  ApprovedCopy,
  BrandFacts,
  BriefHeader,
  InspirationPack,
  OwnerFeedback,
  SubmissionHistory
} from '@/features/designers/assignment-parts'
import { assignmentStatus, dueLine } from '@/features/designers/model'

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
        due={dueLine(data.dueAt, data.state, now, data.stale)}
      />
      {data.error && <Notice error>{data.error}</Notice>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
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
          <SubmitDesignCard
            assignmentId={assignmentId}
            designRevision={data.designRevision}
            state={data.state}
            stale={data.stale}
          />
          <OwnerFeedback reviews={data.reviews} now={now} />
        </div>
      </div>
      <SubmissionHistory submissions={data.submissions} now={now} />
    </DetailPage>
  )
}
