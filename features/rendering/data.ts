import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { stripSchema } from './renderer'
import { z } from 'zod'
export async function renderData(tenantId: string, campaignId: string) {
  const db = await createClient()
  if (!db) return null
  const [renders, templates, references] = await Promise.all([
    db
      .from('design_renders')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('campaign_id', campaignId)
      .order('revision', { ascending: false }),
    db
      .from('own_templates')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    db
      .from('competitor_emails')
      .select('id,subject')
      .order('received_at', { ascending: false })
      .limit(20)
  ])
  if ([renders, templates, references].some((r) => r.error)) return null
  const latest = renders.data?.[0],
    strips = latest ? z.array(stripSchema).parse(latest.strips) : []
  const previews = await Promise.all(
    strips.map(async (s) => ({
      ...s,
      preview:
        (await db.storage.from('email-artifacts').createSignedUrl(s.path, 300))
          .data?.signedUrl ?? null
    }))
  )
  const reviews = latest
    ? await db
        .from('render_reviews')
        .select('*')
        .eq('tenant_id', tenantId)
        .in(
          'render_id',
          (renders.data ?? []).map((r) => r.id)
        )
        .order('created_at', { ascending: false })
    : null
  return {
    latest,
    renders: renders.data ?? [],
    templates: templates.data ?? [],
    references: references.data ?? [],
    strips: previews,
    reviews: reviews?.data ?? []
  }
}
