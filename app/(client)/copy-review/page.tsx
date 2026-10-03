import Link from 'next/link'
import type { Route } from 'next'
import { PageHeading, Panel, Notice, Field } from '@/components/ui/workspace'
import { SubmitButton } from '@/components/ui/action-form'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { TextField } from '@/components/ui/text-field'
import { campaignWorkspace } from '@/features/campaigns/data'
import { planningData } from '@/features/planning/data'
import { PlanningCommand, PlanningJobs } from '@/features/planning/panels'
import { localWeek } from '@/features/planning/guards'
export default async function CopyReview({
  searchParams
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const { context, data, error } = await campaignWorkspace(),
    p = await searchParams
  const week = /^\d{4}-\d{2}-\d{2}$/.test(p.week ?? '')
    ? localWeek(`${p.week}T12:00:00Z`, context.timezone)
    : localWeek(new Date().toISOString(), context.timezone)
  const planning = await planningData(context.tenantId),
    owner = context.tenantRole === 'owner'
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Weekly copy review"
        description={`Exact versions for the tenant-local week of ${week}. Owner approval is atomic and expires after 30 minutes.`}
      />
      {error || !data || !planning ? (
        <Notice error>{error ?? 'Review data unavailable.'}</Notice>
      ) : (
        <>
          <form className="mb-5 flex items-end gap-3">
            <Field label="Week containing date">
              <TextField type="date" name="week" defaultValue={week} />
            </Field>
            <button className="rounded bg-[var(--brand-primary)] p-3 text-white">
              Show week
            </button>
          </form>
          {owner && (
            <div className="mb-5 flex flex-wrap gap-3">
              {(['queue_week', 'review_week'] as const).map((kind) => (
                <PlanningCommand key={kind} kind={kind}>
                  <input name="week" type="hidden" value={week} />
                  <SubmitButton variant="secondary">
                    {kind === 'queue_week'
                      ? 'Queue approved-entry copy'
                      : 'Prepare exact weekly review'}
                  </SubmitButton>
                </PlanningCommand>
              ))}
            </div>
          )}
          <Panel title="Approved calendar entries">
            {data.campaigns
              .filter(
                (c) =>
                  !c.superseded_by_plan &&
                  c.calendar_state === 'approved' &&
                  localWeek(c.planned_at, c.timezone) === week
              )
              .map((c) => {
                const v = planning.contents.find(
                  (v) =>
                    v.campaign_id === c.id && v.revision === c.copy_revision
                )
                return (
                  <div
                    key={c.id}
                    className="border-b border-[var(--line)] py-4"
                  >
                    <Link
                      className="font-semibold"
                      href={`/campaigns/${c.id}` as Route}
                    >
                      {c.title}
                    </Link>
                    <p className="text-sm">
                      Copy v{c.copy_revision} · {c.copy_state} · validation{' '}
                      {v?.validation_state ?? 'pending'}
                    </p>
                    {v?.validation_errors.length ? (
                      <Notice error>{v.validation_errors.join(', ')}</Notice>
                    ) : null}
                  </div>
                )
              })}
          </Panel>
          {planning.batches
            .filter(
              (b) => b.week_start === week && b.created_by === context.userId
            )
            .slice(0, 1)
            .map((b) => {
              const refs = b.revisions as {
                campaignId: string
                contentId: string
                copyRevision: number
                calendarRevision: number
              }[]
              return (
                <Panel
                  key={b.id}
                  title={`Immutable review batch · ${b.status}`}
                  className="mt-6"
                >
                  <p className="mb-4 text-sm">
                    Review expires {new Date(b.expires_at).toLocaleString('en')}
                    . Confirmed versions: {refs.length}.
                  </p>
                  {refs.map((r) => {
                    const v = planning.contents.find(
                        (v) => v.id === r.contentId
                      ),
                      c = data.campaigns.find((c) => c.id === r.campaignId)
                    return (
                      <article
                        key={r.contentId}
                        className="mb-5 rounded border border-[var(--line)] p-4"
                      >
                        <h3 className="font-semibold">
                          {c?.title} · exact copy v{r.copyRevision}
                        </h3>
                        <p className="mt-2">{v?.subject}</p>
                        <p className="text-sm text-[var(--text-muted)]">
                          {v?.preheader}
                        </p>
                        <p className="my-4 text-sm whitespace-pre-wrap">
                          {v?.body}
                        </p>
                        <p className="text-sm">
                          {v?.cta} → {v?.primary_url}
                        </p>
                        {v?.validation_errors.length ? (
                          <Notice error>
                            {v.validation_errors.join(', ')}
                          </Notice>
                        ) : null}
                        {c?.copy_revision !== r.copyRevision && (
                          <Notice error>
                            Version changed. Prepare a fresh batch.
                          </Notice>
                        )}
                      </article>
                    )
                  })}
                  {owner && b.status === 'open' && (
                    <ConfirmDialog
                      label="Review bulk copy approval"
                      title="Approve displayed copy versions"
                      description="Every displayed immutable version must still be current and pass validation. If one changed, the whole approval fails."
                    >
                      <PlanningCommand kind="approve_batch" id={b.id}>
                        <SubmitButton>
                          Approve exact weekly copy batch
                        </SubmitButton>
                      </PlanningCommand>
                    </ConfirmDialog>
                  )}
                </Panel>
              )
            })}
          {owner && (
            <div className="mt-6">
              <PlanningCommand kind="reminders">
                <SubmitButton variant="secondary">
                  Queue pending-review reminders
                </SubmitButton>
              </PlanningCommand>
            </div>
          )}
          <div className="mt-6">
            <PlanningJobs data={planning} owner={owner} />
          </div>
        </>
      )}
    </div>
  )
}
