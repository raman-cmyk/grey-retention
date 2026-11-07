import type { RenderMode } from './render'

/**
 * Klaviyo's required footer pieces (VISION.md section 10: unsubscribe
 * link, physical address, view in browser, organisation name), as Klaviyo
 * template tags. Klaviyo fills them per recipient from the account's
 * settings when it sends. Our own previews never show raw tags: they get
 * labelled placeholders and dead links instead.
 *
 * The tag names follow Klaviyo's message-design documentation; the first
 * live draft pushed in VISION Step 4 confirms them in Klaviyo's preview.
 */
export const klaviyoFooterTags = {
  unsubscribe: '{% unsubscribe_link %}',
  preferences: '{% manage_preferences_link %}',
  webView: '{% web_view_link %}',
  organization: '{{ organization.name }}',
  address: '{{ organization.full_address }}'
} as const

export function footerLinks(mode: RenderMode, brandName: string) {
  if (mode === 'klaviyo') return klaviyoFooterTags
  const name = brandName
    .replace(/[<>&"'{}]/g, '')
    .trim()
    .slice(0, 80)
  return {
    unsubscribe: '#',
    preferences: '#',
    webView: '#',
    organization: name || 'Your brand',
    address: 'Your store address (Klaviyo adds it when it sends)'
  }
}
