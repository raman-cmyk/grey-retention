import 'server-only'
import { z } from 'zod'
import { logger } from '@/lib/logger'
import { KlaviyoError, type KlaviyoClient, type KlaviyoScope } from './client'

/**
 * Checks a pasted private API key with Klaviyo (KLV-001): one small, read-
 * only request per scope, because no Klaviyo endpoint lists a key's scopes.
 * A 403 means that scope is missing (Klaviyo does not name it, our probe
 * does). Write scopes cannot be read-probed: they are checked when first
 * used. Nothing is ever written to the account.
 */

/** Scopes reading the store needs now (catalog, bestsellers, calendar, segment). */
export const requiredScopes = [
  'accounts:read',
  'catalogs:read',
  'campaigns:read',
  'events:read',
  'lists:read',
  'metrics:read',
  'segments:read'
] as const satisfies readonly KlaviyoScope[]
/** Scopes later steps need (pushing drafts); missing ones are a warning. */
export const laterScopes = [
  'templates:read',
  'images:read',
  // The Klaviyo historian reads the flows and their results (ONB-103).
  'flows:read'
] as const satisfies readonly KlaviyoScope[]
/** Write scopes no read can prove; checked when they are first used. */
export const unverifiedScopes = [
  'segments:write',
  'campaigns:write',
  'templates:write',
  'images:write'
] as const satisfies readonly KlaviyoScope[]

/**
 * The cheapest GET per scope: one record, one field. Every query value is
 * one revision 2026-10-15 accepts (its published OpenAPI spec).
 */
export const probes: Record<
  (typeof requiredScopes)[number] | (typeof laterScopes)[number],
  string
> = {
  'accounts:read':
    '/api/accounts?fields[account]=contact_information,timezone,preferred_currency,locale,industry,test_account',
  'catalogs:read': '/api/catalog-items?page[size]=1&fields[catalog-item]=title',
  'campaigns:read':
    '/api/campaign-messages?page[size]=1&fields[campaign-message]=definition',
  'events:read': '/api/events?page[size]=1&fields[event]=datetime',
  'lists:read': '/api/lists?page[size]=1&fields[list]=name',
  'metrics:read': '/api/metrics?fields[metric]=name',
  'segments:read': '/api/segments?page[size]=1&fields[segment]=name',
  'templates:read': '/api/templates?page[size]=1&fields[template]=name',
  'images:read': '/api/images?page[size]=1&fields[image]=name',
  'flows:read': '/api/flows?page[size]=1&fields[flow]=name'
}

const accountSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        attributes: z.object({
          timezone: z.string().nullish(),
          preferred_currency: z.string().nullish(),
          contact_information: z
            .object({
              organization_name: z.string().nullish(),
              website_url: z.string().nullish(),
              street_address: z
                .object({ country: z.string().nullish() })
                .nullish()
            })
            .nullish()
        })
      })
    )
    .min(1)
})

/** What the account says about the business (only well-formed values). */
export type KlaviyoAccountFacts = {
  /** Klaviyo's id of the account: a key from another account shows. */
  accountId: string
  organization: string | null
  website: string | null
  timezone: string | null
  currency: string | null
  country: string | null
}

export type KeyCheck =
  | {
      ok: true
      account: KlaviyoAccountFacts | null
      /** Required scopes this key lacks: the key is refused when any. */
      missing: KlaviyoScope[]
      /** Scopes later steps need that it lacks (a warning). */
      laterMissing: KlaviyoScope[]
    }
  | {
      ok: false
      /**
       * klaviyo_changed: Klaviyo refused or answered a request in a way this
       * version does not know (logged for the developers).
       */
      reason: 'bad_key' | 'rate_limited' | 'unavailable' | 'klaviyo_changed'
    }

const area =
  /^(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z_\-/]+$/

/**
 * The account's timezone as an Area/City name the runtime knows. A correct
 * name is kept as written (a runtime may spell some older, Asia/Calcutta for
 * Asia/Kolkata); only old aliases such as US/Pacific are mapped.
 */
export function accountZone(zone: string | null | undefined) {
  const name = zone?.trim() ?? ''
  if (!name) return null
  let known: string
  try {
    known = new Intl.DateTimeFormat('en-US', {
      timeZone: name
    }).resolvedOptions().timeZone
  } catch {
    return null
  }
  if (area.test(name)) return name
  return area.test(known) ? known : null
}

/** The website as its https origin: sundari.example, http://x.com/home → https://… */
export function websiteOrigin(value: string | null | undefined) {
  const raw = value?.trim() ?? ''
  if (!raw) return null
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
    )
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const host = url.hostname.toLowerCase()
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? `https://${host}` : null
  } catch {
    return null
  }
}

export function accountFacts(body: unknown): KlaviyoAccountFacts {
  const parsed = accountSchema.safeParse(body)
  const account = parsed.success ? parsed.data.data[0]! : null
  if (!account || !/^[A-Za-z0-9]{1,64}$/.test(account.id))
    throw new KlaviyoError('invalid_response', { endpoint: '/api/accounts/' })
  const a = account.attributes
  const contact = a.contact_information
  const currency = a.preferred_currency?.trim().toUpperCase() ?? ''
  const country = contact?.street_address?.country?.trim().toUpperCase() ?? ''
  const name = contact?.organization_name?.trim() ?? ''
  return {
    accountId: account.id,
    organization: name ? name.slice(0, 200) : null,
    website: websiteOrigin(contact?.website_url),
    timezone: accountZone(a.timezone),
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
    country: /^[A-Z]{2}$/.test(country) ? country : null
  }
}

/** A failure the developers must see: kind, path, status and code, never the key. */
function logChange(error: unknown) {
  const e = error instanceof KlaviyoError ? error : null
  logger.warn('Klaviyo key check: Klaviyo answered unexpectedly', {
    kind: e?.kind ?? 'unknown',
    endpoint: e?.details.endpoint ?? 'unknown',
    status: e?.details.status ?? 0,
    code: e?.details.code ?? 'none'
  })
}

export async function probeKlaviyoKey(
  client: KlaviyoClient
): Promise<KeyCheck> {
  const scopes = [...requiredScopes, ...laterScopes]
  const results = await Promise.all(
    scopes.map(async (scope) => {
      try {
        return { scope, body: await client.get(probes[scope], scope) }
      } catch (error) {
        return { scope, error }
      }
    })
  )
  // A bad key, a rate limit or an outage stops the check: the key is
  // neither accepted nor refused for its scopes.
  for (const kind of ['bad_key', 'rate_limited', 'unavailable'] as const)
    if (
      results.some(
        (r) => r.error instanceof KlaviyoError && r.error.kind === kind
      )
    )
      return { ok: false, reason: kind }
  const failed = results.filter((r) => 'error' in r && r.error)
  const other = failed.find(
    (r) =>
      !(r.error instanceof KlaviyoError && r.error.kind === 'missing_scope')
  )
  if (other) {
    logChange(other.error)
    return { ok: false, reason: 'klaviyo_changed' }
  }
  const missing = new Set(failed.map((r) => r.scope))
  const account = results.find((r) => r.scope === 'accounts:read')
  let facts: KlaviyoAccountFacts | null = null
  if (account && 'body' in account)
    try {
      facts = accountFacts(account.body)
    } catch (error) {
      logChange(error)
      return { ok: false, reason: 'klaviyo_changed' }
    }
  return {
    ok: true,
    account: facts,
    missing: requiredScopes.filter((s) => missing.has(s)),
    laterMissing: laterScopes.filter((s) => missing.has(s))
  }
}
