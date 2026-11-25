import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { campaignWorkspace } from '@/features/campaigns/data'
import { createClient } from '@/lib/supabase/server'
import { brandBookView, type BookRow, type BrandBookView } from './book-view'
import { brandProfileData } from './data'
import type { Mismatch } from './mismatch'
import { lastUpdated, profileViews, type SectionView } from './view'

/**
 * What the Brand page (UI-BRAND, `/settings/brand`) shows: the brand
 * version and its approval, the profile's six sections, the catalog and
 * the permitted offers, the brand's history and the latest Brand book's
 * version. Every read is the member's own session (row level security);
 * the page's buttons call the existing server actions, which check the
 * owner again.
 */
export type BrandVersion = {
  revision: number
  approvedRevision: number | null
}

export type CatalogProduct = {
  id: string
  title: string
  stock: number
  source: string
  synthetic: boolean
  stockCheckedAt: string
}

export type PermittedOffer = {
  id: string
  label: string
  conditions: string
  kind: string
  depthPercent: number
  endsAt: string
}

export type BrandHistoryEvent = {
  id: string
  revision: number
  action: string
  at: string
}

export type BrandPageView =
  | { state: 'error'; owner: boolean; reason: string }
  | {
      state: 'ready'
      owner: boolean
      timezone: string
      /** null until the owner saves the Brand identity once. */
      brand: BrandVersion | null
      views: SectionView[]
      lastUpdated: string | null
      mismatches: Mismatch[]
      /** The editable sections need a database update (older database). */
      sectionsUnavailable: boolean
      products: CatalogProduct[]
      offers: PermittedOffer[]
      /** null when the history could not be read. */
      history: BrandHistoryEvent[] | null
      /**
       * The latest Brand book's version and when it was written; null when
       * none is written yet, `unreadable` when it could not be read.
       */
      book: { version: number; writtenAt: string } | 'unreadable' | null
    }

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>

/** The newest Brand book, or null (none yet, or it could not be read). */
async function latestBook(db: Db, tenantId: string) {
  const { data, error } = await db
    .from('brand_books')
    .select('version,content,written_by,created_at')
    .eq('tenant_id', tenantId)
    .order('version', { ascending: false })
    .limit(1)
  if (error) return { error: true, row: null } as const
  return { error: false, row: (data?.[0] as BookRow | undefined) ?? null }
}

const unavailable = (owner: boolean) =>
  ({
    state: 'error',
    owner,
    reason:
      'We could not read your brand just now. Your brand details are safe. Open this page again in a minute.'
  }) as const

/** The Brand page's data for the signed-in member. */
export async function brandPage(): Promise<BrandPageView> {
  const { context, data } = await campaignWorkspace()
  const owner = context.tenantRole === 'owner'
  const db = await createClient()
  if (!data || !db) return unavailable(owner)
  const t = context.tenantId
  const [profile, events, book] = await Promise.all([
    brandProfileData(t, data.brand),
    db
      .from('brand_events')
      .select('id,revision,action,created_at')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(20),
    latestBook(db, t)
  ])
  const rows = profile?.sections ?? []
  return {
    state: 'ready',
    owner,
    timezone: context.timezone,
    brand: data.brand
      ? {
          revision: data.brand.revision,
          approvedRevision: data.brand.approved_revision
        }
      : null,
    views: profileViews(data.brand, rows),
    lastUpdated: lastUpdated(rows),
    mismatches: profile?.mismatches ?? [],
    sectionsUnavailable: !profile || profile.unavailable,
    products: data.products.map((p) => ({
      id: p.id,
      title: p.title,
      stock: p.stock,
      source: p.source,
      synthetic: p.synthetic,
      stockCheckedAt: p.stock_observed_at
    })),
    offers: data.offers.map((o) => ({
      id: o.id,
      label: o.label,
      conditions: o.conditions,
      kind: o.kind,
      depthPercent: o.depth_percent,
      endsAt: o.ends_at
    })),
    history: events.error
      ? null
      : (events.data ?? []).map((e) => ({
          id: e.id,
          revision: e.revision,
          action: e.action,
          at: e.created_at
        })),
    book: book.error
      ? 'unreadable'
      : book.row
        ? { version: book.row.version, writtenAt: book.row.created_at }
        : null
  }
}

export type BrandBookPageView =
  | { state: 'error'; owner: boolean; reason: string }
  | {
      state: 'ready'
      owner: boolean
      timezone: string
      brand: BrandVersion | null
      /** null: no Brand book yet. */
      book: BrandBookView | null
    }

/** The Brand book review page's data for the signed-in member. */
export async function brandBookPage(
  context: ClientRequestContext
): Promise<BrandBookPageView> {
  const owner = context.tenantRole === 'owner'
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return unavailable(owner)
  const [brand, book] = await Promise.all([
    db
      .from('brand_profiles')
      .select('revision,approved_revision')
      .eq('tenant_id', context.tenantId)
      .maybeSingle(),
    latestBook(db, context.tenantId)
  ])
  if (brand.error || book.error)
    return {
      state: 'error',
      owner,
      reason:
        'We could not read your Brand book just now. Nothing was changed. Open this page again in a minute.'
    }
  return {
    state: 'ready',
    owner,
    timezone: context.timezone,
    brand: brand.data
      ? {
          revision: brand.data.revision,
          approvedRevision: brand.data.approved_revision
        }
      : null,
    book: brandBookView(book.row)
  }
}
