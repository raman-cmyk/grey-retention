import { notFound, redirect } from 'next/navigation'
import type { Route } from 'next'
import Link from 'next/link'
import { z } from 'zod'
import { ActionForm, SubmitButton } from '@/components/ui/action-form'
import { Notice } from '@/components/ui/workspace'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { retryEmailFile } from '@/features/email-import/actions'
import { fileImportSetup } from '@/features/email-import/config'
import { fileImport } from '@/features/email-import/data'
import {
  failureMessage,
  formatBytes,
  retryable
} from '@/features/email-import/limits'
import { FileImportProgress } from '@/features/email-import/progress'

export default async function FileImportPage({
  params
}: {
  params: Promise<{ fileImportId: string }>
}) {
  const { fileImportId } = await params
  if (!z.uuid().safeParse(fileImportId).success) notFound()
  const context = await requireRequestContext('client')
  const { data: file, error } = await fileImport(context.tenantId, fileImportId)
  if (!file && !error) notFound()
  // Only a persisted success continues; nothing claims completion before that.
  if (file?.state === 'succeeded' && file.reference_import_id)
    redirect(`/create-email/${file.reference_import_id}` as Route)
  const owner = context.tenantRole === 'owner'
  const setupReady = fileImportSetup(context.tenantId).ready
  return (
    <div>
      <Link
        href={'/import-reference?mode=file' as Route}
        className="text-xs text-[var(--text-muted)] underline"
      >
        Back to adding an email
      </Link>
      <h1 className="mt-7 text-3xl font-semibold tracking-tight">
        {file?.state === 'failed'
          ? 'This file needs attention.'
          : file?.state === 'uploading'
            ? 'This upload did not finish.'
            : 'Reading your file.'}
      </h1>
      {file && (
        <p className="mt-3 text-sm leading-6 break-all text-[var(--text-muted)]">
          {file.file_name} · {formatBytes(file.byte_size)}
        </p>
      )}
      <div className="mt-7 space-y-5">
        {error && <Notice error>{error}</Notice>}
        {file?.state === 'failed' && (
          <>
            <Notice error>{failureMessage(file.failure_code)}</Notice>
            {owner && retryable(file.failure_code) && file.retries < 3 && (
              <ActionForm action={retryEmailFile}>
                <input type="hidden" name="importId" value={file.id} />
                <SubmitButton pendingLabel="Trying again…">
                  Try again
                </SubmitButton>
              </ActionForm>
            )}
          </>
        )}
        {file?.state === 'uploading' && (
          <Notice>
            The file was not fully saved, so nothing was processed. Choose the
            same file again to finish, or pick another one.
          </Notice>
        )}
        {(file?.state === 'queued' || file?.state === 'processing') &&
          (setupReady ? (
            <FileImportProgress importId={file.id} state={file.state} />
          ) : (
            <Notice>
              Your file is saved. It will be read once an administrator finishes
              the server setup for file uploads.
            </Notice>
          ))}
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link
            href={'/import-reference?mode=file' as Route}
            className="underline underline-offset-4"
          >
            Choose another file
          </Link>
          <Link
            href="/import-reference"
            className="underline underline-offset-4"
          >
            Paste the email instead
          </Link>
        </div>
      </div>
    </div>
  )
}
