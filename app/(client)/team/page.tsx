import type { Metadata } from 'next'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { teamPage } from '@/features/team/data'
import { InviteCard, InvitesCard, MembersCard } from '@/features/team/team-view'

export const metadata: Metadata = { title: 'Team' }

const unavailableText = {
  ready: '',
  demo: 'The team is not shown in the demo.',
  no_database: 'The team is unavailable right now.',
  missing_command: 'The Team page needs a database update.',
  load_failed: 'We could not load your team. Reload the page to try again.'
} as const

export default async function TeamPage() {
  const ctx = await requireRequestContext('client')
  const page = await teamPage(ctx)
  const ready = page.state === 'ready'
  return (
    <div className="mx-auto max-w-[820px]">
      <header className="mb-6 space-y-2">
        <h1 className="tracking-display font-serif text-[1.875rem] leading-tight font-normal">
          Team
        </h1>
        <p className="max-w-prose text-sm text-[var(--text-muted)]">
          Invite teammates and manage their access to your account.
        </p>
      </header>
      {ready ? (
        <div className="space-y-6">
          {page.canManage && <InviteCard />}
          <MembersCard members={page.members} canManage={page.canManage} />
          {page.canManage &&
            (page.invites ? (
              <InvitesCard invites={page.invites} now={page.now} />
            ) : (
              <Notice error>
                We could not load the pending invites. Reload the page to try
                again.
              </Notice>
            ))}
        </div>
      ) : (
        <Notice error={page.state !== 'demo'}>
          {unavailableText[page.state]}
        </Notice>
      )}
    </div>
  )
}
