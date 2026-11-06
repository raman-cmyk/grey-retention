import { Mail } from 'lucide-react'
import type { Route } from 'next'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Pill } from '@/components/ui/pill'
import { formatBrandDateTime, timezoneLabel } from '@/lib/brand-time'
import { EmailPreviewCard } from '@/features/email-generation/preview-card'
import { HistoryBack } from '@/features/klaviyo-detail/history-back'
import {
  loadKlaviyo,
  NotConnected,
  smallLabel
} from '@/features/klaviyo-detail/parts'

export default async function FlowMessagePage({
  params
}: {
  params: Promise<{ messageId: string }>
}) {
  const [{ messageId }, { timezone, data }] = await Promise.all([
    params,
    loadKlaviyo()
  ])
  if (data.state !== 'sample')
    return <NotConnected from={undefined} data={data} />
  const flow = data.snapshot.flows.find((f) =>
    f.messages.some((m) => m.id === messageId)
  )
  const message = flow?.messages.find((m) => m.id === messageId)
  if (!flow || !message) notFound()
  const tz = timezone
  return (
    <div className="mx-auto w-full max-w-[var(--gr-detail-max)] space-y-5">
      <HistoryBack fallback={`/flows/${flow.id}?from=flows` as Route} />
      <p className="text-xs text-[var(--text-muted)]">
        <strong className="font-semibold text-[var(--warning-ink)]">
          Sample Klaviyo data
        </strong>{' '}
        — not a real account.
      </p>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${smallLabel} inline-flex items-center gap-1.5`}>
            <Mail className="size-4" aria-hidden /> Flow message · {flow.name}
          </span>
          <Pill
            mono
            className="ml-auto max-w-[16rem]"
            title={message.templateName}
          >
            {message.templateName}
          </Pill>
        </div>
        <h1 className="tracking-display mt-3 font-serif text-[1.875rem] leading-tight font-normal break-words">
          {message.subject}
        </h1>
        <p className="mt-1 text-[var(--text-muted)] italic">
          “{message.previewText}”
        </p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className={smallLabel}>From</dt>
            <dd className="mt-0.5 text-sm break-words">
              <strong>{message.fromLabel}</strong>{' '}
              <span className="text-[var(--text-muted)]">
                &lt;{message.fromEmail}&gt;
              </span>
            </dd>
          </div>
          <div>
            <dt className={smallLabel}>Reply to</dt>
            <dd className="mt-0.5 text-sm break-words">
              {message.replyTo ?? '—'}
            </dd>
          </div>
          <div>
            <dt className={smallLabel}>Template updated</dt>
            <dd className="mt-0.5 text-sm">
              {formatBrandDateTime(message.templateUpdated, tz)}{' '}
              <span className="text-[var(--text-muted)]">
                ({timezoneLabel(tz)})
              </span>
            </dd>
          </div>
        </dl>
      </Card>
      <EmailPreviewCard
        html={message.html}
        title={`Preview of ${message.subject}`}
        templateName={message.templateName}
        source="klaviyo"
      />
    </div>
  )
}
