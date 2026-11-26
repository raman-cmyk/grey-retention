import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { ButtonLink } from '@/components/gros/button'
import { AppPage } from '@/components/gros/nav'
import { ErrorState } from '@/components/gros/states'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { loadEmailScreen } from '@/features/email-build/email-screen-load'
import { EmailScreen } from '@/features/email-build/screen'
import { checkEmailSoon } from '@/features/results/live'
import { validTimezone } from '@/lib/brand-time'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

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
  // PICK-99: the page shows what the sync stored, and asks Klaviyo how its
  // draft is now after the page is sent (GET only, at most once in ten
  // minutes an email; the session's workspace only): never a wait.
  checkEmailSoon(createServiceClient(), context.tenantId, buildId)
  const db = await createClient()
  const loaded = db
    ? await loadEmailScreen(
        db,
        context.tenantId,
        buildId,
        validTimezone(context.timezone)
      )
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
