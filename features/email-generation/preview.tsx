import { previewHtml, previewLimitations } from './html'
import { PlainTextEmail } from './plain-text-email'
import { ScaledFrame } from './scaled-frame'

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
  if (html === null) return <PlainTextEmail text={text} />
  const { html: safe, report } = previewHtml(html)
  const notes = previewLimitations(report)
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
