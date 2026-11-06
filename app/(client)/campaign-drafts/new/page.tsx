import { redirect } from 'next/navigation'

/** The old "New campaign" form is the first-draft page (UIR-017). */
export default function NewCampaignDraftPage() {
  redirect('/first-draft')
}
