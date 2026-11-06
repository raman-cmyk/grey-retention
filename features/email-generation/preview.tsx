import { previewHtml, type PreviewReport } from './html'
import { ScaledFrame } from './scaled-frame'

function limitations(report: PreviewReport) {
  const notes: string[] = []
  if (report.images)
    notes.push(
      `${report.images} image${report.images === 1 ? '' : 's'} shown as placeholders`
    )
  if (report.styles) notes.push('outside fonts or backgrounds not loaded')
  if (report.links) notes.push('links turned off')
  if (report.removed) notes.push('scripts, forms or embedded content removed')
  if (report.truncated)
    notes.push(
      'very deeply nested content not shown (it is kept in the saved email)'
    )
  return notes
}

/**
 * Safe visual preview. HTML is re-parsed and stripped of active content, then
 * shown in a sandboxed frame with no scripts, forms, navigation or same-origin
 * access, under its own restrictive policy. The saved email is never altered.
 */
export function EmailPreview({
  html,
  text,
  title
}: {
  html: string | null
  text: string
  title: string
}) {
  if (html === null)
    return (
      <div className="rounded-xl border border-[var(--line)] bg-white p-5">
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          Plain-text email
        </p>
        <p className="text-sm leading-6 break-words whitespace-pre-wrap text-[#1f1f1f]">
          {text}
        </p>
      </div>
    )
  const { html: safe, report } = previewHtml(html)
  const notes = limitations(report)
  return (
    <figure>
      <ScaledFrame title={title} srcDoc={safe} />
      <figcaption className="mt-2 text-xs leading-5 text-[var(--text-muted)]">
        Safe preview. Email apps may show it differently.
        <details className="mt-1">
          <summary className="cursor-pointer">About this preview</summary>
          <p className="mt-1">
            Shown on a 640px canvas, scaled to fit; scroll inside it for longer
            emails. Nothing in the email can run or load from other sites
            {notes.length ? `: ${notes.join(', ')}` : ''}.
          </p>
        </details>
      </figcaption>
    </figure>
  )
}
