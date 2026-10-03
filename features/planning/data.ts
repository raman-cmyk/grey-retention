import 'server-only'
import { createClient } from '@/lib/supabase/server'
export async function planningData(tenantId: string) {
  const db = await createClient()
  if (!db) return null
  const [plans, preferences, batches, contents, rules, jobs] =
    await Promise.all([
      db
        .from('calendar_plans')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(10),
      db
        .from('planning_preferences')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      db
        .from('copy_review_batches')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(10),
      db.from('campaign_content').select('*').eq('tenant_id', tenantId),
      db
        .from('owner_rules')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('active', true),
      db
        .from('job_runs')
        .select('id,kind,status,error_code,attempt')
        .eq('tenant_id', tenantId)
        .in('kind', ['calendar.plan', 'copy.generate', 'reviews.remind'])
        .order('created_at', { ascending: false })
        .limit(30)
    ])
  if ([plans, preferences, batches, contents, rules, jobs].some((r) => r.error))
    return null
  return {
    plans: plans.data ?? [],
    preferences: preferences.data,
    batches: batches.data ?? [],
    contents: contents.data ?? [],
    rules: rules.data ?? [],
    jobs: jobs.data ?? []
  }
}
