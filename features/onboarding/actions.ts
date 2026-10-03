'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { FormResult } from '@/components/ui/action-form'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { runFixtureJobs } from '@/features/integrations/worker'
const commands = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('connection'),
    provider: z.enum(['klaviyo', 'shopify', 'drive']),
    status: z.enum(['connected', 'disconnected', 'expired', 'error']),
    folder: z.string().max(80)
  }),
  z.object({
    kind: z.literal('queue'),
    job: z.enum([
      'assets.classify',
      'drive.sync',
      'commerce.sync',
      'brand.extract'
    ]),
    sourceText: z.string().max(10000)
  }),
  z.object({ kind: z.literal('run') }),
  z.object({
    kind: z.literal('kit_approve'),
    revision: z.coerce.number().int().positive()
  }),
  z.object({
    kind: z.literal('stock'),
    product: z.uuid(),
    stock: z.coerce.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('correct'),
    asset: z.uuid(),
    revision: z.coerce.number().int().positive(),
    category: z.enum(['product', 'lifestyle', 'proof', 'logo', 'unusable']),
    product: z.union([z.uuid(), z.literal('')]),
    variant: z.union([z.uuid(), z.literal('')])
  })
])
export async function onboardingAction(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return {
      error:
        'Only the active owner may change onboarding evidence or fixture connections.'
    }
  const parsed = commands.safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Invalid fields.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Supabase authentication required.' }
  try {
    const v = parsed.data
    let result: { error: { code?: string; message: string } | null } | undefined
    if (v.kind === 'connection')
      result = await db.rpc('set_fixture_connection', {
        t: context.tenantId,
        provider: v.provider,
        status: v.status,
        folder: v.folder || undefined
      })
    if (v.kind === 'queue')
      result = await db.rpc('enqueue_onboarding_job', {
        t: context.tenantId,
        kind: v.job,
        input: { sourceText: v.sourceText }
      })
    if (v.kind === 'run') await runFixtureJobs(db, context.tenantId)
    if (v.kind === 'kit_approve')
      result = await db.rpc('approve_brand_kit', {
        t: context.tenantId,
        expected_revision: v.revision
      })
    if (v.kind === 'stock')
      result = await db.rpc('refresh_catalog_stock', {
        t: context.tenantId,
        product: v.product,
        stock: v.stock
      })
    if (v.kind === 'correct')
      result = await db.rpc('correct_asset', {
        t: context.tenantId,
        asset: v.asset,
        expected_revision: v.revision,
        category: v.category,
        product: v.product || undefined,
        variant: v.variant || undefined
      })
    if (result?.error)
      return {
        error: ['23514', '40001'].includes(result.error.code ?? '')
          ? result.error.message
          : 'Command denied or unavailable.'
      }
    for (const path of ['/brand', '/assets', '/connections', '/campaign-agent'])
      revalidatePath(path)
    return {
      message:
        v.kind === 'queue'
          ? 'Fixture intent queued. Run queued setup jobs to process it.'
          : v.kind === 'run'
            ? 'Fixture job pass completed. Inspect persisted outcomes.'
            : 'Saved. Refresh retains this evidence.'
    }
  } catch {
    return {
      error:
        'Fixture processing unavailable. Inspect job state and retry safely.'
    }
  }
}
