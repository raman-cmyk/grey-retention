import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { observerAllowed } from '@/features/inbox/observer-access'
import { observerEnabled } from '@/features/inbox/observer-sheet'
import { isSampleDomain } from '@/features/library/inspirations/domain'
import { toSafePreview } from '@/features/email-generation/to-safe-preview'
import {
  classifyFormat,
  type LibraryItem
} from '@/features/library/reference-library/model'
import type { Database } from '@/lib/supabase/database.types'

/** The latest emails shown per brand of the niche... */
export const nichePerBrand = 6
/**
 * ...out of this many of its latest stored ones, so newer emails no person
 * rated Exemplary do not hide its older approved ones.
 */
export const nicheReadPerBrand = 30

export type NicheBrand = { captureId: string; domain: string; name: string }

/**
 * "Your niche" (GROS-INS-002): the latest emails of the brands like the
 * store that it does not follow, for it to browse. The brands are the
 * workspace's own suggestions (`suggestable_inbox_brands`: its kind, its
 * industry, never one it follows or hid); their emails are read with the
 * server's client, since a workspace's own session reads only the brands it
 * follows, and only what the page shows leaves the server (a sanitized
 * preview, the subject and a one-hour screenshot link). Real brands appear
 * only with the Observer source on, and then only the emails a person rated
 * Exemplary (`observerAllowed`); sample brands' emails are sample content.
 * A failed read throws.
 */
export async function nicheEmails(
  service: SupabaseClient<Database>,
  brands: readonly NicheBrand[]
): Promise<LibraryItem[]> {
  const shown = brands.filter(
    (b) => isSampleDomain(b.domain) || observerEnabled()
  )
  if (!shown.length) return []
  const reads = await Promise.all(
    shown.map((b) =>
      service
        .from('competitor_emails')
        .select(
          'id,capture_id,external_id,inbox_message_id,subject,text_content,safe_html,received_at,synthetic,screenshot_path,screenshot_width,screenshot_height'
        )
        .eq('capture_id', b.captureId)
        .order('received_at', { ascending: false })
        .order('id')
        .limit(nicheReadPerBrand)
    )
  )
  const failed = reads.find((r) => r.error)
  if (failed?.error) throw failed.error
  const brandOf = new Map(shown.map((b) => [b.captureId, b]))
  const emails = (
    await observerAllowed(reads.flatMap((r) => r.data ?? []))
  ).filter(
    // A sample brand's emails are sample content and a real brand's are
    // real: never the other kind under a brand's name.
    (e) =>
      e.synthetic === isSampleDomain(brandOf.get(e.capture_id)?.domain ?? '')
  )
  // The newest `nichePerBrand` of each brand (each read is newest first).
  const perBrand = new Map<string, number>()
  const kept = emails.filter((e) => {
    const n = (perBrand.get(e.capture_id) ?? 0) + 1
    perBrand.set(e.capture_id, n)
    return n <= nichePerBrand
  })
  const shots = [
    ...new Set(
      kept.flatMap((e) => (e.screenshot_path ? [e.screenshot_path] : []))
    )
  ]
  const signed = shots.length
    ? await service.storage.from('inbox-assets').createSignedUrls(shots, 3600)
    : { data: [], error: null }
  const shotUrl = new Map(
    (signed.data ?? []).flatMap((s) =>
      s.path && s.signedUrl && !s.error ? [[s.path, s.signedUrl] as const] : []
    )
  )
  return kept.map((email) => {
    const brand = brandOf.get(email.capture_id)
    return {
      id: email.id,
      tab: 'competitors',
      source: 'competitor',
      format: classifyFormat(email.safe_html, email.text_content),
      title: email.subject,
      domain: brand?.domain ?? null,
      from: brand?.name ?? brand?.domain ?? '',
      at: email.received_at,
      preview: toSafePreview(email.safe_html),
      text: email.text_content,
      sample: email.synthetic,
      screenshot:
        email.screenshot_path && shotUrl.has(email.screenshot_path)
          ? {
              url: shotUrl.get(email.screenshot_path)!,
              width: email.screenshot_width ?? 600,
              height: email.screenshot_height ?? 900
            }
          : null
    } satisfies LibraryItem
  })
}
