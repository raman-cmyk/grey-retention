import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { z } from 'zod'
import Link from 'next/link'
import { Notice } from '@/components/ui/workspace'
import { firstDraftWorkspace } from '@/features/drafts/data'
import { FirstDraftForm } from '@/features/drafts/form'

export default async function FirstDraftPage({
  searchParams
}: {
  searchParams: Promise<{
    reference?: string
    imported?: string
    attempt?: string
  }>
}) {
  const params = await searchParams
  const {
    context,
    data,
    error,
    references,
    imported,
    referenceError,
    importError,
    requestKey,
    defaultDate
  } = await firstDraftWorkspace(params.reference, params.imported)
  if (!z.uuid().safeParse(params.attempt).success) {
    const query = new URLSearchParams({ attempt: requestKey })
    for (const key of ['reference', 'imported'] as const) {
      const value = params[key]
      if (typeof value === 'string') query.set(key, value.slice(0, 100))
    }
    redirect(`/first-draft?${query}` as Route)
  }
  return (
    <div>
      <Link
        href="/get-started?step=draft"
        className="text-xs text-[var(--text-muted)] underline"
      >
        Back to setup
      </Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">
        Your next email starts here.
      </h1>
      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
        One idea. One draft. Keep refining it in your workspace.
      </p>
      {error || !data ? (
        <Notice error>{error ?? 'Your workspace could not load.'}</Notice>
      ) : context.tenantRole !== 'owner' ? (
        <Notice>Ask your workspace owner to create a draft.</Notice>
      ) : (
        <>
          {referenceError && (
            <div className="mt-5">
              <Notice error>
                References could not load. You can start from scratch, or reload
                this page to try again.
              </Notice>
            </div>
          )}
          {importError && (
            <div className="mt-5">
              <Notice error>
                Emails you added could not load. You can start from scratch, or
                reload this page to try again.
              </Notice>
            </div>
          )}
          {((params.reference &&
            !references.some((item) => item.id === params.reference)) ||
            (params.imported &&
              !imported.some((item) => item.id === params.imported))) && (
            <div className="mt-5">
              <Notice>
                This reference is unavailable here. Choose another, or start
                from scratch.
              </Notice>
            </div>
          )}
          <FirstDraftForm
            references={references}
            imported={imported}
            selectedImport={params.imported}
            audiences={data.audiences}
            timezone={context.timezone}
            brandName={data.brand?.brand_name ?? context.tenantName}
            requestKey={params.attempt!}
            defaultDate={defaultDate}
            selectedReference={params.reference}
          />
        </>
      )}
    </div>
  )
}
