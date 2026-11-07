import type { RenderMode } from './render'

/**
 * Klaviyo's required footer pieces (VISION.md section 10: organisation
 * name, physical address, unsubscribe, preferences, view in browser), as
 * Klaviyo template tags. These are the exact tags the Step 0 drafts used,
 * and Klaviyo rendered them in its own preview (docs/step0/README.md,
 * "Klaviyo push recipe that worked"). Klaviyo fills them per recipient
 * when it sends. Our own previews never show raw tags: they get labelled
 * placeholders and dead links instead.
 */
export const klaviyoFooterTags = {
  organization: '{{ organization.name }}',
  address: '{{ organization.full_address }}',
  unsubscribe: '{% unsubscribe "Unsubscribe" %}',
  preferences: '{% manage_preferences "Preferences" %}',
  webView: '{% web_view "View in browser" %}'
} as const

/** The footer's inner HTML, as Step 0's reference footer lays it out. */
export function footerHtml(mode: RenderMode, brandName: string) {
  const t =
    mode === 'klaviyo'
      ? klaviyoFooterTags
      : {
          organization:
            brandName
              .replace(/[<>&"'{}]/g, '')
              .trim()
              .slice(0, 80) || 'Your brand',
          address: 'Your store address (Klaviyo adds it when it sends)',
          unsubscribe: '<a href="#" style="color:#555555">Unsubscribe</a>',
          preferences: '<a href="#" style="color:#555555">Preferences</a>',
          webView: '<a href="#" style="color:#555555">View in browser</a>'
        }
  return `${t.organization}<br>${t.address}<br><br>No longer want these emails? ${t.unsubscribe} &middot; ${t.preferences}<br>Trouble viewing? ${t.webView}`
}
