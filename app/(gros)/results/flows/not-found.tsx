import { KlaviyoNotFound } from '@/features/klaviyo-detail/page-states'

/** A Klaviyo flows page whose id Klaviyo does not have (UI-KLV); the rest of Results keeps the general not-found page. */
export default function ResultsNotFound() {
  return <KlaviyoNotFound />
}
