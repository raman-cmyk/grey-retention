import 'server-only'
import type { KlaviyoClient } from '@/lib/providers/klaviyo/client'
import { templateParts, type DraftRead } from '@/lib/providers/klaviyo/drafts'
import { designHash, htmlHash } from './html'

/**
 * What each variation of a GROS draft showed when a push last left it
 * (PSH-001's `klaviyo_draft_pushes.shown`): the template on it (Klaviyo's
 * copy), a fingerprint of that template's HTML as Klaviyo keeps it, and
 * whether a write of ours was under way (`w`). Other HTML in that template
 * later, or another template on the variation, is the owner's edit in
 * Klaviyo: the pusher never overwrites it, and the results sync (PICK-99)
 * records it as `design_changed`.
 */
export type Shown = Record<
  string,
  { template: string; html: string; writing: boolean }
>

export const shownOf = (s: string | null): Shown =>
  Object.fromEntries(
    (s ? s.split(',') : []).map((entry) => {
      const [variation, template, html, w] = entry.split(':')
      return [variation!, { template: template!, html: html!, writing: !!w }]
    })
  )

export const shownText = (m: Shown) =>
  Object.keys(m)
    .sort()
    .map((v) => {
      const { template, html, writing } = m[v]!
      return `${v}:${template}:${html}${writing ? ':w' : ''}`
    })
    .join(',') || null

/**
 * Whether a template still shows what we recorded (`fingerprint`), with or
 * without its plain text (TXT-001e): a push of the same email as a letter,
 * then as a designed one (or back), is never taken for an owner's edit. A
 * template Klaviyo no longer has is not ours any more.
 */
export async function stillOurs(
  client: KlaviyoClient,
  templateId: string,
  fingerprint: string
) {
  const parts = await templateParts(client, templateId)
  return (
    parts !== null &&
    (htmlHash(parts.html).slice(0, 16) === fingerprint ||
      designHash(parts.html, parts.text ?? '').slice(0, 16) === fingerprint)
  )
}

/**
 * PICK-99: whether a draft's design was changed in Klaviyo since the push
 * left it, as the pusher judges it (GET only): a variation we recorded that
 * shows another template we were not putting on, or our template with other
 * HTML (or gone). A variation we never recorded says nothing (the
 * subject/preview fingerprints cover a new one). Null when nothing was
 * recorded (a draft from before PSH-001 kept it): unknown, never "edited".
 * Each template read goes through `before` (the caller's time and pace);
 * Klaviyo's errors are the caller's.
 */
export async function designEdited(
  client: KlaviyoClient,
  draft: Pick<DraftRead, 'variations'>,
  shown: string | null,
  before: () => Promise<void> = async () => undefined
): Promise<boolean | null> {
  const was = shownOf(shown)
  if (!Object.keys(was).length) return null
  for (const v of draft.variations) {
    const w = was[v.id]
    if (!w) continue
    if (v.templateId !== w.template) {
      // Another template: ours only while we were putting it on.
      if (!w.writing) return true
      continue
    }
    await before()
    if (!(await stillOurs(client, w.template, w.html))) return true
  }
  return false
}
