/**
 * Markup that went through `previewHtml` on the server: no links, scripts,
 * forms or outside loads, and a strict Content-Security-Policy. Only
 * server-only code creates it: `preview-card.tsx` and `toSafePreview`
 * (`to-safe-preview.ts`, used by the reference library).
 */
export type SafePreview = {
  readonly kind: 'sandboxed-preview'
  readonly html: string
}
