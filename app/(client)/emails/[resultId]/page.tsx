import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { EmailResultView } from '@/features/email-generation/result-view'

export default async function EmailResultPage({
  params,
  searchParams
}: {
  params: Promise<{ resultId: string }>
  searchParams: Promise<{ version?: string }>
}) {
  const [{ resultId }, { version }] = await Promise.all([params, searchParams])
  if (!z.uuid().safeParse(resultId).success) notFound()
  const context = await requireRequestContext('client')
  const shown = z.coerce.number().int().min(1).safeParse(version)
  return (
    <EmailResultView
      tenantId={context.tenantId}
      resultId={resultId}
      version={shown.success ? shown.data : undefined}
      owner={context.tenantRole === 'owner'}
    />
  )
}
