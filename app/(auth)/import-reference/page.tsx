import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import Link from 'next/link'
import { z } from 'zod'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { fileImportSetup } from '@/features/email-import/config'
import { fileImports } from '@/features/email-import/data'
import { IntakeChoice } from '@/features/email-import/intake-choice'
import { FileImportList } from '@/features/email-import/recent'
import { UploadEmailForm } from '@/features/email-import/upload-form'
import { pastedReferences } from '@/features/references/pasted-data'
import { PastedReferenceForm } from '@/features/references/pasted-form'

export default async function ImportReferencePage({
  searchParams
}: {
  searchParams: Promise<{ attempt?: string; mode?: string }>
}) {
  const params = await searchParams
  const context = await requireRequestContext('client')
  const mode = params.mode === 'file' ? 'file' : 'paste'
  if (!z.uuid().safeParse(params.attempt).success)
    redirect(
      `/import-reference?${mode === 'file' ? 'mode=file&' : ''}attempt=${randomUUID()}` as Route
    )
  const owner = context.tenantRole === 'owner'
  const [saved, files] = owner
    ? await Promise.all([
        pastedReferences(context.tenantId, 5),
        mode === 'file' ? fileImports(context.tenantId, 5) : null
      ])
    : [null, null]
  const setup = fileImportSetup(context.tenantId)
  return (
    <div>
      <Link
        href="/get-started?step=reference"
        className="text-xs text-[var(--text-muted)] underline"
      >
        Back to setup
      </Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">
        Add an email you like.
      </h1>
      <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">
        Use one you already have — your own or one you received. Next you can
        rewrite it for your brand or keep an exact copy.
      </p>
      <IntakeChoice mode={mode} />
      {!owner ? (
        <div className="mt-7">
          <Notice>Ask your workspace owner to add reference emails.</Notice>
        </div>
      ) : mode === 'paste' ? (
        <PastedReferenceForm requestKey={params.attempt!} />
      ) : setup.ready ? (
        <UploadEmailForm initialKey={params.attempt!} />
      ) : (
        <div className="mt-7 space-y-3">
          <Notice>
            File upload is not set up for this workspace yet. An administrator
            needs to finish the server setup.
          </Notice>
          <Link
            href="/import-reference"
            className="block text-sm underline underline-offset-4"
          >
            Paste the email instead
          </Link>
        </div>
      )}
      {(saved?.error || files?.error) && (
        <div className="mt-6">
          <Notice error>{saved?.error ?? files?.error}</Notice>
        </div>
      )}
      {mode === 'file' && !!files?.data.length && (
        <FileImportList files={files.data} />
      )}
      {!!saved?.data.length && (
        <section className="mt-8 border-t border-[var(--line)] pt-5">
          <h2 className="text-sm font-semibold">Emails you added</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {saved.data.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/create-email/${item.id}` as Route}
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
