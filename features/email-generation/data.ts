import 'server-only'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

type Row<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type EmailRevision = Row<'email_result_revisions'>
export type EmailGeneration = Pick<
  Row<'email_generations'>,
  | 'id'
  | 'state'
  | 'failure_code'
  | 'provider'
  | 'created_at'
  | 'output_revision'
>

const uuid = z.uuid()

// Every read filters by the server-authorized tenant in addition to RLS, so an
// actor with several workspaces only ever sees the active one.
async function client() {
  const db = await createClient()
  return !db || process.env.AUTH_MODE === 'demo' ? null : db
}

export async function emailChoice(tenantId: string, importId: string) {
  if (!uuid.safeParse(importId).success) return { data: null, error: null }
  const db = await client()
  if (!db) return { data: null, error: null }
  const [imported, brand, products, offers, results] = await Promise.all([
    db
      .from('reference_imports')
      .select(
        'id,subject,original_body,content_format,file_import_id,created_at'
      )
      .eq('tenant_id', tenantId)
      .eq('id', importId)
      .maybeSingle(),
    db
      .from('brand_profiles')
      .select('brand_name,domain')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db
      .from('products')
      .select('id,title')
      .eq('tenant_id', tenantId)
      .order('title')
      .limit(50),
    db
      .from('offers')
      .select('id,label,ends_at')
      .eq('tenant_id', tenantId)
      .gt('ends_at', new Date().toISOString())
      .order('ends_at')
      .limit(20),
    db
      .from('email_results')
      .select('id,mode,created_at,email_sources!inner(reference_import_id)')
      .eq('tenant_id', tenantId)
      .eq('email_sources.reference_import_id', importId)
      .order('created_at', { ascending: false })
      .limit(5)
  ])
  const error = [imported, brand, products, offers, results].some(
    (r) => r.error
  )
    ? 'This email could not load. Try again.'
    : null
  if (!imported.data) return { data: null, error }
  return {
    data: {
      imported: imported.data,
      brand: brand.data,
      products: products.data ?? [],
      offers: offers.data ?? [],
      results: (results.data ?? []).map(({ id, mode, created_at }) => ({
        id,
        mode,
        created_at
      }))
    },
    error
  }
}

export async function emailResult(
  tenantId: string,
  resultId: string,
  version?: number
) {
  if (!uuid.safeParse(resultId).success) return { data: null, error: null }
  const db = await client()
  if (!db) return { data: null, error: null }
  const result = await db
    .from('email_results')
    .select('id,campaign_id,source_id,mode,current_revision,created_at')
    .eq('tenant_id', tenantId)
    .eq('id', resultId)
    .maybeSingle()
  if (result.error)
    return { data: null, error: 'This email could not load. Try again.' }
  if (!result.data) return { data: null, error: null }
  const r = result.data
  const shown =
    version && version >= 1 && version <= r.current_revision
      ? version
      : r.current_revision
  const [source, revisions, revision, generations, campaign, brand] =
    await Promise.all([
      db
        .from('email_sources')
        .select(
          'id,subject,format,original,original_sha256,reference_import_id,created_at'
        )
        .eq('tenant_id', tenantId)
        .eq('id', r.source_id)
        .single(),
      db
        .from('email_result_revisions')
        .select('revision,origin,subject,created_at')
        .eq('tenant_id', tenantId)
        .eq('result_id', r.id)
        .order('revision', { ascending: false })
        .limit(50),
      shown
        ? db
            .from('email_result_revisions')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('result_id', r.id)
            .eq('revision', shown)
            .single()
        : Promise.resolve({ data: null, error: null }),
      // Owners/admins only (RLS); other members see an empty list.
      db
        .from('email_generations')
        .select('id,state,failure_code,provider,created_at,output_revision')
        .eq('tenant_id', tenantId)
        .eq('result_id', r.id)
        .order('created_at', { ascending: false })
        .limit(5),
      db
        .from('campaigns')
        .select(
          'id,title,copy_revision,copy_state,calendar_state,delivery_state'
        )
        .eq('tenant_id', tenantId)
        .eq('id', r.campaign_id)
        .single(),
      db
        .from('brand_profiles')
        .select('brand_name')
        .eq('tenant_id', tenantId)
        .maybeSingle()
    ])
  const error = [
    source,
    revisions,
    revision,
    generations,
    campaign,
    brand
  ].some((x) => x.error)
    ? 'Part of this email could not load. Try again.'
    : null
  if (!source.data || !campaign.data) return { data: null, error }
  return {
    data: {
      result: r,
      source: source.data,
      revisions: revisions.data ?? [],
      revision: revision.data as EmailRevision | null,
      generations: (generations.data ?? []) as EmailGeneration[],
      campaign: campaign.data,
      brandName: brand.data?.brand_name ?? null
    },
    error
  }
}

/** Exact stored text for an authenticated export; never rendered by the app. */
export async function emailExport(
  tenantId: string,
  resultId: string,
  part: 'original' | 'html' | 'text',
  version: number | null
) {
  if (!uuid.safeParse(resultId).success) return null
  const db = await client()
  if (!db) return null
  const result = await db
    .from('email_results')
    .select('id,source_id,current_revision')
    .eq('tenant_id', tenantId)
    .eq('id', resultId)
    .maybeSingle()
  if (result.error || !result.data) return null
  if (part === 'original') {
    const source = await db
      .from('email_sources')
      .select('subject,format,original')
      .eq('tenant_id', tenantId)
      .eq('id', result.data.source_id)
      .single()
    if (source.error) return null
    return {
      subject: source.data.subject,
      kind:
        source.data.format === 'html' ? ('html' as const) : ('text' as const),
      body: source.data.original,
      label: 'original'
    }
  }
  const revisionNumber = version ?? result.data.current_revision
  const revision = await db
    .from('email_result_revisions')
    .select('subject,html,body_text,revision')
    .eq('tenant_id', tenantId)
    .eq('result_id', resultId)
    .eq('revision', revisionNumber)
    .maybeSingle()
  if (revision.error || !revision.data) return null
  if (part === 'html' && revision.data.html === null) return null
  return {
    subject: revision.data.subject,
    kind: part,
    body: part === 'html' ? revision.data.html! : revision.data.body_text,
    label: `v${revision.data.revision}`
  }
}

export async function latestEmailResult(tenantId: string) {
  const db = await client()
  if (!db) return { data: null, error: null }
  const latest = await db
    .from('email_results')
    .select('id,mode,created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return {
    data: latest.data,
    error: latest.error ? 'Your emails could not load.' : null
  }
}
