import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { inboxConfig } from '../config'

export type OpsTask = {
  id: string
  kind: string
  occurrences: number
  createdAt: string
  detail: Record<string, unknown>
  /** The email the task is about, when there is one. */
  email: {
    id: string
    subject: string
    fromDomain: string | null
    aliasSlug: string | null
    receivedAt: string
    state: string
  } | null
}

export type DirectoryBrand = {
  id: string
  domain: string
  name: string
  niche: string | null
  aliasSlug: string
  /**
   * The address to subscribe with, e.g. inbox+northwind@gmail.com; null
   * while the Gmail inbox is not set up.
   */
  address: string | null
  subscription: string
  lastEmailAt: string | null
  emails: number
  senders: string[]
  sample: boolean
}

export type InboxAdminData = { tasks: OpsTask[]; brands: DirectoryBrand[] }

/** The sample inbox's own address, for sample brands. */
const sampleBase = { local: 'capture', domain: 'inbox.example' }

/**
 * A brand's subscribe address: the inbox's own address with the brand's
 * +alias. Real brands use the configured Gmail inbox; when it is not set up
 * the address says so instead of guessing.
 */
export function aliasAddress(
  slug: string,
  sample: boolean,
  env: Parameters<typeof inboxConfig>[0] = process.env
) {
  const config = inboxConfig(env)
  const base = sample
    ? sampleBase
    : config.ready && !config.transport.synthetic
      ? config.transport.base
      : null
  return base ? `${base.local}+${slug}@${base.domain}` : null
}

/**
 * Everything the admin inbox page shows, read with the admin's own session
 * (row-level security lets platform admins read; nobody else sees any of
 * it). Null when the database cannot be read.
 */
export async function inboxAdminData(): Promise<InboxAdminData | null> {
  const db = await createClient()
  if (!db) return null
  const [tasks, brands, counts] = await Promise.all([
    db
      .from('ops_tasks')
      .select('id,kind,subject_id,occurrences,detail,created_at')
      .eq('state', 'open')
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('competitor_captures')
      .select(
        'id,domain,alias_slug,brand_name,niche,subscription_status,last_received_at,synthetic'
      )
      .not('alias_slug', 'is', null)
      .order('brand_name')
      .limit(500),
    // Counted in the database: a list of rows would stop at 1,000.
    db.rpc('admin_inbox_brand_counts')
  ])
  if (tasks.error || brands.error || counts.error) return null
  const subjectIds = [
    ...new Set(
      (tasks.data ?? []).flatMap((t) => (t.subject_id ? [t.subject_id] : []))
    )
  ]
  const emails = subjectIds.length
    ? await db
        .from('inbox_messages')
        .select('id,subject,from_domain,alias_slug,received_at,state')
        .in('id', subjectIds)
    : { data: [], error: null }
  if (emails.error) return null
  const emailById = new Map((emails.data ?? []).map((e) => [e.id, e]))
  const countOf = new Map((counts.data ?? []).map((c) => [c.capture_id, c]))
  return {
    tasks: (tasks.data ?? []).map((t) => {
      const e = t.subject_id ? emailById.get(t.subject_id) : undefined
      return {
        id: t.id,
        kind: t.kind,
        occurrences: t.occurrences,
        createdAt: t.created_at,
        detail: (t.detail ?? {}) as Record<string, unknown>,
        email: e
          ? {
              id: e.id,
              subject: e.subject,
              fromDomain: e.from_domain,
              aliasSlug: e.alias_slug,
              receivedAt: e.received_at,
              state: e.state
            }
          : null
      }
    }),
    brands: (brands.data ?? []).map((b) => ({
      id: b.id,
      domain: b.domain,
      name: b.brand_name ?? b.domain,
      niche: b.niche,
      aliasSlug: b.alias_slug!,
      address: aliasAddress(b.alias_slug!, b.synthetic),
      subscription: b.subscription_status,
      lastEmailAt: b.last_received_at,
      emails: countOf.get(b.id)?.emails ?? 0,
      senders: countOf.get(b.id)?.senders ?? [],
      sample: b.synthetic
    }))
  }
}
