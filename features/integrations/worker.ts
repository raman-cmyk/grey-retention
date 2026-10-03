import 'server-only'
import { classifyFailure, ProviderFault } from './failures'
import { runRenderJob } from '@/features/rendering/worker'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { deliveryPackageSchema } from '@/features/workflow/domain/contracts'
import {
  referenceJobKinds,
  runReferenceJob
} from '@/features/references/worker'
import { generateFixtureCopy } from '@/features/ai/fixture-copy'
import { onboardingJobKinds, runOnboardingJob } from '@/features/assets/worker'
import { planningJobKinds, runPlanningJob } from '@/features/planning/worker'
import { PersistedFixtureDeliveryProvider } from './fixture-delivery'
export async function runFixtureJobs(
  db: SupabaseClient<Database>,
  tenantId: string,
  limit = 4
) {
  if (process.env.ADAPTER_MODE === 'real')
    throw new Error('Live providers are disabled for this build.')
  const health = await db.rpc('enqueue_health_check', { t: tenantId })
  if (health.error) throw health.error
  const sweep = await db.rpc('queue_ready_l1', { t: tenantId })
  if (sweep.error) throw sweep.error
  let processed = 0
  for (let n = 0; n < Math.min(limit, 4); n++) {
    const claimed = await db.rpc('claim_job', { t: tenantId })
    if (claimed.error) throw claimed.error
    const job = claimed.data?.[0]
    if (!job) break
    if (!job.lease_token) throw new Error('Job lease missing')
    try {
      const budgetFeature =
        job.kind === 'copy.generate'
          ? 'copy'
          : job.kind === 'design.render'
            ? 'design'
            : job.kind === 'assets.classify'
              ? 'assets'
              : job.kind === 'playbook.synthesize'
                ? 'playbook'
                : job.kind === 'calendar.plan'
                  ? 'calendar'
                  : null
      if (budgetFeature) {
        const reservation = await db.rpc('reserve_fixture_usage', {
          t: tenantId,
          operation: job.id,
          feature: budgetFeature,
          estimate: 2000
        })
        if (reservation.error) throw reservation.error
      }
      if (job.kind === 'ops.health') {
        const r = await db.rpc('finish_health_check', {
          job: job.id,
          lease: job.lease_token
        })
        if (r.error) throw r.error
      } else if (job.kind === 'design.render') {
        await runRenderJob(db, job)
      } else if (planningJobKinds.includes(job.kind)) {
        await runPlanningJob(db, job)
      } else if (referenceJobKinds.includes(job.kind)) {
        await runReferenceJob(db, job)
      } else if (onboardingJobKinds.includes(job.kind)) {
        await runOnboardingJob(db, job)
      } else if (job.kind === 'copy.generate') {
        const campaignResult = await db
          .from('campaigns')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('id', job.campaign_id!)
          .single()
        const c = campaignResult.data
        if (campaignResult.error || !c) throw new Error('Campaign unavailable')
        const brand = await db
          .from('brand_profiles')
          .select('*')
          .eq('tenant_id', tenantId)
          .single()
        if (brand.error || !brand.data) throw new Error('Brand unavailable')
        let productTitle: string | null = null
        let url = `https://${brand.data.domain}`
        if (c.product_id) {
          const product = await db
            .from('products')
            .select('title,url')
            .eq('tenant_id', tenantId)
            .eq('id', c.product_id)
            .single()
          if (product.error || !product.data)
            throw new Error('Product unavailable')
          productTitle = product.data.title
          url = product.data.url
        }
        const output = generateFixtureCopy({
          brandRevision: brand.data.revision,
          brandName: brand.data.brand_name,
          title: c.title,
          productTitle,
          url
        })
        const result = await db.rpc('finish_copy_job', {
          job: job.id,
          lease: job.lease_token,
          output
        })
        if (result.error) throw result.error
      } else {
        const input = job.input as { packageId?: string; providerId?: string }
        const packageResult = await db
          .from('delivery_packages')
          .select('snapshot')
          .eq('tenant_id', tenantId)
          .eq('id', input.packageId ?? '')
          .single()
        if (packageResult.error || !packageResult.data)
          throw new Error('Package unavailable')
        const pkg = deliveryPackageSchema.parse(packageResult.data.snapshot)
        const provider = new PersistedFixtureDeliveryProvider(db, job)
        await provider.probe('before')
        const reconciliation = await provider.reconcile(job.idempotency_key)
        if (reconciliation.outcome === 'unknown')
          throw new ProviderFault('unknown_outcome')
        if (job.kind === 'delivery.schedule') {
          const identity =
            reconciliation.outcome === 'found'
              ? reconciliation.identity
              : await provider.prepare(pkg, job.idempotency_key)
          if (identity.state === 'prepared')
            await provider.schedule(identity, pkg.scheduledAt)
          else if (!['scheduled', 'sent'].includes(identity.state))
            throw new Error('Provider is no longer schedulable')
          await provider.probe('after_schedule')
        } else if (job.kind === 'delivery.reschedule') {
          if (reconciliation.outcome !== 'found')
            throw new ProviderFault('unknown_outcome')
          if (
            reconciliation.identity.packageId !== pkg.id ||
            Date.parse(reconciliation.identity.scheduledAt ?? '') !==
              Date.parse(pkg.scheduledAt)
          )
            await provider.reschedule(
              input.providerId ?? '',
              pkg.scheduledAt,
              job.idempotency_key
            )
          await provider.probe('after_schedule')
        } else if (job.kind === 'delivery.cancel') {
          if (reconciliation.outcome !== 'found')
            throw new ProviderFault('unknown_outcome')
          if (!['cancelled', 'sent'].includes(reconciliation.identity.state))
            await provider.cancel(input.providerId ?? '', job.idempotency_key)
        } else throw new Error('Unsupported job kind')
        const result = await db.rpc('finish_delivery_job', {
          job: job.id,
          lease: job.lease_token
        })
        if (result.error) throw result.error
      }
      processed++
    } catch (error) {
      const failed = await db.rpc('fail_job', {
        job: job.id,
        lease: job.lease_token,
        failure: classifyFailure(error)
      })
      if (failed.error)
        throw new Error('Job failed; lease recovery is required.')
    }
  }
  return processed
}
