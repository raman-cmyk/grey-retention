import {
  ArrowRight,
  CalendarDays,
  FileText,
  Paintbrush,
  Send
} from 'lucide-react'
import { campaignNextStep, type OverviewCampaign } from './overview-model'
import { stepStateWords } from './status'

export function WorkflowNavigation({
  campaign
}: {
  campaign: OverviewCampaign
}) {
  const next = campaignNextStep(campaign) ?? 'Nothing to do now'
  const word = next.toLowerCase()
  const target =
    word.includes('calendar') || word.includes('date')
      ? '#brief'
      : word.includes('copy')
        ? '#copy'
        : word.includes('design')
          ? '#design'
          : '#delivery'
  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-raised)]">
      <nav
        aria-label="Campaign workflow"
        className="grid grid-cols-2 divide-[var(--line)] sm:grid-cols-4 sm:divide-x"
      >
        {[
          {
            label: 'Brief',
            status: stepStateWords('calendar', campaign.calendar_state),
            icon: CalendarDays,
            href: '#brief'
          },
          {
            label: 'Copy',
            status: stepStateWords('copy', campaign.copy_state),
            icon: FileText,
            href: '#copy'
          },
          {
            label: 'Design',
            status: stepStateWords('design', campaign.design_state),
            icon: Paintbrush,
            href: '#design'
          },
          {
            label: 'Delivery',
            status: stepStateWords('delivery', campaign.delivery_state),
            icon: Send,
            href: '#delivery'
          }
        ].map(({ label, status, icon: Icon, href }) => (
          <a
            key={label}
            href={href}
            className="flex items-start gap-3 p-4 hover:bg-[var(--surface-hover)]"
          >
            <Icon
              className="mt-0.5 size-4 shrink-0 text-[var(--text-faint)]"
              aria-hidden
            />
            <div>
              <p className="text-xs font-semibold">{label}</p>
              <p className="mt-1 text-[0.6875rem] text-[var(--text-muted)]">
                {status}
              </p>
            </div>
          </a>
        ))}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--surface-hover)] px-4 py-3">
        <p className="text-xs text-[var(--text-muted)]">
          Next step:{' '}
          <span className="font-semibold text-[var(--text)]">{next}</span>
        </p>
        <div className="flex gap-4">
          <a href="#history" className="text-xs text-[var(--text-muted)]">
            History & notes
          </a>
          <a
            href={target}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand-secondary)]"
          >
            Go to step
            <ArrowRight className="size-3.5" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  )
}
