/** Safe ASCII download names; content types never invite inline rendering. */
export function exportFilename(file: {
  subject: string
  kind: 'html' | 'text'
  label: string
}) {
  const slug =
    file.subject
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'email'
  const label = file.label.replace(/[^a-z0-9]/gi, '').slice(0, 20)
  return file.kind === 'html'
    ? { name: `${slug}-${label}.html`, type: 'text/html; charset=utf-8' }
    : { name: `${slug}-${label}.txt`, type: 'text/plain; charset=utf-8' }
}
