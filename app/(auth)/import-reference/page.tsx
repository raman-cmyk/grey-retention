import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import Link from 'next/link'
import { z } from 'zod'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { pastedReferences } from '@/features/references/pasted-data'
import { PastedReferenceForm } from '@/features/references/pasted-form'

export default async function ImportReferencePage({
  searchParams
}: {
  searchParams: Promise<{ attempt?: string }>
}) {
  const params = await searchParams
  const context = await requireRequestContext('client')
  if (!z.uuid().safeParse(params.attempt).success)
    redirect(`/import-reference?attempt=${randomUUID()}` as Route)
  const owner = context.tenantRole === 'owner'
  const saved = owner ? await pastedReferences(context.tenantId, 5) : null
  return (
    <div>
      <Link
        href="/get-started?step=reference"
        className="text-xs text-[var(--text-muted)] underline"
      >
        Back to setup
      </Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">
        Paste an email you like.
      </h1>
      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
        Use one you already have — your own or one you received. You’ll see it
        as plain text, then start a draft from its outline.
      </p>
      {owner ? (
        <PastedReferenceForm requestKey={params.attempt!} />
      ) : (
        <div className="mt-7">
          <Notice>Ask your workspace owner to add reference emails.</Notice>
        </div>
      )}
      {saved?.error && (
        <div className="mt-6">
          <Notice error>{saved.error}</Notice>
        </div>
      )}
      {!!saved?.data.length && (
        <section className="mt-8 border-t border-[var(--line)] pt-5">
          <h2 className="text-sm font-semibold">Emails you added</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {saved.data.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/first-draft?imported=${item.id}` as Route}
                  className="underline underline-offset-4"
                >
                  {item.subject}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
