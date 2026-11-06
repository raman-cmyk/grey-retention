import { previewHtml, type PreviewReport } from './html'
import { PreviewCardFrame } from './preview-card-frame'

export function previewNotes(report: PreviewReport) {
  const notes: string[] = []
  if (report.images)
    notes.push(
      `${report.images} image${report.images === 1 ? '' : 's'} shown as placeholders`
    )
  if (report.styles) notes.push('outside fonts or backgrounds not loaded')
  if (report.links) notes.push('links turned off')
  if (report.removed) notes.push('scripts, forms or embedded content removed')
  if (report.truncated) notes.push('very deeply nested content not shown')
  return notes
}

const sources = {
  klaviyo: "Rendered preview from Klaviyo's stored template.",
  draft: 'Rendered preview of this draft.',
  inspiration: 'Rendered preview of the competitor email.'
} as const

/**
 * The shared "Email preview" card (docs/UI_REBUILD_SPEC.md §2). Every
 * preview is sanitized on the server and shown in-page in a sandboxed frame
 * with links turned off, so an owner can never click a competitor's
 * unsubscribe link by accident (docs/OWNER_JOURNEYS.md §18.19).
 */
export function EmailPreviewCard({
  html,
  text = '',
  title,
  templateName,
  source,
  height = 560
}: {
  /** Stored email HTML, or null for a plain-text email. */
  html: string | null
  text?: string
  /** Accessible name of the frame, e.g. "Preview of Spring sale". */
  title: string
  templateName?: string
  source: keyof typeof sources
  height?: number
}) {
  const preview = html === null ? null : previewHtml(html)
  return (
    <PreviewCardFrame
      title={title}
      templateName={templateName}
      srcDoc={preview?.html ?? null}
      text={text}
      caption={`${sources[source]} Links are turned off, and outside fonts, images and tracking pixels don't load because the preview is isolated from the web.`}
      notes={preview ? previewNotes(preview.report) : []}
      height={height}
    />
  )
}
