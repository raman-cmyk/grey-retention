import { createHash } from 'node:crypto'
import { designHash, htmlHash } from './html'

/**
 * A draft's variations as one fingerprint list (what a reader sees of
 * each: its subject and preview). PSH-001 stores the list after each
 * write; LRN-001 compares it to tell a draft changed outside the app.
 */

/** Text as Klaviyo may keep it: trimmed, each run of spaces as one. */
export const norm = (s: string | null | undefined) =>
  (s ?? '').trim().replace(/\s+/g, ' ')
/** One variation's fingerprint: what a reader sees of it (subject, preview). */
export const seen = (v: { subject: string | null; preview: string | null }) =>
  createHash('sha256')
    .update(JSON.stringify([norm(v.subject), norm(v.preview)]))
    .digest('hex')
    .slice(0, 16)
export const fingerprints = (
  vs: { subject: string | null; preview: string | null }[]
) => [...new Set(vs.map(seen))].sort().join(',')

/**
 * PSH-001's `shown`, read: per variation, the template on it (Klaviyo's
 * copy), a fingerprint of that template's HTML as Klaviyo keeps it (not
 * always byte for byte what we sent), and whether we were changing it
 * (`w`). LRN-001b reads it to see a design changed in Klaviyo.
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

/**
 * Whether a template's parts still show what was recorded (`fingerprint`),
 * with or without its plain text (TXT-001e): a push of the same email as a
 * letter, then as a designed one (or back), is never taken for an edit.
 */
export const showsRecorded = (
  parts: { html: string; text: string | null },
  fingerprint: string
) =>
  htmlHash(parts.html).slice(0, 16) === fingerprint ||
  designHash(parts.html, parts.text ?? '').slice(0, 16) === fingerprint
