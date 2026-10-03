import 'server-only'
import { campaignWorkspace } from '@/features/campaigns/data'
import { createClient } from '@/lib/supabase/server'
import { readiness } from './readiness'
export async function onboardingWorkspace() {
  const base = await campaignWorkspace()
  if (!base.data) return { ...base, setup: null }
  const db = (await createClient())!,
    t = base.context.tenantId
  const [
    connections,
    assets,
    imports,
    items,
    versions,
    events,
    kit,
    variants,
    jobs
  ] = await Promise.all([
    db.from('workspace_connections').select('*').eq('tenant_id', t),
    db
      .from('assets')
      .select('*')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false }),
    db
      .from('asset_imports')
      .select('*')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(10),
    db
      .from('asset_import_items')
      .select('*')
      .eq('tenant_id', t)
      .order('id')
      .limit(100),
    db
      .from('brand_versions')
      .select('*')
      .eq('tenant_id', t)
      .order('revision', { ascending: false }),
    db
      .from('brand_events')
      .select('*')
      .eq('tenant_id', t)
      .order('created_at', { ascending: false })
      .limit(20),
    db.from('brand_kits').select('*').eq('tenant_id', t).maybeSingle(),
    db.from('product_variants').select('*').eq('tenant_id', t),
    db
      .from('job_runs')
      .select('*')
      .eq('tenant_id', t)
      .is('campaign_id', null)
      .order('created_at', { ascending: false })
      .limit(20)
  ])
  if (
    [
      connections,
      assets,
      imports,
      items,
      versions,
      events,
      kit,
      variants,
      jobs
    ].some((r) => r.error)
  )
    return {
      ...base,
      error: 'Onboarding evidence unavailable. Check migrations and retry.',
      setup: null
    }
  const previews = await Promise.all(
    (assets.data ?? []).map(async (a) => ({
      ...a,
      preview:
        (
          await db.storage
            .from('brand-assets')
            .createSignedUrl(a.storage_path, 300)
        ).data?.signedUrl ?? null
    }))
  )
  const state = readiness({
    connected:
      connections.data?.some(
        (c) => c.provider === 'klaviyo' && c.status === 'connected'
      ) ?? false,
    approvedProfile: Boolean(
      base.data.brand &&
      base.data.brand.approved_revision === base.data.brand.revision
    ),
    whitelistSaved: base.data.offers.some(
      (o) =>
        new Date(o.starts_at) <= new Date() && new Date(o.ends_at) > new Date()
    ),
    classifiedAssets: previews.filter(
      (a) => a.category && a.category !== 'unusable'
    ).length,
    competitors: []
  })
  return {
    ...base,
    setup: {
      connections: connections.data ?? [],
      assets: previews,
      imports: imports.data ?? [],
      items: items.data ?? [],
      versions: versions.data ?? [],
      events: events.data ?? [],
      kit: kit.data,
      variants: variants.data ?? [],
      jobs: jobs.data ?? [],
      readiness: state
    }
  }
}
