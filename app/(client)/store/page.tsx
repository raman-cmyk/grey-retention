import { redirect } from 'next/navigation'

/**
 * The Store tab showed Shopify orders and customers. v2 is Klaviyo only
 * (BUILD_BRIEF D2), so the tab is hidden and old links open the Brand page.
 * Products, prices and bestsellers come from Klaviyo (V2-S3a).
 */
export default function StorePage() {
  redirect('/brand')
}
