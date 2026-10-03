import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import {
  FixtureAssetClassifier,
  FixtureCatalogMatcher,
  FixtureDrive,
  FixtureCommerce,
  FixtureBrandKitExtractor
} from './fixture-adapters'
import { inspectAsset } from './archive'
import { persistPrivateAsset } from './intake'
type Job = Database['public']['Tables']['job_runs']['Row']
export const onboardingJobKinds = [
  'assets.classify',
  'drive.sync',
  'commerce.sync',
  'brand.extract'
]
export async function runOnboardingJob(db: SupabaseClient<Database>, job: Job) {
  let output: Database['public']['Tables']['job_runs']['Row']['checkpoint'] = {
    synthetic: true
  }
  if (job.kind === 'assets.classify') {
    const input = z
      .object({
        assetRevisions: z.array(
          z.object({ id: z.uuid(), revision: z.number().int() })
        )
      })
      .parse(job.input)
    const assets = await db
      .from('assets')
      .select('*')
      .eq('tenant_id', job.tenant_id)
      .in(
        'id',
        input.assetRevisions.map((a) => a.id)
      )
    const variants = await db
      .from('product_variants')
      .select('*')
      .eq('tenant_id', job.tenant_id)
    if (assets.error || variants.error)
      throw new Error('Asset evidence unavailable')
    const matcher = new FixtureCatalogMatcher(
      (assets.data ?? []).map((a) => ({
        id: a.id,
        tenantId: a.tenant_id,
        filename: a.filename
      })),
      (variants.data ?? []).map((v) => ({
        id: v.id,
        productId: v.product_id,
        sku: v.sku
      }))
    )
    const classifications = await Promise.all(
      (assets.data ?? []).map(async (a) => {
        const tag = await new FixtureAssetClassifier().classify(a.filename)
        const match =
          tag.category === 'product'
            ? await matcher.match(a.id, a.tenant_id)
            : { productId: null, variantId: null, confidence: 0 }
        return { id: a.id, category: tag.category, ...match }
      })
    )
    output = { synthetic: true, assets: classifications }
  } else if (job.kind === 'drive.sync') {
    const input = z
      .object({ folderId: z.string(), connectionRevision: z.number() })
      .parse(job.input)
    const connection = await db
      .from('workspace_connections')
      .select('status,revision')
      .eq('tenant_id', job.tenant_id)
      .eq('provider', 'drive')
      .single()
    if (
      connection.error ||
      connection.data.status !== 'connected' ||
      connection.data.revision !== input.connectionRevision
    )
      throw new Error('Fixture folder connection changed')
    const adapter = new FixtureDrive(),
      batch = await adapter.list(input.folderId, null),
      ids: string[] = []
    for (const f of batch.files) {
      const asset = await persistPrivateAsset(
        db,
        job.tenant_id,
        job.created_by,
        inspectAsset(f.name, adapter.bytes(f.id)),
        'drive_fixture'
      )
      ids.push(asset.id)
    }
    output = { synthetic: true, assetIds: ids, cursor: batch.cursor }
  } else if (job.kind === 'commerce.sync') {
    const brand = await db
      .from('brand_profiles')
      .select('domain')
      .eq('tenant_id', job.tenant_id)
      .single()
    if (brand.error) throw new Error('Brand domain unavailable')
    const data = await new FixtureCommerce(brand.data.domain).products(null)
    output = { synthetic: true, products: data.products }
  } else if (job.kind === 'brand.extract') {
    const input = z
      .object({ sourceText: z.string().max(10000) })
      .parse(job.input)
    output = await new FixtureBrandKitExtractor().extract(input.sourceText)
  } else throw new Error('Unsupported onboarding job')
  const finished = await db.rpc('finish_onboarding_job', {
    job: job.id,
    lease: job.lease_token!,
    output
  })
  if (finished.error) throw finished.error
}
