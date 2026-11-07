import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { deliveryPackageSchema } from '@/features/workflow/domain/contracts'
export async function workflowData(campaignId: string) {
  const context = await requireRequestContext('client')
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const [packages, jobs, notifications, policy] = await Promise.all([
    db
      .from('delivery_packages')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .eq('campaign_id', campaignId)
      .order('revision', { ascending: false }),
    db
      .from('job_runs')
      .select('id,kind,status,attempt,error_code,checkpoint,created_at')
      .eq('tenant_id', context.tenantId)
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false }),
    db
      .from('notifications')
      .select('*')
      .eq('recipient_id', context.userId)
      .eq('entity_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(20),
    db
      .from('delivery_policies')
      .select('defaults')
      .eq('tenant_id', context.tenantId)
      .maybeSingle()
  ])
  const pkg = deliveryPackageSchema.safeParse(packages.data?.[0]?.snapshot)
  const artifactPreviews = pkg.success
    ? await Promise.all(
        pkg.data.assetPaths.map(
          async (path) =>
            (
              await db.storage
                // Packages made before decision D3 may still hold a
                // designer's upload.
                .from(
                  path.endsWith('.svg')
                    ? 'email-artifacts'
                    : 'designer-submissions'
                )
                .createSignedUrl(path, 300)
            ).data?.signedUrl ?? null
        )
      )
    : []
  return {
    artifactPreviews,
    defaults: (policy.data?.defaults ?? {}) as Record<string, string>,
    package: pkg.success ? pkg.data : null,
    jobs: jobs.data ?? [],
    notifications: notifications.data ?? [],
    error: [packages, jobs, notifications, policy].some((r) => r.error)
      ? 'Some workflow records are unavailable.'
      : null
  }
}
