import { Mail } from 'lucide-react'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { AdvancedDetails, DetailHero } from '@/components/ui/detail-page'
import { Pill } from '@/components/ui/pill'
import type { PillTone } from '@/lib/campaign-status'
import { formatBrandDateTime, timezoneLabel } from '@/lib/brand-time'
import { EmailPreviewCard } from '@/features/email-generation/preview-card'
import { formatCount, formatMoney } from '@/features/klaviyo-data/summary'
import type { AudienceRef, KlaviyoCampaign } from '@/lib/providers/klaviyo-read'
import {
  InfoCard,
  KlaviyoDetail,
  loadKlaviyo,
  NotConnected,
  smallLabel
} from '@/features/klaviyo-detail/parts'
import { percent } from '@/features/klaviyo-detail/words'

const tones: Record<KlaviyoCampaign['status'], PillTone> = {
  sent: 'solid',
  scheduled: 'info',
  draft: 'warning',
  cancelled: 'danger'
}

function Chips({
  title,
  audiences
}: {
  title: string
  audiences: AudienceRef[]
}) {
  return (
    <div>
      <h3 className={smallLabel}>{title}</h3>
      {audiences.length ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {audiences.map((a) => (
            <li
              key={a.id}
              className="rounded-full border border-[var(--line-strong)] px-3 py-1 text-sm"
            >
              {a.name}
              <span className="ml-1.5 text-xs text-[var(--text-muted)]">
                {a.kind === 'list' ? 'List' : 'Segment'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-[var(--text-muted)]">None</p>
      )}
    </div>
  )
}

/** Klaviyo campaign detail (spec §4). Local campaigns keep /campaigns/:id. */
export default async function KlaviyoCampaignPage({
  params,
  searchParams
}: {
  params: Promise<{ klaviyoId: string }>
  searchParams: Promise<{ from?: string | string[] }>
}) {
  const [{ klaviyoId }, { from }, { timezone, data }] = await Promise.all([
    params,
    searchParams,
    loadKlaviyo()
  ])
  if (data.state !== 'sample') return <NotConnected from={from} data={data} />
  const campaign = data.snapshot.campaigns.find((c) => c.id === klaviyoId)
  if (!campaign) notFound()
  const tz = timezone
  const when = (value: string | null) =>
    value ? `${formatBrandDateTime(value, tz)} (${timezoneLabel(tz)})` : null
  const stats = campaign.stats
  return (
    <KlaviyoDetail from={from} sample>
      <DetailHero
        icon={Mail}
        kind="Campaign"
        title={campaign.name}
        status={<Pill tone={tones[campaign.status]}>{campaign.status}</Pill>}
      />
      <div className="grid gap-5 sm:grid-cols-3">
        <InfoCard title="Channel" value="✉ Email" />
        <InfoCard
          title="Send time"
          value={
            campaign.sendTime
              ? formatBrandDateTime(campaign.sendTime, tz)
              : 'Not scheduled'
          }
          line={campaign.sendTime ? timezoneLabel(tz) : undefined}
        />
        <InfoCard
          title="Created"
          value={formatBrandDateTime(campaign.created, tz)}
          line={timezoneLabel(tz)}
        />
      </div>
      {stats && (
        <section
          aria-label="How it did"
          className="rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-6"
        >
          <h2 className="mb-4 text-base font-semibold">How it did</h2>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {(
              [
                ['Recipients', formatCount(stats.recipients)],
                ['Open rate', percent(stats.opens, stats.recipients)],
                ['Click rate', percent(stats.clicks, stats.recipients)],
                ['Revenue', formatMoney(stats.revenue)],
                ['Orders', formatCount(stats.orders)]
              ] as const
            ).map(([name, value]) => (
              <div key={name}>
                <dt className={smallLabel}>{name}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <Card title="What was sent">
        <h3 className={smallLabel}>Message label (internal)</h3>
        <p className="mt-1 text-sm">{campaign.templateName}</p>
        <dl className="mt-4 space-y-3 rounded-[var(--radius-control)] bg-[var(--surface-hover)] p-4 text-sm">
          <div>
            <dt className={smallLabel}>From</dt>
            <dd className="mt-0.5">
              <strong>{campaign.fromLabel}</strong>{' '}
              <span className="text-[var(--text-muted)]">
                &lt;{campaign.fromEmail}&gt;
              </span>
            </dd>
          </div>
          <div>
            <dt className={smallLabel}>Subject</dt>
            <dd className="mt-0.5">{campaign.subject}</dd>
          </div>
          <div>
            <dt className={smallLabel}>Preview text</dt>
            <dd className="mt-0.5 italic">“{campaign.previewText}”</dd>
          </div>
        </dl>
      </Card>
      <EmailPreviewCard
        html={campaign.html}
        title={`Preview of ${campaign.name}`}
        templateName={campaign.templateName}
        source="klaviyo"
      />
      <Card title="Who received this">
        <p className="-mt-2 mb-4 text-sm text-[var(--text-muted)]">
          The lists and segments this campaign was sent to.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Chips title="Included" audiences={campaign.included} />
          <Chips title="Excluded" audiences={campaign.excluded} />
        </div>
      </Card>
      <Card title="How it was sent">
        <p className="text-sm font-medium">Static</p>
        <p className="text-sm text-[var(--text-muted)]">
          Sent at a fixed date and time you scheduled.
        </p>
        <p className="mt-3 text-sm">
          {campaign.sendTime
            ? `Scheduled for: ${when(campaign.sendTime)}`
            : 'Not scheduled yet.'}
        </p>
        {campaign.localTime && (
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Sent in each recipient&apos;s local timezone.
          </p>
        )}
      </Card>
      <AdvancedDetails
        objectId={campaign.id}
        attributes={{
          name: campaign.name,
          status: campaign.status,
          send_time: campaign.sendTime,
          send_strategy: 'static',
          is_local: campaign.localTime,
          subject: campaign.subject,
          preview_text: campaign.previewText,
          from_label: campaign.fromLabel,
          from_email: campaign.fromEmail,
          created: campaign.created,
          updated: campaign.updated
        }}
        linked={[
          { label: 'Included', items: campaign.included.map((a) => a.name) },
          { label: 'Excluded', items: campaign.excluded.map((a) => a.name) },
          { label: 'Tags', items: [] }
        ]}
      />
    </KlaviyoDetail>
  )
}
