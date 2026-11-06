import type { Metadata } from 'next'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { holidaysPage } from '@/features/holidays/data'
import {
  AddEntryCard,
  PlatformCard,
  YoursCard
} from '@/features/holidays/holidays-view'

export const metadata: Metadata = { title: 'Holidays & Events' }

const unavailableText = {
  ready: '',
  demo: 'Your own holidays and events are not saved in the demo.',
  no_database: 'Your holidays and events are unavailable right now.',
  missing_table:
    'Holidays and events need a database update. Planning still works.',
  load_failed:
    'We could not load your holidays and events. Reload the page to try again.'
} as const

export default async function HolidaysPage() {
  const ctx = await requireRequestContext('client')
  const owner = ctx.tenantRole === 'owner'
  const page = await holidaysPage(ctx)
  return (
    <div className="mx-auto max-w-[1020px]">
      <header className="mb-6 space-y-2">
        <h1 className="tracking-display font-serif text-[1.875rem] leading-tight font-normal">
          Holidays &amp; Events
        </h1>
        <p className="max-w-prose text-sm text-[var(--text-muted)]">
          Your brand’s own moments — anniversaries, drops, sales windows. They
          appear on your calendar, in the planner wizards, and the AI
          strategists plan around them.
        </p>
      </header>
      <div className="space-y-6">
        {page.own ? (
          <div
            className={
              owner
                ? 'grid items-start gap-6 lg:grid-cols-[360px_minmax(0,1fr)]'
                : ''
            }
          >
            {owner && <AddEntryCard />}
            <YoursCard entries={page.own} today={page.today} owner={owner} />
          </div>
        ) : (
          <Notice error={page.state !== 'demo'}>
            {unavailableText[page.state]}
          </Notice>
        )}
        <PlatformCard
          holidays={page.platform}
          today={page.today}
          managedBy={page.managedBy}
          country={page.country}
          countrySource={page.countrySource}
          owner={owner && page.state === 'ready'}
        />
      </div>
    </div>
  )
}
