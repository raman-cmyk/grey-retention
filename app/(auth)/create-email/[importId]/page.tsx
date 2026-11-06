import { randomUUID } from 'node:crypto'
import { notFound, redirect } from 'next/navigation'
import type { Route } from 'next'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { ChooseOutcome } from '@/features/email-generation/choose'

export default async function CreateEmailPage({
  params,
  searchParams
}: {
  params: Promise<{ importId: string }>
  searchParams: Promise<{ attempt?: string }>
}) {
  const [{ importId }, { attempt }] = await Promise.all([params, searchParams])
  if (!z.uuid().safeParse(importId).success) notFound()
  const context = await requireRequestContext('client')
  if (!z.uuid().safeParse(attempt).success)
    redirect(`/create-email/${importId}?attempt=${randomUUID()}` as Route)
  return (
    <ChooseOutcome
      tenantId={context.tenantId}
      importId={importId}
      attempt={attempt!}
      owner={context.tenantRole === 'owner'}
    />
  )
}
