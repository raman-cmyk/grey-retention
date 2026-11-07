'use server'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { createClient } from '@/lib/supabase/server'
import { checkKlaviyoKey } from './credentials'
import { connectionVerifier, type AccountReport } from './verifier'
import { isKnownTimezone } from '@/lib/brand-time'

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

/** Arguments an older hosted database does not know yet, newest first. */
const olderDatabases = [
  ['account_website', 'account_currency', 'account_country'],
  ['account_timezone']
] as const

/**
 * Saves the connection. If the hosted database has not had the latest
 * updates yet, saves without the arguments it does not know (account facts,
 * then the account timezone); if it has not had the connection-profile
 * update either, falls back to the older status-only command. Connecting always works; the details appear after
 * the update.
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
    account_timezone?: string
    account_website?: string
    account_currency?: string
    account_country?: string
  }
) {
  let sent = args
  let saved = await db.rpc('connect_sample_provider', sent)
  // Newest first: the account facts (UIR-021), then the timezone (UIR-023).
  for (const newer of olderDatabases) {
    if (saved.error?.code !== 'PGRST202') break
    if (!newer.some((key) => sent[key] !== undefined)) continue
    const older = { ...sent }
    for (const key of newer) delete older[key]
    sent = older
    saved = await db.rpc('connect_sample_provider', sent)
  }
  if (saved.error?.code === 'PGRST202')
    return db.rpc('set_fixture_connection', {
      t: args.t,
      provider: args.provider,
      status: 'connected'
    })
  return saved
}

/**
 * Only well-formed facts are saved (the database checks them again). The
 * website is kept as its origin only (`https://host`): the guard needs the
 * host, and nothing after it can then hold a key.
 */
function accountFacts(account: AccountReport) {
  const website = account.website?.match(
    /^(https:\/\/[a-z0-9.-]+\.[a-z]{2,})\/?$/
  )?.[1]
  return {
    account_website: website && website.length <= 300 ? website : undefined,
    account_currency:
      account.currency && /^[A-Z]{3}$/.test(account.currency)
        ? account.currency
        : undefined,
    account_country:
      account.country && /^[A-Z]{2}$/.test(account.country)
        ? account.country
        : undefined
  }
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
    workspaceLabel: brand.data?.brand_name || context.tenantName,
    workspaceTimezone: context.timezone
  })
  const saved = await save(db, {
    t: context.tenantId,
    provider: 'klaviyo',
    account_label: account.accountLabel,
    credential_hint: key.value.hint,
    template_count: account.templateCount,
    // Becomes the brand timezone unless the owner chose one (UIR-023).
    account_timezone: isKnownTimezone(account.timezone)
      ? account.timezone
      : undefined,
    ...accountFacts(account)
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
