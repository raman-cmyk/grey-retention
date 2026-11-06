/**
 * Markup that went through `previewHtml` on the server: no links, scripts,
 * forms or outside loads, and a strict Content-Security-Policy. Only
 * `features/email-generation/preview-card.tsx` (server-only) creates it.
 */
export type SafePreview = {
  readonly kind: 'sandboxed-preview'
  readonly html: string
}
