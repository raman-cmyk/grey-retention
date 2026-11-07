import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FormResult } from '@/components/ui/action-form'
import { isKnownTimezone } from '@/lib/brand-time'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/supabase/database.types'
import {
  probeKlaviyoKey,
  requiredScopes,
  type KeyCheck
} from '@/lib/providers/klaviyo/check-key'
import {
  klaviyoClient,
  klaviyoRevision,
  type KlaviyoScope
} from '@/lib/providers/klaviyo/client'

/**
 * Live or sample Klaviyo for the Connections screen (KLV-001). Live calls
 * Klaviyo with the key the owner pastes and keeps it encrypted; sample only
 * checks its format. Live only when KLAVIYO_MODE is exactly `live`: an
 * owner's decision, set in Vercel. Anything else, or nothing, is sample.
 */
export function klaviyoMode(
  env: Record<string, string | undefined> = process.env
): 'live' | 'sample' {
  return env.KLAVIYO_MODE === 'live' ? 'live' : 'sample'
}

/**
 * The revision the client speaks. A different KLAVIYO_API_REVISION in the
 * settings stops live checks (never a silent mismatch).
 */
function revisionOk(env: Record<string, string | undefined> = process.env) {
  const set = env.KLAVIYO_API_REVISION?.trim()
  return !set || set === klaviyoRevision
}

/** The areas of Klaviyo's key settings, as the owner sees them there. */
const areaOf: Record<KlaviyoScope, string> = {
  'accounts:read': 'Accounts',
  'campaigns:read': 'Campaigns',
  'campaigns:write': 'Campaigns',
  'catalogs:read': 'Catalogs',
  'events:read': 'Events',
  'lists:read': 'Lists',
  'metrics:read': 'Metrics',
  'profiles:read': 'Profiles',
  'segments:read': 'Segments',
  'segments:write': 'Segments',
  'templates:read': 'Templates',
  'templates:write': 'Templates',
  'images:read': 'Images',
  'images:write': 'Images'
}
/** "Catalogs and Events", "Accounts, Campaigns and Lists". */
function areas(scopes: readonly KlaviyoScope[]) {
  const names = [...new Set(scopes.map((s) => areaOf[s]))]
  return names.length < 2
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** Areas later steps write to (drafts, the Engaged segment). */
const writeLater: KlaviyoScope[] = [
  'campaigns:write',
  'segments:write',
  'templates:write',
  'images:write'
]
const writeAreas = new Set(writeLater.map((s) => areaOf[s]))

/**
 * How to make a key that works: Klaviyo cannot change an existing key. Each
 * area is named once, with the access it needs now and later.
 */
const newKeySteps = `Klaviyo cannot change an existing key, so please make a new one. In Klaviyo, open Settings, then API keys, then Create Private API Key. Choose Read Access for ${areas(requiredScopes.filter((s) => !writeAreas.has(areaOf[s])))}. Choose Read/Write Access for ${areas(writeLater)}, so GROS can send emails later. Then paste the new key here.`

/** What the owner reads when a key cannot be used, in plain words. */
export function refusalWords(check: KeyCheck): string | null {
  if (!check.ok)
    return {
      bad_key:
        'Klaviyo did not accept this key. Check that you copied the whole private key. It starts with pk_. Also check that it was not deleted in Klaviyo. Nothing was saved.',
      rate_limited:
        'Klaviyo asked us to slow down. Wait a minute, then paste the key again. Nothing was saved.',
      unavailable:
        'We could not reach Klaviyo just now. Try again in a few minutes. Nothing was saved.',
      klaviyo_changed:
        'Klaviyo answered in a way we do not understand yet. We told the developers. Nothing was saved.'
    }[check.reason]
  if (check.missing.length)
    return `This key cannot read ${areas(check.missing)}. ${newKeySteps} Nothing was saved.`
  return null
}

/**
 * Checks the pasted key with Klaviyo and, when it can read everything this
 * step needs, saves the live connection and the encrypted key. The key is
 * passed on only to Klaviyo and to the database command, never logged.
 */
export async function connectLiveKlaviyo(
  db: SupabaseClient<Database>,
  input: { tenantId: string; apiKey: string; hint: string; brandName: string },
  check: (apiKey: string) => Promise<KeyCheck> = (apiKey) =>
    // A paste waits for no rate limit: the owner sees the answer quickly.
    probeKlaviyoKey(klaviyoClient(apiKey, { timeoutMs: 8_000, maxWaits: 0 }))
): Promise<FormResult> {
  if (!revisionOk()) {
    logger.warn('Klaviyo key check refused: KLAVIYO_API_REVISION differs', {
      supported: klaviyoRevision
    })
    return {
      error:
        'Live Klaviyo is not set up correctly yet. We told the developers. Nothing was saved.'
    }
  }
  // At most 5 checks per workspace in 15 minutes (the store's Klaviyo
  // quota is shared with its other apps).
  const begun = await db.rpc('begin_klaviyo_key_check', { t: input.tenantId })
  if (begun.error)
    return {
      error:
        begun.error.code === 'PT409'
          ? 'You tried several keys in a short time. Please wait 15 minutes, then try again. Nothing was saved.'
          : begun.error.code === '42501'
            ? 'Ask your workspace owner to connect accounts.'
            : 'We could not check this key just now. Try again. Nothing was saved.'
    }
  const result = await check(input.apiKey)
  const refused = refusalWords(result)
  if (refused || !result.ok || !result.account)
    return { error: refused ?? 'Try again. Nothing was saved.' }
  const a = result.account
  const saved = await db.rpc('connect_klaviyo_live', {
    t: input.tenantId,
    api_key: input.apiKey,
    credential_hint: input.hint,
    account_label: (a.organization ?? input.brandName).slice(0, 200),
    klaviyo_account_id: a.accountId,
    api_revision: klaviyoRevision,
    later_missing: result.laterMissing,
    account_timezone:
      a.timezone && isKnownTimezone(a.timezone) ? a.timezone : undefined,
    account_website: a.website ?? undefined,
    account_currency: a.currency ?? undefined,
    account_country: a.country ?? undefined
  })
  if (saved.error)
    return {
      error:
        saved.error.code === '42501'
          ? 'Ask your workspace owner to connect accounts.'
          : 'We could not save this connection. Nothing was changed. Try again.'
    }
  const later = result.laterMissing.length
    ? ` Later, to send emails, GROS also needs ${areas(result.laterMissing)}: make a new key then.`
    : ''
  return {
    message: `Klaviyo connected: ${a.organization ?? 'your account'}. For now we only read your Klaviyo data. Nothing is sent until you approve it.${later}`
  }
}
