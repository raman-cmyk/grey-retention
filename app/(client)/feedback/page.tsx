import type { Metadata } from 'next'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { feedbackPage } from '@/features/feedback/data'
import { FeedbackBoard } from '@/features/feedback/feedback-view'
import { validTimezone } from '@/lib/brand-time'

export const metadata: Metadata = { title: 'Feature Requests' }

const unavailableText = {
  ready: '',
  demo: 'Feature requests are not saved in the demo.',
  no_database: 'Feature requests are unavailable right now.',
  missing_column: 'Feature requests need a database update.',
  load_failed: 'We could not load your requests. Reload the page to try again.'
} as const

export default async function FeedbackPage() {
  const ctx = await requireRequestContext('client')
  const page = await feedbackPage(ctx)
  return (
    <div className="mx-auto max-w-[820px]">
      <header className="mb-6 space-y-2">
        <h1 className="tracking-display font-serif text-[1.875rem] leading-tight font-normal">
          Feature Requests
        </h1>
        <p className="max-w-prose text-sm text-[var(--text-muted)]">
          Track what you’ve asked for and see replies from the {page.team}.
        </p>
      </header>
      {page.state === 'ready' ? (
        <FeedbackBoard
          requests={page.requests}
          timezone={validTimezone(ctx.timezone)}
          now={page.now}
        />
      ) : (
        <Notice error={page.state !== 'demo'}>
          {unavailableText[page.state]}
        </Notice>
      )}
    </div>
  )
}
