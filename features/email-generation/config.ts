import 'server-only'
import { z } from 'zod'
import {
  defaultRewriteModel,
  isRewriteModel,
  type RewriteModel
} from './pricing'

export type SetupReason =
  | 'missing_key'
  | 'unsupported_model'
  | 'invalid_base_url'
  | 'sample_disabled'
  | 'missing_service_credential'
  | 'workspace_not_enabled'

export type RewriteSetup =
  | {
      ready: true
      provider: 'openai'
      model: RewriteModel
      apiKey: string
      baseUrl: string
      timeoutMs: number
    }
  | { ready: true; provider: 'sample'; model: 'sample'; timeoutMs: number }
  | { ready: false; provider: 'openai' | 'sample'; reason: SetupReason }

const settings = z.object({
  EMAIL_REWRITE_PROVIDER: z.enum(['openai', 'sample']).catch('openai'),
  OPENAI_API_KEY: z.string().trim().optional(),
  OPENAI_BASE_URL: z.string().trim().optional(),
  OPENAI_REWRITE_MODEL: z.string().trim().optional(),
  OPENAI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(120_000)
    .catch(60_000),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().optional(),
  EMAIL_REWRITE_TENANT_IDS: z.string().optional()
})

const uuid = z.uuid()
/** Pilot ceiling: an allowlist, never a wildcard or open signup. */
export const maxEnabledWorkspaces = 50

/**
 * Temporary pilot entitlement for real (paid) OpenAI requests: exact
 * workspace UUIDs from a server-only setting. Anything else, including a
 * wildcard, is ignored. Commercial packages and billing are not implemented,
 * so a self-created workspace or the synthetic starter package never counts.
 */
export function enabledWorkspaces(raw: string | undefined) {
  const ids = (raw ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => uuid.safeParse(value).success)
  return new Set(ids.slice(0, maxEnabledWorkspaces))
}

export const officialBaseUrl = 'https://api.openai.com/v1'

/**
 * Server-only destination: the official endpoint, or a loopback test double
 * outside production. No other host can receive the key or pasted email.
 */
function allowedBaseUrl(raw: string | undefined, production: boolean) {
  if (!raw) return officialBaseUrl
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const value = url.href.replace(/\/$/, '')
  if (value === officialBaseUrl) return value
  if (url.username || url.password || url.search || url.hash || production)
    return null
  if (
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  )
    return value
  return null
}

/**
 * Reads server-only settings on every call; never exposes the key. Real
 * OpenAI is the default. The sample writer must be chosen explicitly and is
 * never available in production. Without the server worker credential no
 * provider work can be leased, so setup is reported instead.
 */
export function rewriteSetup(
  env: NodeJS.ProcessEnv = process.env,
  tenantId?: string
): RewriteSetup {
  const s = settings.parse({
    EMAIL_REWRITE_PROVIDER: env.EMAIL_REWRITE_PROVIDER,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_BASE_URL: env.OPENAI_BASE_URL,
    OPENAI_REWRITE_MODEL: env.OPENAI_REWRITE_MODEL,
    OPENAI_TIMEOUT_MS: env.OPENAI_TIMEOUT_MS,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    EMAIL_REWRITE_TENANT_IDS: env.EMAIL_REWRITE_TENANT_IDS
  })
  const production = env.NODE_ENV === 'production'
  if (s.EMAIL_REWRITE_PROVIDER === 'sample') {
    if (production)
      return { ready: false, provider: 'sample', reason: 'sample_disabled' }
    if (!s.SUPABASE_SERVICE_ROLE_KEY)
      return {
        ready: false,
        provider: 'sample',
        reason: 'missing_service_credential'
      }
    return {
      ready: true,
      provider: 'sample',
      model: 'sample',
      timeoutMs: s.OPENAI_TIMEOUT_MS
    }
  }
  if (!s.OPENAI_API_KEY)
    return { ready: false, provider: 'openai', reason: 'missing_key' }
  const model = s.OPENAI_REWRITE_MODEL || defaultRewriteModel
  if (!isRewriteModel(model))
    return { ready: false, provider: 'openai', reason: 'unsupported_model' }
  const baseUrl = allowedBaseUrl(s.OPENAI_BASE_URL, production)
  if (!baseUrl)
    return { ready: false, provider: 'openai', reason: 'invalid_base_url' }
  if (!s.SUPABASE_SERVICE_ROLE_KEY)
    return {
      ready: false,
      provider: 'openai',
      reason: 'missing_service_credential'
    }
  // Paid requests need an enabled workspace. Only a loopback test double,
  // which allowedBaseUrl never accepts in production, is exempt.
  const testDouble = baseUrl !== officialBaseUrl && !production
  if (
    !testDouble &&
    !(
      tenantId &&
      enabledWorkspaces(s.EMAIL_REWRITE_TENANT_IDS).has(tenantId.toLowerCase())
    )
  )
    return { ready: false, provider: 'openai', reason: 'workspace_not_enabled' }
  return {
    ready: true,
    provider: 'openai',
    model,
    apiKey: s.OPENAI_API_KEY,
    baseUrl,
    timeoutMs: s.OPENAI_TIMEOUT_MS
  }
}

/** Safe for rendering: no key material, no URLs. */
export function rewriteAvailability(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const setup = rewriteSetup(env, tenantId)
  return setup.ready
    ? {
        ready: true as const,
        sample: setup.provider === 'sample',
        reason: null
      }
    : { ready: false as const, sample: false, reason: setup.reason }
}
