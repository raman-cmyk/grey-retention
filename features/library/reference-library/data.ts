import 'server-only'
import { emailFormat, previewHtml } from '@/features/email-generation/html'
import type { SafePreview } from '@/features/email-generation/safe-preview'
import { readPages } from '@/lib/db/read-pages'
import { createClient } from '@/lib/supabase/server'
import { classifyFormat, type LibraryItem } from './model'

/** A competitor domain the workspace tracks. */
export type TrackedDomain = {
  subscriptionId: string
  revision: number
  domain: string
  label: string
  /** LIVE once emails arrive; PENDING while waiting; ERROR on a failure. */
  status: 'live' | 'pending' | 'error'
  emails: number
  sample: boolean
}

export type ReferenceLibraryData = {
  items: LibraryItem[]
  tracked: TrackedDomain[]
}

/** The latest sends per competitor shown in the library (spec §9). */
export const latestPerDomain = 20
/** The most tracked domains at a time (the database checks it too). */
export const domainLimit = 10

/** Sanitized on the server; the raw email never reaches the browser. */
function safe(html: string | null): SafePreview | null {
  if (!html) return null
  return { kind: 'sandboxed-preview', html: previewHtml(html).html }
}

/**
 * LIVE once emails have arrived (a capture with fewer than 10 is still
 * live), ERROR when the capture failed, PENDING while waiting.
 */
const statusOf = (
  status: string | undefined,
  emails: number
): TrackedDomain['status'] =>
  status === 'error'
    ? 'error'
    : emails > 0 && (status === 'live' || status === 'degraded')
      ? 'live'
      : 'pending'

/**
 * Everything the reference library shows for one workspace, read with the
 * owner's or staff member's own session (row-level security applies):
 * competitor emails of the domains it tracks (the latest 20 each), its own
 * pasted or uploaded references, and its saved templates. Best picks are
 * curated by the platform team and do not exist yet. Null when the
 * database cannot be read.
 */
export async function referenceLibrary(
  tenantId: string
): Promise<ReferenceLibraryData | null> {
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const subscriptions = await readPages((from, to) =>
    db
      .from('competitor_subscriptions')
      .select('id,capture_id,label,revision,active')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('label')
      .order('id')
      .range(from, to)
  )
  if (subscriptions.error || !subscriptions.data) return null
  const ids = subscriptions.data.map((s) => s.capture_id)
  const [captures, emails, imports, templates] = await Promise.all([
    ids.length
      ? db
          .from('competitor_captures')
          .select('id,domain,status,synthetic')
          .in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? readPages((from, to) =>
          db
            .from('competitor_emails')
            .select(
              'id,capture_id,subject,text_content,safe_html,received_at,synthetic'
            )
            .in('capture_id', ids)
            .order('received_at', { ascending: false })
            .order('id')
            .range(from, to)
        )
      : Promise.resolve({ data: [], error: null }),
    readPages((from, to) =>
      db
        .from('reference_imports')
        .select(
          'id,subject,original_body,readable_text,content_format,source_description,created_at'
        )
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to)
    ),
    readPages((from, to) =>
      db
        .from('own_templates')
        .select('id,name,created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to)
    )
  ])
  if (captures.error || emails.error || imports.error || templates.error)
    return null
  const captureById = new Map((captures.data ?? []).map((c) => [c.id, c]))
  const labelByCapture = new Map(
    subscriptions.data.map((s) => [s.capture_id, s.label])
  )
  const perCapture = new Map<string, number>()
  const items: LibraryItem[] = []
  for (const email of emails.data ?? []) {
    const seen = perCapture.get(email.capture_id) ?? 0
    perCapture.set(email.capture_id, seen + 1)
    if (seen >= latestPerDomain) continue
    const capture = captureById.get(email.capture_id)
    items.push({
      id: email.id,
      tab: 'competitors',
      source: 'competitor',
      format: classifyFormat(email.safe_html, email.text_content),
      title: email.subject,
      domain: capture?.domain ?? null,
      from: labelByCapture.get(email.capture_id) ?? capture?.domain ?? '',
      at: email.received_at,
      preview: safe(email.safe_html),
      text: email.text_content,
      sample: email.synthetic
    })
  }
  for (const row of imports.data ?? []) {
    const html =
      (row.content_format ?? emailFormat(row.original_body)) === 'html'
        ? row.original_body
        : null
    items.push({
      id: row.id,
      tab: 'yours',
      source: 'import',
      format: classifyFormat(html, row.readable_text),
      title: row.subject,
      domain: null,
      from: row.source_description || 'Your upload',
      at: row.created_at,
      preview: safe(html),
      text: row.readable_text,
      sample: false
    })
  }
  for (const row of templates.data ?? []) {
    items.push({
      id: row.id,
      tab: 'yours',
      source: 'template',
      format: 'design',
      title: row.name,
      domain: null,
      from: 'Saved from a sent campaign',
      at: row.created_at,
      preview: null,
      text: 'A layout saved from one of your sent campaigns: hero, copy and call to action.',
      sample: false
    })
  }
  const tracked: TrackedDomain[] = subscriptions.data.map((s) => {
    const capture = captureById.get(s.capture_id)
    return {
      subscriptionId: s.id,
      revision: s.revision,
      domain: capture?.domain ?? '',
      label: s.label,
      status: statusOf(capture?.status, perCapture.get(s.capture_id) ?? 0),
      emails: perCapture.get(s.capture_id) ?? 0,
      sample: capture?.synthetic ?? true
    }
  })
  return { items, tracked }
}
