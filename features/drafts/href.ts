import type { Route } from 'next'

/**
 * UI-OLDc: the GROS addresses of a draft made from an Inspiration email.
 * `/inspiration/use` starts it (the old `/first-draft`), and the draft
 * opens at `/plan/draft/<id>` (the old `/campaigns/<id>`).
 */
export const startDraftPath = '/inspiration/use'

export type DraftStart =
  { reference: string } | { imported: string } | Record<string, never>

/** "Use this design": the GROS form with the email already chosen. */
export function startDraftHref(start: DraftStart = {}): Route {
  const query = new URLSearchParams(start as Record<string, string>)
  const search = query.toString()
  return `${startDraftPath}${search ? `?${search}` : ''}` as Route
}

/** A saved draft's own GROS page. */
export function draftHref(id: string): Route {
  return `/plan/draft/${encodeURIComponent(id)}` as Route
}
