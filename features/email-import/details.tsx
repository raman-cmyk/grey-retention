import { Download } from 'lucide-react'
import type { FileImport } from './data'
import { formatBytes } from './limits'

const kindLabel = {
  html: 'Web page (.html)',
  text: 'Text (.txt)',
  eml: 'Email message (.eml)'
} as const

const noteText: Record<string, string> = {
  attachments_kept:
    'Attachments stay inside the original file. They are not opened, used or shared.',
  inline_images_placeholder:
    'Images inside the email are shown as placeholders; nothing is loaded.',
  text_part_available:
    'The email also had a plain-text version; the designed version is used.',
  subject_shortened:
    'The name was shortened to fit. The original file is unchanged.',
  sender_shortened:
    'The sender was shortened to fit. The original file is unchanged.',
  preview_limited: 'The text preview is limited; the full email is kept.',
  date_unreadable:
    'The date in the file could not be read, so it is not shown. The original file is unchanged.'
}

export function originalFileHref(importId: string) {
  return `/api/v1/email-imports/${importId}/file`
}

/**
 * Optional, closed by default. Sender and date are whatever the file says:
 * shown as the owner's import, never as verified identity or captured evidence.
 */
export function FileDetails({
  file,
  canDownload
}: {
  file: FileImport
  canDownload: boolean
}) {
  const notes = file.notes.map((code) => noteText[code]).filter(Boolean)
  return (
    <details className="mt-3 rounded-xl border border-[var(--line)] p-4">
      <summary className="cursor-pointer text-sm">From your file</summary>
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-[var(--text-muted)]">File</dt>
        <dd className="break-all">{file.file_name}</dd>
        <dt className="text-[var(--text-muted)]">Type</dt>
        <dd>
          {kindLabel[file.file_kind as keyof typeof kindLabel]} ·{' '}
          {formatBytes(file.byte_size)}
        </dd>
        {file.header_from && (
          <>
            <dt className="text-[var(--text-muted)]">Sender</dt>
            <dd className="break-all">{file.header_from}</dd>
          </>
        )}
        {file.header_date && (
          <>
            <dt className="text-[var(--text-muted)]">Date</dt>
            <dd>
              {new Intl.DateTimeFormat('en', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'UTC'
              }).format(new Date(file.header_date))}{' '}
              UTC
            </dd>
          </>
        )}
        {!!file.attachment_count && (
          <>
            <dt className="text-[var(--text-muted)]">Attachments</dt>
            <dd>{file.attachment_count}</dd>
          </>
        )}
      </dl>
      {(file.header_from || file.header_date) && (
        <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
          Sender and date are as written in the file you added. They are not
          verified.
        </p>
      )}
      {notes.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--text-muted)]">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      {canDownload && (
        <a
          href={originalFileHref(file.id)}
          download
          className="mt-4 inline-flex items-center gap-2 text-sm underline underline-offset-4"
        >
          <Download className="size-4" aria-hidden /> Download original file
          (exact bytes)
        </a>
      )}
    </details>
  )
}
