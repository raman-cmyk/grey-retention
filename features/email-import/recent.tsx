import Link from 'next/link'
import type { Route } from 'next'
import type { FileImport } from './data'

export function fileStateLabel(
  file: Pick<FileImport, 'state' | 'upload_expires_at'>
) {
  switch (file.state) {
    case 'succeeded':
      return 'Ready'
    case 'failed':
      return 'Needs attention'
    case 'uploading':
      return 'Upload not finished'
    default:
      return 'Reading'
  }
}

/** Reopen any recent upload: ready ones continue, others show their state. */
export function FileImportList({ files }: { files: FileImport[] }) {
  return (
    <section className="mt-8 border-t border-[var(--line)] pt-5">
      <h2 className="text-sm font-semibold">Files you uploaded</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {files.map((file) => (
          <li key={file.id} className="flex flex-wrap items-baseline gap-x-2">
            <Link
              href={
                (file.state === 'succeeded' && file.reference_import_id
                  ? `/create-email/${file.reference_import_id}`
                  : `/import-reference/files/${file.id}`) as Route
              }
              className="break-all underline underline-offset-4"
            >
              {file.file_name}
            </Link>
            <span className="text-xs text-[var(--text-muted)]">
              {fileStateLabel(file)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
