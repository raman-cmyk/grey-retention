import 'server-only'
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
  let processed = 0
  for (let n = 0; n < Math.min(limit, 4); n++) {
    const claimed = await db.rpc('claim_job', { t: tenantId })
    if (claimed.error) throw claimed.error
    const job = claimed.data?.[0]
    if (!job) break
    if (!job.lease_token) throw new Error('Job lease missing')
    try {
      if (planningJobKinds.includes(job.kind)) {
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
        if (job.kind === 'delivery.schedule') {
          const reconciliation = await provider.reconcile(job.idempotency_key)
          if (reconciliation.outcome === 'unknown')
            throw new Error('Reconciliation is inconclusive')
          const identity =
            reconciliation.outcome === 'found'
              ? reconciliation.identity
              : await provider.prepare(pkg, job.idempotency_key)
          await provider.schedule(identity, pkg.scheduledAt)
        } else if (job.kind === 'delivery.cancel') {
          await provider.cancel(input.providerId ?? '', job.idempotency_key)
        } else throw new Error('Unsupported job kind')
        const result = await db.rpc('finish_delivery_job', {
          job: job.id,
          lease: job.lease_token
        })
        if (result.error) throw result.error
      }
      processed++
    } catch {
      const failed = await db.rpc('fail_job', {
        job: job.id,
        lease: job.lease_token,
        failure: 'validation'
      })
      if (failed.error)
        throw new Error('Job failed; lease recovery is required.')
    }
  }
  return processed
}
