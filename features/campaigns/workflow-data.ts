import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { deliveryPackageSchema } from '@/features/workflow/domain/contracts'
export async function workflowData(campaignId: string) {
  const context = await requireRequestContext('client')
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const [assignments, packages, jobs, notifications] = await Promise.all([
    db
      .from('designer_assignments')
      .select('*')
      .eq('tenant_id', context.tenantId)
      .eq('campaign_id', campaignId)
      .neq('state', 'cancelled'),
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
      .limit(20)
  ])
  const assignment = assignments.data?.[0]
  let submissions: {
    id: string
    revision: number
    copy_revision: number
    notes: string
    preview: string | null
  }[] = []
  let reviews: {
    id: string
    decision: string
    section: string
    feedback: string
    submission_id: string
  }[] = []
  if (assignment) {
    const [s, r] = await Promise.all([
      db
        .from('designer_submissions')
        .select('*')
        .eq('tenant_id', context.tenantId)
        .eq('assignment_id', assignment.id)
        .order('revision', { ascending: false }),
      db
        .from('designer_reviews')
        .select('*')
        .eq('tenant_id', context.tenantId)
        .eq('assignment_id', assignment.id)
        .order('created_at', { ascending: false })
    ])
    submissions = await Promise.all(
      (s.data ?? []).map(async (row) => ({
        ...row,
        preview:
          (
            await db.storage
              .from('designer-submissions')
              .createSignedUrl(row.storage_path, 300)
          ).data?.signedUrl ?? null
      }))
    )
    reviews = r.data ?? []
  }
  const pkg = deliveryPackageSchema.safeParse(packages.data?.[0]?.snapshot)
  const artifactPreviews = pkg.success
    ? await Promise.all(
        pkg.data.assetPaths.map(
          async (path) =>
            (
              await db.storage
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
    assignment,
    submissions,
    reviews,
    package: pkg.success ? pkg.data : null,
    jobs: jobs.data ?? [],
    notifications: notifications.data ?? [],
    error: [assignments, packages, jobs, notifications].some((r) => r.error)
      ? 'Some workflow records are unavailable.'
      : null
  }
}
