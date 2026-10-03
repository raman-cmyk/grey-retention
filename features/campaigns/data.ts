import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'

export async function campaignWorkspace() {
  const context = await requireRequestContext('client')
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return {
      context,
      data: null,
      error: 'Connect a local Supabase session to use persisted campaigns.'
    }
  const [campaigns, products, offers, audiences, brand] = await Promise.all([
    db
      .from('campaigns')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .order('planned_at'),
    db
      .from('products')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .order('title'),
    db
      .from('offers')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .order('label'),
    db.from('audiences').select('*').eq('tenant_id', context.tenantId),
    db
      .from('brand_profiles')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .maybeSingle()
  ])
  if ([campaigns, products, offers, audiences, brand].some((r) => r.error))
    return {
      context,
      data: null,
      error: 'Workspace data is unavailable. Check local migrations and retry.'
    }
  return {
    context,
    data: {
      campaigns: campaigns.data ?? [],
      products: products.data ?? [],
      offers: offers.data ?? [],
      audiences: audiences.data ?? [],
      brand: brand.data
    },
    error: null
  }
}
export async function campaignDetail(id: string) {
  const workspace = await campaignWorkspace()
  if (!workspace.data)
    return {
      ...workspace,
      campaign: null,
      content: null,
      events: [],
      comments: [],
      approvals: []
    }
  const campaign = workspace.data.campaigns.find((c) => c.id === id)
  if (!campaign)
    return {
      ...workspace,
      campaign: null,
      content: null,
      events: [],
      comments: [],
      approvals: []
    }
  const db = (await createClient())!
  const [content, events, comments, approvals] = await Promise.all([
    db
      .from('campaign_content')
      .select('*')
      .eq('tenant_id', workspace.context.tenantId)
      .eq('campaign_id', id)
      .eq('revision', campaign.copy_revision)
      .maybeSingle(),
    db
      .from('campaign_events')
      .select('*')
      .eq('tenant_id', workspace.context.tenantId)
      .eq('campaign_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    db
      .from('campaign_comments')
      .select('*')
      .eq('tenant_id', workspace.context.tenantId)
      .eq('campaign_id', id)
      .order('created_at'),
    db
      .from('campaign_approvals')
      .select('*')
      .eq('tenant_id', workspace.context.tenantId)
      .eq('campaign_id', id)
      .order('created_at')
  ])
  return {
    ...workspace,
    campaign,
    content: content.data,
    events: events.data ?? [],
    comments: comments.data ?? [],
    approvals: approvals.data ?? [],
    error: [content, events, comments, approvals].some((r) => r.error)
      ? 'Some campaign history is unavailable. Refresh to retry.'
      : null
  }
}
