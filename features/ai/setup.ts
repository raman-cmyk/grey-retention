import 'server-only'
import { z } from 'zod'
import {
  defaultGeminiModels,
  isGeminiModel,
  type AiPurpose,
  type GeminiModel
} from '@/lib/providers/gemini-pricing'
import {
  isRewriteModel,
  type RewriteModel
} from '@/features/email-generation/pricing'

/**
 * REL-PRV: the second provider's model per purpose: only models in its
 * price table (`rewriteModels`), so every call has a known cost ceiling.
 */
export const defaultOpenAiModels: Record<AiPurpose, RewriteModel> = {
  label: 'gpt-6-luna',
  copy: 'gpt-6.1-terra',
  plan: 'gpt-6.1-terra',
  review: 'gpt-6.1-terra'
}

/** The only OpenAI address v2 calls go to (no proxies in v2). */
export const openAiBaseUrl = 'https://api.openai.com/v1'

export type AiSetup =
  | {
      ready: true
      provider: 'gemini'
      model: GeminiModel
      apiKey: string
      timeoutMs: number
    }
  | {
      ready: true
      provider: 'fake'
      model: 'fake'
      reason: 'fake_selected' | 'missing_key'
      timeoutMs: number
    }
  | {
      ready: true
      provider: 'openai'
      model: RewriteModel
      apiKey: string
      baseUrl: string
      timeoutMs: number
    }
  | { ready: false; provider: 'gemini' | 'openai'; reason: 'unsupported_model' }

const settings = z.object({
  AI_DEFAULT_PROVIDER: z.string().trim().optional(),
  GEMINI_API_KEY: z.string().trim().optional(),
  GEMINI_LABEL_MODEL: z.string().trim().optional(),
  GEMINI_COPY_MODEL: z.string().trim().optional(),
  GEMINI_PLAN_MODEL: z.string().trim().optional(),
  GEMINI_REVIEW_MODEL: z.string().trim().optional(),
  GEMINI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(120_000)
    .catch(60_000),
  OPENAI_API_KEY: z.string().trim().optional(),
  OPENAI_LABEL_MODEL: z.string().trim().optional(),
  OPENAI_COPY_MODEL: z.string().trim().optional(),
  OPENAI_PLAN_MODEL: z.string().trim().optional(),
  OPENAI_REVIEW_MODEL: z.string().trim().optional(),
  OPENAI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(120_000)
    .catch(60_000)
})

/**
 * Decision D5. Reads server-only settings on every call and never exposes the
 * key. An explicit AI_DEFAULT_PROVIDER=fake always wins (tests and Claude
 * sessions force it). AI_DEFAULT_PROVIDER=openai picks the second provider
 * (REL-PRV, off by default; with OPENAI_API_KEY, else the fake). Otherwise
 * GEMINI_API_KEY, which the owner added for
 * decision D5, turns the live adapter on, and
 * without one the fake answers and callers say so. A configured model that
 * isn't in the price table fails closed instead of falling back to the fake.
 */
export function aiSetup(
  purpose: AiPurpose,
  env: NodeJS.ProcessEnv = process.env
): AiSetup {
  const s = settings.parse({
    AI_DEFAULT_PROVIDER: env.AI_DEFAULT_PROVIDER,
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    GEMINI_LABEL_MODEL: env.GEMINI_LABEL_MODEL,
    GEMINI_COPY_MODEL: env.GEMINI_COPY_MODEL,
    GEMINI_PLAN_MODEL: env.GEMINI_PLAN_MODEL,
    GEMINI_REVIEW_MODEL: env.GEMINI_REVIEW_MODEL,
    GEMINI_TIMEOUT_MS: env.GEMINI_TIMEOUT_MS,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_LABEL_MODEL: env.OPENAI_LABEL_MODEL,
    OPENAI_COPY_MODEL: env.OPENAI_COPY_MODEL,
    OPENAI_PLAN_MODEL: env.OPENAI_PLAN_MODEL,
    OPENAI_REVIEW_MODEL: env.OPENAI_REVIEW_MODEL,
    OPENAI_TIMEOUT_MS: env.OPENAI_TIMEOUT_MS
  })
  if (s.AI_DEFAULT_PROVIDER?.toLowerCase() === 'fake')
    return {
      ready: true,
      provider: 'fake',
      model: 'fake',
      reason: 'fake_selected',
      timeoutMs: s.GEMINI_TIMEOUT_MS
    }
  // REL-PRV: the second provider only when chosen by name (an OpenAI key
  // alone, which the older email rewriting uses, never turns it on).
  if (s.AI_DEFAULT_PROVIDER?.toLowerCase() === 'openai') {
    if (!s.OPENAI_API_KEY)
      return {
        ready: true,
        provider: 'fake',
        model: 'fake',
        reason: 'missing_key',
        timeoutMs: s.OPENAI_TIMEOUT_MS
      }
    const model =
      {
        label: s.OPENAI_LABEL_MODEL,
        copy: s.OPENAI_COPY_MODEL,
        plan: s.OPENAI_PLAN_MODEL,
        review: s.OPENAI_REVIEW_MODEL
      }[purpose] || defaultOpenAiModels[purpose]
    if (!isRewriteModel(model))
      return { ready: false, provider: 'openai', reason: 'unsupported_model' }
    return {
      ready: true,
      provider: 'openai',
      model,
      apiKey: s.OPENAI_API_KEY,
      baseUrl: openAiBaseUrl,
      timeoutMs: s.OPENAI_TIMEOUT_MS
    }
  }
  // Only the dedicated key turns Gemini on (the older GOOGLE_GENERATIVE_AI_KEY
  // may be left over from earlier work and must not start spending).
  const apiKey = s.GEMINI_API_KEY
  if (!apiKey)
    return {
      ready: true,
      provider: 'fake',
      model: 'fake',
      reason: 'missing_key',
      timeoutMs: s.GEMINI_TIMEOUT_MS
    }
  const configured = {
    label: s.GEMINI_LABEL_MODEL,
    copy: s.GEMINI_COPY_MODEL,
    plan: s.GEMINI_PLAN_MODEL,
    review: s.GEMINI_REVIEW_MODEL
  }[purpose]
  const model = configured || defaultGeminiModels[purpose]
  if (!isGeminiModel(model))
    return { ready: false, provider: 'gemini', reason: 'unsupported_model' }
  return {
    ready: true,
    provider: 'gemini',
    model,
    apiKey,
    timeoutMs: s.GEMINI_TIMEOUT_MS
  }
}

/** Safe to render: no key material. `live` false means the fake answers. */
export function aiAvailability(
  purpose: AiPurpose,
  env: NodeJS.ProcessEnv = process.env
) {
  const setup = aiSetup(purpose, env)
  if (!setup.ready)
    return {
      live: false as const,
      provider: setup.provider,
      model: null,
      reason: setup.reason
    }
  return setup.provider !== 'fake'
    ? {
        live: true as const,
        provider: setup.provider,
        model: setup.model,
        reason: null
      }
    : {
        live: false as const,
        provider: 'fake' as const,
        model: null,
        reason: setup.reason
      }
}
