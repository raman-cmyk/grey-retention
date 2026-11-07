import 'server-only'
import { z } from 'zod'
import {
  defaultGeminiModels,
  isGeminiModel,
  type AiPurpose,
  type GeminiModel
} from '@/lib/providers/gemini-pricing'

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
  | { ready: false; provider: 'gemini'; reason: 'unsupported_model' }

const settings = z.object({
  AI_DEFAULT_PROVIDER: z.string().trim().optional(),
  GEMINI_API_KEY: z.string().trim().optional(),
  GOOGLE_GENERATIVE_AI_KEY: z.string().trim().optional(),
  GEMINI_LABEL_MODEL: z.string().trim().optional(),
  GEMINI_COPY_MODEL: z.string().trim().optional(),
  GEMINI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(120_000)
    .catch(60_000)
})

/**
 * Decision D5. Reads server-only settings on every call and never exposes the
 * key. An explicit AI_DEFAULT_PROVIDER=fake always wins (tests and Claude
 * sessions force it). Otherwise a Gemini key turns the live adapter on, and
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
    GOOGLE_GENERATIVE_AI_KEY: env.GOOGLE_GENERATIVE_AI_KEY,
    GEMINI_LABEL_MODEL: env.GEMINI_LABEL_MODEL,
    GEMINI_COPY_MODEL: env.GEMINI_COPY_MODEL,
    GEMINI_TIMEOUT_MS: env.GEMINI_TIMEOUT_MS
  })
  if (s.AI_DEFAULT_PROVIDER === 'fake')
    return {
      ready: true,
      provider: 'fake',
      model: 'fake',
      reason: 'fake_selected',
      timeoutMs: s.GEMINI_TIMEOUT_MS
    }
  const apiKey = s.GEMINI_API_KEY || s.GOOGLE_GENERATIVE_AI_KEY
  if (!apiKey)
    return {
      ready: true,
      provider: 'fake',
      model: 'fake',
      reason: 'missing_key',
      timeoutMs: s.GEMINI_TIMEOUT_MS
    }
  const configured =
    purpose === 'label' ? s.GEMINI_LABEL_MODEL : s.GEMINI_COPY_MODEL
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
  return setup.provider === 'gemini'
    ? {
        live: true as const,
        provider: 'gemini' as const,
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
