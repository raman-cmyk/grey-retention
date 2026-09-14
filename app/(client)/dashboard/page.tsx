import {
  ArrowUpRight,
  CalendarPlus,
  CircleDot,
  MessageSquareText,
  Paperclip,
  Sparkles
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StatusMark } from '@/components/ui/status-mark'
import { cn } from '@/lib/utils'

const campaignDates = [
  { weekday: 'MON', day: '14', label: 'Today', active: false },
  { weekday: 'THU', day: '17', label: 'Copy', active: true },
  { weekday: 'SUN', day: '20', label: 'Design', active: false },
  { weekday: 'WED', day: '23', label: 'Open', active: false },
  { weekday: 'SAT', day: '26', label: 'Planned', active: false },
  { weekday: 'TUE', day: '29', label: 'Open', active: false }
]

const campaignProofs = [
  {
    date: 'Sep 17',
    title: 'Autumn field notes',
    audience: 'Engaged 90d',
    state: 'Copy review',
    proofId: 'PF-0917',
    notes: 2,
    sources: 4
  },
  {
    date: 'Sep 20',
    title: 'The second layer',
    audience: 'Past purchasers',
    state: 'Design due',
    proofId: 'PF-0920',
    notes: 1,
    sources: 3
  },
  {
    date: 'Sep 26',
    title: 'A quieter weekend',
    audience: 'Full list',
    state: 'Planned',
    proofId: 'PF-0926',
    notes: 0,
    sources: 2
  }
]

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-[92rem]">
      <div className="flex flex-col gap-5 border-b border-[var(--line-strong)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-[family-name:var(--font-data)] text-[0.68rem] tracking-[0.08em] text-[var(--text-muted)] uppercase">
            September 2026 / Synthetic workspace
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl leading-none font-bold tracking-[-0.035em] sm:text-5xl">
            Campaign proof table
          </h1>
        </div>
        <Button>
          <CalendarPlus className="size-4" aria-hidden /> Create campaign
        </Button>
      </div>

      <nav
        className="mt-5 overflow-x-auto border-y border-[var(--line-strong)]"
        aria-label="September campaign dates"
      >
        <ol className="grid min-w-[42rem] grid-cols-6 divide-x divide-[var(--line)]">
          {campaignDates.map((date) => (
            <li key={date.day}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus)] focus-visible:outline-none focus-visible:ring-inset',
                  date.active && 'bg-[var(--surface-raised)]'
                )}
                aria-current={date.active ? 'date' : undefined}
              >
                <span className="font-[family-name:var(--font-data)] text-lg">
                  {date.day}
                </span>
                <span>
                  <span className="block font-[family-name:var(--font-data)] text-[0.68rem] tracking-[0.08em] text-[var(--text-faint)]">
                    {date.weekday}
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 block text-xs text-[var(--text-muted)]',
                      date.active && 'font-semibold text-[var(--text)]'
                    )}
                  >
                    {date.label}
                  </span>
                </span>
                {date.active && (
                  <span
                    className="ml-auto size-2 rounded-full bg-[var(--brand-primary)]"
                    aria-hidden
                  />
                )}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="grid gap-5 pt-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="order-2 overflow-hidden rounded-[var(--radius-panel)] bg-[var(--surface-raised)] shadow-[0_22px_60px_-45px_rgba(31,29,24,.65)] xl:order-1 xl:col-start-1 xl:row-start-1">
          <header className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
            <div>
              <h2 className="text-sm font-bold">Active proofs</h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                3 campaigns need attention
              </p>
            </div>
            <Button variant="quiet" size="sm">
              Full calendar <ArrowUpRight className="size-3.5" aria-hidden />
            </Button>
          </header>
          <div className="divide-y divide-[var(--line)]">
            {campaignProofs.map((campaign, index) => (
              <article
                key={campaign.title}
                className={cn(
                  'group grid min-h-32 grid-cols-[5.5rem_1fr] transition-colors hover:bg-[var(--surface-hover)] sm:grid-cols-[6.5rem_1fr_9rem]',
                  index === 0 && 'shadow-[inset_3px_0_0_var(--brand-primary)]'
                )}
              >
                <div className="flex items-center border-r border-[var(--line)] px-4 font-[family-name:var(--font-data)] text-xs text-[var(--text-muted)]">
                  {campaign.date}
                </div>
                <div className="flex min-w-0 items-center justify-between gap-5 px-5 py-4">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-bold">
                      {campaign.title}
                    </h3>
                    <p className="mt-1.5 text-sm text-[var(--text-muted)]">
                      {campaign.audience}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 font-[family-name:var(--font-data)] text-[0.68rem] tracking-[0.04em] text-[var(--text-faint)] uppercase">
                      <span>{campaign.proofId}</span>
                      <span className="inline-flex items-center gap-1">
                        <MessageSquareText className="size-3" aria-hidden />
                        {campaign.notes} notes
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Paperclip className="size-3" aria-hidden />
                        {campaign.sources} sources
                      </span>
                    </div>
                    <StatusMark
                      className="mt-3 sm:hidden"
                      tone={
                        index === 0
                          ? 'warning'
                          : index === 1
                            ? 'active'
                            : 'neutral'
                      }
                    >
                      {campaign.state}
                    </StatusMark>
                  </div>
                  <CircleDot
                    className={
                      index === 0
                        ? 'size-5 text-[var(--brand-primary)]'
                        : 'size-5 text-[var(--line-strong)]'
                    }
                    aria-hidden
                  />
                </div>
                <div className="hidden items-center border-l border-[var(--line)] px-4 sm:flex">
                  <StatusMark
                    tone={
                      index === 0
                        ? 'warning'
                        : index === 1
                          ? 'active'
                          : 'neutral'
                    }
                  >
                    {campaign.state}
                  </StatusMark>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="order-1 rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-5 text-[var(--text)] shadow-[0_22px_60px_-45px_rgba(29,29,31,.3)] xl:sticky xl:top-[6.25rem] xl:order-2 xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start">
          <div className="flex items-center justify-between border-b border-[var(--line)] pb-4">
            <h2 className="text-sm font-bold">Review rail</h2>
            <Sparkles
              className="size-4 text-[var(--brand-primary)]"
              aria-hidden
            />
          </div>
          <div className="py-6">
            <p className="font-[family-name:var(--font-data)] text-[0.65rem] tracking-[0.06em] text-[var(--text-faint)] uppercase">
              Highest-leverage action
            </p>
            <h3 className="mt-3 text-xl leading-6 font-bold">
              Resolve copy before design handoff.
            </h3>
            <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
              Autumn field notes has audience and offer context. Two body
              decisions remain open.
            </p>
            <Button className="mt-6 w-full">Open proof</Button>
          </div>
          <dl className="space-y-4 border-t border-[var(--line)] pt-5">
            {[
              ['Brand context', 'Ready'],
              ['Audience', 'Engaged 90d'],
              ['Evidence', '4 sources · 2 notes'],
              ['Design SLA', '2 days']
            ].map(([term, detail]) => (
              <div
                key={term}
                className="flex items-baseline justify-between gap-4 text-xs"
              >
                <dt className="text-[var(--text-faint)]">{term}</dt>
                <dd className="text-right font-medium text-[var(--text)]">
                  {detail}
                </dd>
              </div>
            ))}
          </dl>
        </aside>

        <section
          className="order-3 grid grid-cols-3 divide-x divide-[var(--line)] overflow-hidden rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] xl:col-start-1 xl:row-start-2"
          aria-label="September campaign metrics"
        >
          {[
            ['Revenue tracked', '$38.2k'],
            ['Campaign share', '61%'],
            ['Drafts this month', '12']
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 px-3 py-4 sm:p-5">
              <p className="text-[0.68rem] leading-4 text-[var(--text-muted)] sm:text-xs">
                {label}
              </p>
              <p className="mt-2 font-[family-name:var(--font-data)] text-base tracking-[-0.04em] sm:text-xl">
                {value}
              </p>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
