import { ArrowRight, Clock3, Eye, Mail, Workflow } from 'lucide-react'
import type { Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  AdvancedDetails,
  Card,
  DetailHero,
  TimelineCard
} from '@/components/ui/detail-page'
import { Pill } from '@/components/ui/pill'
import { formatMoney } from '@/features/klaviyo-data/summary'
import {
  InfoCard,
  KlaviyoDetail,
  loadKlaviyo,
  NotConnected
} from '@/features/klaviyo-detail/parts'
import {
  flowSteps,
  liveEmailsLine,
  triggerWords
} from '@/features/klaviyo-detail/words'

export default async function FlowPage({
  params,
  searchParams
}: {
  params: Promise<{ flowId: string }>
  searchParams: Promise<{ from?: string | string[] }>
}) {
  const [{ flowId }, { from }, { timezone, data }] = await Promise.all([
    params,
    searchParams,
    loadKlaviyo()
  ])
  if (data.state !== 'sample') return <NotConnected from={from} data={data} />
  const flow = data.snapshot.flows.find((f) => f.id === flowId)
  if (!flow) notFound()
  const steps = flowSteps(flow)
  const trigger = triggerWords(flow)
  const notLive = liveEmailsLine(flow)
  return (
    <KlaviyoDetail from={from}>
      <DetailHero
        icon={Workflow}
        kind="Flow"
        title={flow.name}
        status={
          <Pill tone={flow.status === 'live' ? 'success' : 'warning'}>
            {flow.status}
          </Pill>
        }
      >
        {notLive && (
          <span className="font-medium text-[var(--warning-ink)]">
            {notLive}
          </span>
        )}
      </DetailHero>
      <div className="grid gap-5 sm:grid-cols-3">
        <InfoCard
          tint
          title="Revenue · 30 days"
          value={formatMoney(flow.revenue30d)}
          line="attributed to this flow"
        />
        <InfoCard
          title="What triggers this flow"
          value={trigger.label}
          line={trigger.line}
        />
        <InfoCard
          title="Steps in this flow"
          value={steps.length}
          line="actions in the sequence"
        />
      </div>
      <Card title="Action sequence">
        <p className="-mt-2 mb-4 text-sm text-[var(--text-muted)]">
          The steps Klaviyo runs when this flow triggers.
        </p>
        <ol className="space-y-3">
          {steps.map((step, index) => (
            <li key={step.key} className="flex gap-3">
              <span
                aria-hidden
                className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--brand-primary)] text-xs font-semibold text-[var(--on-brand)]"
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-[var(--line)] p-3">
                {step.kind === 'wait' ? (
                  <p className="flex items-center gap-2 text-sm">
                    <Clock3
                      className="size-4 text-[var(--text-muted)]"
                      aria-hidden
                    />
                    <span className="font-medium">Wait</span>
                    <span className="text-[var(--text-muted)]">
                      {step.text}
                    </span>
                  </p>
                ) : (
                  <>
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <Mail
                        className="size-4 text-[var(--text-muted)]"
                        aria-hidden
                      />
                      <span className="font-medium">
                        Send email · {step.message.name}
                      </span>
                      <Pill
                        tone={
                          step.message.status === 'live' ? 'success' : 'warning'
                        }
                      >
                        {step.message.status}
                      </Pill>
                    </p>
                    <Link
                      href={
                        `/flow-messages/${encodeURIComponent(step.message.id)}` as Route
                      }
                      className="mt-2 flex items-center gap-3 rounded-[var(--radius-small)] bg-[var(--surface-hover)] px-3 py-2 text-sm hover:bg-[var(--line)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-hidden"
                    >
                      <Eye
                        className="size-4 shrink-0 text-[var(--text-muted)]"
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <strong className="block break-words">
                          {step.message.subject}
                        </strong>
                        <span className="text-xs text-[var(--text-muted)]">
                          From: {step.message.fromLabel}
                        </span>
                      </span>
                      <ArrowRight className="size-4 shrink-0" aria-hidden />
                      <span className="sr-only">Open this email</span>
                    </Link>
                  </>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--text-muted)]">
          Using these flow emails as context for AI copy is not connected yet.
        </p>
      </Card>
      <TimelineCard
        created={flow.created}
        updated={flow.updated}
        timezone={timezone}
      />
      <AdvancedDetails
        objectId={flow.id}
        attributes={{
          name: flow.name,
          status: flow.status,
          trigger_type: flow.trigger.kind,
          trigger: flow.trigger.name,
          actions: steps.map((s) =>
            s.kind === 'wait'
              ? {
                  type: 'time-delay',
                  delay_seconds: s.seconds,
                  days_of_week: 'all'
                }
              : { type: 'send-email', message: s.message.id }
          ),
          created: flow.created,
          updated: flow.updated
        }}
        linked={[
          {
            label: 'Flow actions',
            items: steps.map((s) =>
              s.kind === 'wait' ? s.text : s.message.name
            )
          }
        ]}
      />
    </KlaviyoDetail>
  )
}
