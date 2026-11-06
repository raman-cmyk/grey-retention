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
  searchParams: Promise<{ attempt?: string; mode?: string }>
}) {
  const [{ importId }, { attempt, mode }] = await Promise.all([
    params,
    searchParams
  ])
  // Set by the composer: which outcome the owner picked there.
  const preferred = mode === 'copy' || mode === 'rewrite' ? mode : undefined
  if (!z.uuid().safeParse(importId).success) notFound()
  const context = await requireRequestContext('client')
  if (!z.uuid().safeParse(attempt).success)
    redirect(
      `/create-email/${importId}?attempt=${randomUUID()}${preferred ? `&mode=${preferred}` : ''}` as Route
    )
  return (
    <ChooseOutcome
      tenantId={context.tenantId}
      importId={importId}
      attempt={attempt!}
      owner={context.tenantRole === 'owner'}
      admin={context.tenantRole === 'admin'}
      preferred={preferred}
    />
  )
}
