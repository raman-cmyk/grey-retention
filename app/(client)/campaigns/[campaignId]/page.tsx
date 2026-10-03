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
import { campaignDetail } from '@/features/campaigns/data'
import { CampaignEditor } from '@/features/campaigns/editor'
import { approveCalendar, addNote } from '@/features/campaigns/actions'
export default async function CampaignPage({
  params
}: {
  params: Promise<{ campaignId: string }>
}) {
  const { campaignId } = await params
  if (!z.uuid().safeParse(campaignId).success) notFound()
  const detail = await campaignDetail(campaignId)
  const { campaign, context, data, error } = detail
  if (!campaign) {
    if (error) return <Notice error>{error}</Notice>
    notFound()
  }
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title={campaign.title}
        description={`${campaign.synthetic ? 'Synthetic demo · ' : ''}${new Intl.DateTimeFormat('en', { timeZone: campaign.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date(campaign.planned_at))} · ${campaign.timezone}`}
      />
      {error && <Notice error>{error}</Notice>}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Panel title="Calendar entry">
          <CampaignEditor
            campaign={campaign}
            products={data!.products}
            offers={data!.offers}
            audiences={data!.audiences}
          />
        </Panel>
        <div className="space-y-6">
          <Panel title="Review status">
            <dl className="space-y-3 text-sm">
              {[
                ['Calendar', campaign.calendar_state],
                ['Copy', campaign.copy_state],
                ['Design', campaign.design_state],
                ['Delivery', campaign.delivery_state]
              ].map(([k, v]) => (
                <div className="flex justify-between gap-3" key={k}>
                  <dt>{k}</dt>
                  <dd>{v.replaceAll('_', ' ')}</dd>
                </div>
              ))}
            </dl>
            {context.tenantRole === 'owner' &&
              campaign.calendar_state !== 'approved' && (
                <ActionForm action={approveCalendar} className="mt-5">
                  <input type="hidden" name="id" value={campaign.id} />
                  <input
                    type="hidden"
                    name="revision"
                    value={campaign.calendar_revision}
                  />
                  <SubmitButton>
                    Approve calendar v{campaign.calendar_revision}
                  </SubmitButton>
                </ActionForm>
              )}
            <p className="mt-4 text-xs leading-5 text-[var(--text-muted)]">
              Brand owner approves each exact version. Assignment and escalation
              belong to platform admin.
            </p>
          </Panel>
          <Panel title="Approval history">
            {detail.approvals.length ? (
              detail.approvals.map((a) => (
                <p key={a.id} className="mb-2 text-xs">
                  {a.kind} v{a.revision} ·{' '}
                  {new Date(a.created_at).toLocaleDateString('en', {
                    timeZone: context.timezone
                  })}
                </p>
              ))
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                No approvals yet.
              </p>
            )}
          </Panel>
        </div>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Workspace notes">
          {detail.comments.map((c) => (
            <p
              key={c.id}
              className="mb-3 rounded-lg bg-[var(--surface-hover)] p-3 text-sm whitespace-pre-wrap"
            >
              {c.body}
            </p>
          ))}
          <ActionForm action={addNote}>
            <input type="hidden" name="id" value={campaign.id} />
            <Field label="Add a note">
              <textarea
                name="body"
                className={controlClass}
                rows={3}
                required
                maxLength={5000}
              />
            </Field>
            <div className="mt-3">
              <SubmitButton variant="secondary">Save note</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
        <Panel title="Campaign audit">
          <ol className="space-y-3 text-sm">
            {detail.events.map((e) => (
              <li key={e.id}>
                <span className="font-medium">
                  {e.action.replaceAll('_', ' ')}
                </span>
                <time className="ml-2 text-xs text-[var(--text-muted)]">
                  {new Intl.DateTimeFormat('en', {
                    timeZone: context.timezone,
                    dateStyle: 'short',
                    timeStyle: 'short'
                  }).format(new Date(e.created_at))}
                </time>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  )
}
