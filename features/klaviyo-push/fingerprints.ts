import { createHash } from 'node:crypto'

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
