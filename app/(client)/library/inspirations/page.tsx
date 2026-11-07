import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Lightbulb } from 'lucide-react'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { TrackedDomains } from '@/features/library/inspirations/tracked-domains'
import {
  domainLimit,
  referenceLibrary
} from '@/features/library/reference-library/data'
import { ReferenceLibrary } from '@/features/library/reference-library/reference-library'
import { tabCounts } from '@/features/library/reference-library/model'

export const metadata: Metadata = { title: 'Competitor Inspirations' }

/** The Inspiration library (UI_REBUILD_SPEC §9, OWNER_JOURNEYS §9). */
export default async function InspirationsPage() {
  const ctx = await requireRequestContext('client')
  const library = await referenceLibrary(ctx.tenantId)
  const owner = ctx.tenantRole === 'owner'
  const competitorEmails = library ? tabCounts(library.items).competitors : 0
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <Link
        href="/campaign-agent"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Campaigns
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <h1 className="tracking-display font-serif text-[1.875rem] leading-tight font-normal">
            Competitor Inspirations
          </h1>
          <p className="text-sm text-[var(--text-muted)]">
            Newsletters from the competitors you track — browse them here, pick
            one as a reference design when planning a campaign. This workspace
            shows sample emails until a real inbox is connected.
          </p>
        </div>
        <p className="text-right">
          <span className="block text-4xl font-semibold tabular-nums">
            {competitorEmails}
          </span>
          <span className="tracking-label font-mono text-[0.6875rem] text-[var(--text-muted)] uppercase">
            {competitorEmails === 1 ? 'Email' : 'Emails'}
          </span>
        </p>
      </header>
      {!library ? (
        <Notice error>
          We could not load your library. Reload the page to try again.
        </Notice>
      ) : (
        <>
          <TrackedDomains
            tracked={library.tracked}
            limit={domainLimit}
            owner={owner}
          />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] bg-[var(--brand-soft)] px-5 py-3 text-sm text-[var(--brand-ink)]">
            <p className="flex items-start gap-2">
              <Lightbulb
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                <strong>To build from one of these:</strong>{' '}
                {owner
                  ? 'choose “Use this design” on a card to start a new draft with it as the reference.'
                  : 'the workspace owner can start a new draft from any card.'}
              </span>
            </p>
            <Link
              href="/campaign-agent"
              className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
            >
              Open calendar
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
          <ReferenceLibrary
            items={library.items}
            timezone={ctx.timezone}
            canUse={owner}
            uploadsCapped={library.uploadsCapped}
          />
        </>
      )}
    </div>
  )
}
