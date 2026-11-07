import 'server-only'
import { sourceFormat } from '@/features/email-generation/html'
import { toSafePreview } from '@/features/email-generation/to-safe-preview'
import { readPages } from '@/lib/db/read-pages'
import { createClient } from '@/lib/supabase/server'
import { classifyFormat, latestUploads, type LibraryItem } from './model'

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
  /** True when there may be older uploads than the latest 40 read. */
  uploadsCapped: boolean
}

/** The latest sends per competitor shown in the library (spec §9). */
export const latestPerDomain = 20
/** The most tracked domains at a time (the database checks it too). */
export const domainLimit = 10

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
  // Only what the library shows is read: the latest 20 per domain (one
  // small query each, at most 10 domains) and the latest uploads.
  const [captures, perDomain, imports, templates] = await Promise.all([
    ids.length
      ? db
          .from('competitor_captures')
          .select('id,domain,status,synthetic')
          .in('id', ids)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(
      ids.map((id) =>
        db
          .from('competitor_emails')
          .select(
            'id,capture_id,subject,text_content,safe_html,received_at,synthetic,screenshot_path,screenshot_width,screenshot_height'
          )
          .eq('capture_id', id)
          .order('received_at', { ascending: false })
          .order('id')
          .limit(latestPerDomain)
      )
    ),
    db
      .from('reference_imports')
      .select(
        'id,subject,original_body,readable_text,content_format,source_description,created_at'
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .order('id')
      .limit(latestUploads),
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
  const emails = {
    error: perDomain.find((r) => r.error)?.error ?? null,
    data: perDomain.flatMap((r) => r.data ?? [])
  }
  if (captures.error || emails.error || imports.error || templates.error)
    return null
  const captureById = new Map((captures.data ?? []).map((c) => [c.id, c]))
  const labelByCapture = new Map(
    subscriptions.data.map((s) => [s.capture_id, s.label])
  )
  // Screenshots are signed with the member's own session: storage lets it
  // read only those of emails from domains this workspace follows.
  const shots = [
    ...new Set(
      emails.data.flatMap((e) => (e.screenshot_path ? [e.screenshot_path] : []))
    )
  ]
  const signed = shots.length
    ? await db.storage.from('inbox-assets').createSignedUrls(shots, 3600)
    : { data: [], error: null }
  const shotUrl = new Map(
    (signed.data ?? []).flatMap((s) =>
      s.path && s.signedUrl && !s.error ? [[s.path, s.signedUrl] as const] : []
    )
  )
  const perCapture = new Map<string, number>()
  const items: LibraryItem[] = []
  for (const email of emails.data) {
    perCapture.set(
      email.capture_id,
      (perCapture.get(email.capture_id) ?? 0) + 1
    )
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
    })
  }
  for (const row of imports.data ?? []) {
    const html = sourceFormat(row) === 'html' ? row.original_body : null
    items.push({
      id: row.id,
      tab: 'yours',
      source: 'import',
      format: classifyFormat(html, row.readable_text),
      title: row.subject,
      domain: null,
      from: row.source_description || 'Your upload',
      at: row.created_at,
      preview: toSafePreview(html),
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
      from: 'Saved layout (sample send)',
      at: row.created_at,
      preview: null,
      text: 'A layout saved from one of your campaigns after a sample send: hero, copy and call to action.',
      // Every saved layout comes from a sample (fixture) send in this version.
      sample: true
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
  return {
    items,
    tracked,
    uploadsCapped: (imports.data?.length ?? 0) >= latestUploads
  }
}
