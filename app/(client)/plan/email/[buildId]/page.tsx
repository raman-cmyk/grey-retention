import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { PageHeading } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { BuiltEmailPreview } from '@/features/email-build/preview'

export const metadata: Metadata = { title: 'Your email' }

export default async function PlannedEmailPage({
  params
}: {
  params: Promise<{ buildId: string }>
}) {
  const { buildId } = await params
  if (!z.uuid().safeParse(buildId).success) notFound()
  const context = await requireRequestContext('client')
  return (
    <div className="mx-auto max-w-[820px]">
      <PageHeading
        title="Your email"
        description="The email as it lands in Klaviyo: a draft you schedule yourself."
      />
      <BuiltEmailPreview tenantId={context.tenantId} buildId={buildId} />
    </div>
  )
}
