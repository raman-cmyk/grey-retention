import type { Metadata, Route } from 'next'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { firstDraftWorkspace } from '@/features/drafts/data'
import { startDraftPath } from '@/features/drafts/href'
import { UseDesignScreen } from '@/features/drafts/use-screen'
import { draftStartView } from '@/features/drafts/use-view'

export const metadata: Metadata = { title: 'Use this design' }

const id = z.string().max(100).optional()

/**
 * "Use this design" (UI-OLDc): a draft from an Inspiration email, on the
 * GROS screens. Replaces the old `/first-draft` page, which redirects here
 * with its address. The page first gets its own request key in the
 * address, so a reload or a second click saves the same draft once.
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
  const attempt = z.uuid().safeParse(params.attempt)
  const workspace = await firstDraftWorkspace(reference, imported)
  if (!attempt.success) {
    const query = new URLSearchParams({ attempt: workspace.requestKey })
    if (reference) query.set('reference', reference)
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
          readable:
            !!data &&
            !(reference && workspace.referenceError) &&
            !(imported && workspace.importError),
          references: workspace.references,
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
        { reference, imported }
      )}
    />
  )
}
