import 'server-only'
import { previewHtml } from './html'
import type { SafePreview } from './safe-preview'

/**
 * The one helper (besides `EmailPreviewCard`) that turns stored email HTML
 * into a `SafePreview`: sanitized on the server, links removed, a strict
 * Content-Security-Policy. Client code never builds one; a picker sends
 * back only the item's id and source, never its markup.
 */
export function toSafePreview(html: string | null): SafePreview | null {
  if (!html) return null
  return { kind: 'sandboxed-preview', html: previewHtml(html).html }
}
