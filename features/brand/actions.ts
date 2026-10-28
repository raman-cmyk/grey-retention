'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import type { FormResult } from '@/components/ui/action-form'
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('save'),
    revision: z.coerce.number().int().nonnegative(),
    brand_name: z.string().trim().min(2).max(120),
    domain: z.string().max(300),
    positioning: z.string().max(5000),
    voice: z.string().max(5000),
    prohibitions: z.string().max(5000)
  }),
  z.object({
    kind: z.literal('approve'),
    revision: z.coerce.number().int().positive()
  }),
  z.object({
    kind: z.literal('product'),
    title: z.string().trim().min(2).max(200),
    url: z.url().refine((u) => new URL(u).protocol === 'https:'),
    price_minor: z.coerce.number().int().nonnegative(),
    stock: z.coerce.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal('offer'),
    label: z.string().trim().min(2).max(200),
    offer_kind: z.enum(['evergreen', 'discount', 'sitewide']),
    depth_percent: z.coerce.number().int().min(0).max(100),
    conditions: z.string().min(1).max(2000),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime()
  })
])
export async function brandAction(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only an owner may update or approve brand inputs.' }
  const parsed = schema.safeParse(Object.fromEntries(form))
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Check the fields.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Sign in through local Supabase to persist brand inputs.' }
  const v = parsed.data
  let error: { code?: string } | null = null
  if (v.kind === 'save')
    ({ error } = await db.rpc('save_brand', {
      t: context.tenantId,
      expected_revision: v.revision,
      brand_name: v.brand_name,
      domain: v.domain,
      positioning: v.positioning,
      voice: v.voice,
      prohibitions: v.prohibitions
    }))
  if (v.kind === 'approve')
    ({ error } = await db.rpc('approve_brand', {
      t: context.tenantId,
      expected_revision: v.revision
    }))
  if (v.kind === 'product')
    ({ error } = await db.rpc('create_product', {
      t: context.tenantId,
      title: v.title,
      url: v.url,
      price_minor: v.price_minor,
      stock: v.stock
    }))
  if (v.kind === 'offer')
    ({ error } = await db.rpc('create_offer', {
      t: context.tenantId,
      label: v.label,
      kind: v.offer_kind,
      depth_percent: v.depth_percent,
      conditions: v.conditions,
      starts_at: v.starts_at,
      ends_at: v.ends_at
    }))
  if (error)
    return {
      error:
        error.code === 'PT409'
          ? 'Brand context changed. Refresh before approving.'
          : 'Could not save. Check permissions and field values.'
    }
  revalidatePath('/get-started')
  revalidatePath('/brand')
  revalidatePath('/campaign-agent')
  return {
    message:
      v.kind === 'approve'
        ? 'Brand version approved.'
        : 'Saved. Refresh retains your changes.'
  }
}
