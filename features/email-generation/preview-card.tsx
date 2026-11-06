import 'server-only'
import { previewHtml, previewLimitations } from './html'
import { PreviewCardFrame } from './preview-card-frame'
import type { SafePreview } from './safe-preview'

const sources = {
  klaviyo: "Rendered preview from Klaviyo's stored template.",
  draft: 'Rendered preview of this draft.',
  inspiration: 'Rendered preview of the competitor email.'
} as const

/**
 * The shared "Email preview" card (docs/UI_REBUILD_SPEC.md §2). Every
 * preview is sanitized here on the server and shown in-page in a sandboxed
 * frame with links turned off, so an owner can never click a competitor's
 * unsubscribe link by accident (docs/OWNER_JOURNEYS.md §18.19). The raw
 * email never reaches the browser.
 */
export function EmailPreviewCard({
  html,
  text = '',
  title,
  templateName,
  source,
  height = 720
}: {
  /** Stored email HTML, or null for a plain-text email. */
  html: string | null
  text?: string
  /** Accessible name of the frame, e.g. "Preview of Spring sale". */
  title: string
  templateName?: string
  source: keyof typeof sources
  /** Canvas height in px before scaling to the card width. */
  height?: number
}) {
  const result = html === null ? null : previewHtml(html)
  const preview: SafePreview | null = result
    ? { kind: 'sandboxed-preview', html: result.html }
    : null
  return (
    <PreviewCardFrame
      title={title}
      templateName={templateName}
      preview={preview}
      text={text}
      caption={
        preview
          ? `${sources[source]} Links are turned off, and outside fonts, images and tracking pixels don't load because the preview is isolated from the web.`
          : 'Plain-text email: there is no design to show.'
      }
      notes={result ? previewLimitations(result.report) : []}
      height={height}
    />
  )
}
