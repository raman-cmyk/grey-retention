import type { Metadata, Route } from 'next'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { firstDraftWorkspace } from '@/features/drafts/data'
import { startDraftPath } from '@/features/drafts/href'
import { UseDesignScreen } from '@/features/drafts/use-screen'
import { draftStartView } from '@/features/drafts/use-view'
import { readUseEmail } from '@/features/inspiration/use-read'
import { UseEmailScreen } from '@/features/inspiration/use-screen'
import { inspirationUseView } from '@/features/inspiration/use-view'

export const metadata: Metadata = { title: 'Use this design' }

const id = z.string().max(100).optional()

// Create email builds the email after its reply, as on the Plan.
export const maxDuration = 120

/**
 * "Use this design". With an Inspiration email chosen (`reference`, UI-USE,
 * owner decision of 24 Nov): which planned email of the current plan to
 * make with it, Copy or Remix, and Create email, which opens the email's
 * own page. Otherwise (an email the owner added, `imported`, or none: the
 * old `/first-draft`, which redirects here) the GROS draft form of UI-OLDc:
 * the page first gets its own request key in the address, so a reload or
 * a second click saves the same draft once.
 */
export default async function UseDesignPage({
  searchParams
}: {
  searchParams: Promise<{
    reference?: string | string[]
    imported?: string | string[]
    attempt?: string | string[]
  }>
}) {
  const params = await searchParams
  const reference = id.safeParse(params.reference).data
  const imported = id.safeParse(params.imported).data
  if (reference && !imported) {
    const context = await requireRequestContext('client')
    const chosen = z.uuid().safeParse(reference)
    return (
      <UseEmailScreen
        view={inspirationUseView(
          await readUseEmail(context, chosen.success ? chosen.data : null)
        )}
        timezone={context.timezone}
      />
    )
  }
  const attempt = z.uuid().safeParse(params.attempt)
  const workspace = await firstDraftWorkspace(imported)
  if (!attempt.success) {
    const query = new URLSearchParams({ attempt: workspace.requestKey })
    if (imported) query.set('imported', imported)
    redirect(`${startDraftPath}?${query}` as Route)
  }
  const { context, data } = workspace
  return (
    <UseDesignScreen
      view={draftStartView(
        {
          owner: context.tenantRole === 'owner',
          // The chosen email's own list must have been read to find it.
          readable: !!data && !(imported && workspace.importError),
          references: [],
          imported: workspace.imported,
          requestKey: attempt.data,
          brandName: data?.brand?.brand_name ?? context.tenantName,
          defaultDate: workspace.defaultDate,
          timezone: context.timezone,
          audiences: (data?.audiences ?? []).map((a) => ({
            id: a.id,
            label: a.label
          }))
        },
        { imported }
      )}
    />
  )
}
