'use server'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { createClient } from '@/lib/supabase/server'
import {
  checkKlaviyoKey,
  checkShopDomain,
  checkShopifyToken
} from './credentials'
import { connectionVerifier } from './verifier'

const notLive = 'Live connections are not switched on yet. Nothing was changed.'

async function ownerSession() {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Ask your workspace owner to connect accounts.' } as const
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Please sign in again to connect accounts.' } as const
  const verifier = connectionVerifier()
  if (!verifier) return { error: notLive } as const
  return { context, db, verifier } as const
}

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>

/**
 * Saves the connection. If the hosted database has not had the
 * connection-profile migration yet, falls back to the older status-only
 * command so connecting still works; the details appear after the update.
 */
async function save(
  db: Db,
  args: {
    t: string
    provider: 'klaviyo' | 'shopify'
    account_label: string
    credential_hint: string
    shop_domain?: string
    template_count?: number
  }
) {
  const saved = await db.rpc('connect_sample_provider', args)
  if (saved.error?.code === 'PGRST202')
    return db.rpc('set_fixture_connection', {
      t: args.t,
      provider: args.provider,
      status: 'connected'
    })
  return saved
}

function failed(code: string | undefined) {
  return code === '42501'
    ? 'Ask your workspace owner to connect accounts.'
    : 'We could not save this connection. Nothing was changed. Try again.'
}

/** Connect Klaviyo, or swap the key: nothing changes unless the new key passes. */
export async function connectKlaviyo(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const key = checkKlaviyoKey(form.get('apiKey'))
  if (!key.ok) return { error: key.error }
  const { context, db, verifier } = session
  const brand = await db
    .from('brand_profiles')
    .select('brand_name')
    .eq('tenant_id', context.tenantId)
    .maybeSingle()
  const account = await verifier.klaviyo({
    keyHint: key.value.hint,
    workspaceLabel: brand.data?.brand_name || context.tenantName
  })
  const saved = await save(db, {
    t: context.tenantId,
    provider: 'klaviyo',
    account_label: account.accountLabel,
    credential_hint: key.value.hint,
    template_count: account.templateCount
  })
  if (saved.error) return { error: failed(saved.error.code) }
  revalidatePath('/connections')
  revalidatePath('/dashboard')
  return {
    message: verifier.live
      ? 'Klaviyo connected.'
      : 'Klaviyo connected with sample data. Nothing was sent to Klaviyo.'
  }
}

/** Connect Shopify; then queue a sample product sync for the scheduler. */
export async function connectShopify(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await ownerSession()
  if ('error' in session) return { error: session.error }
  const domain = checkShopDomain(form.get('shopDomain'))
  if (!domain.ok) return { error: domain.error }
  const token = checkShopifyToken(form.get('accessToken'))
  if (!token.ok) return { error: token.error }
  const { context, db, verifier } = session
  const account = await verifier.shopify({
    shopDomain: domain.value,
    tokenHint: token.value.hint
  })
  const saved = await save(db, {
    t: context.tenantId,
    provider: 'shopify',
    account_label: account.accountLabel,
    credential_hint: token.value.hint,
    shop_domain: domain.value
  })
  if (saved.error) return { error: failed(saved.error.code) }
  // Same idempotent sample sync the setup tools queue; the worker runs it.
  await db.rpc('enqueue_onboarding_job', {
    t: context.tenantId,
    kind: 'commerce.sync'
  })
  revalidatePath('/connections')
  revalidatePath('/store')
  revalidatePath('/brand')
  return {
    message: verifier.live
      ? 'Shopify connected.'
      : 'Shopify connected with sample products. Nothing was sent to Shopify.'
  }
}
