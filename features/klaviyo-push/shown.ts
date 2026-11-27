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

/** PICK-99: where a draft differs in Klaviyo from the push's record. */
export type DesignMismatch = {
  variation: string
  /** The fingerprint the push recorded. */
  recorded: string
  /** What Klaviyo shows now: our template's new fingerprint, or `other_` and the template's id. */
  current: string
}

/**
 * PICK-99: whether a draft's design differs in Klaviyo from what the push
 * left (GET only): a variation we recorded that shows another template, or
 * our template with other HTML. `false`: as the push left it. Null:
 * unknown, never "edited": nothing recorded (a draft from before PSH-001
 * kept it), a write of ours under way on any variation (`:w`), a variation
 * with no template, or a template Klaviyo does not give (404). A variation
 * we never recorded says nothing (the subject/preview fingerprints cover a
 * new one). Each template read goes through `before` (the caller's time
 * and pace); Klaviyo's other errors are the caller's.
 */
export async function designEdited(
  client: KlaviyoClient,
  draft: Pick<DraftRead, 'variations'>,
  shown: string | null,
  before: () => Promise<void> = async () => undefined
): Promise<DesignMismatch | false | null> {
  const was = shownOf(shown)
  const recorded = Object.values(was)
  // Nothing recorded, or one of our writes may still be landing.
  if (!recorded.length || recorded.some((w) => w.writing)) return null
  for (const v of draft.variations) {
    const w = was[v.id]
    if (!w) continue
    if (!v.templateId) return null
    if (v.templateId !== w.template)
      return {
        variation: v.id,
        recorded: w.html,
        current: `other_${v.templateId}`
      }
    await before()
    const parts = await templateParts(client, w.template)
    if (parts === null) return null
    const html = htmlHash(parts.html).slice(0, 16)
    const withText = designHash(parts.html, parts.text ?? '').slice(0, 16)
    if (html !== w.html && withText !== w.html)
      return { variation: v.id, recorded: w.html, current: html }
  }
  return false
}
