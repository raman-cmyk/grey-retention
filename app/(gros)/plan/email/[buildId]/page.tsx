import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { ButtonLink } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { loadEmailScreen } from '@/features/email-build/email-screen-load'
import { EmailScreen } from '@/features/email-build/screen'
import { createClient } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Your email' }

/** An email's own page (UI-EMAIL-b), for a designed or a text email. */
export default async function PlannedEmailPage({
  params
}: {
  params: Promise<{ buildId: string }>
}) {
  const { buildId } = await params
  if (!z.uuid().safeParse(buildId).success) notFound()
  const context = await requireRequestContext('client')
  const db = await createClient()
  const loaded = db
    ? await loadEmailScreen(db, context.tenantId, buildId)
    : ({ ok: false } as const)
  if (loaded.ok && !loaded.screen) notFound()
  if (!loaded.ok || !loaded.screen)
    return (
      <AppPage current="plan" title="Your email">
        <ErrorState
          title="This email did not open"
          reason="We could not read it just now. It is safe: try again in a moment."
          action={<ButtonLink href="/plan" label="Back to the plan" />}
        />
      </AppPage>
    )
  return <EmailScreen view={loaded.screen} />
}
