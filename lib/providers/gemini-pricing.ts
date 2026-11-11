// Standard paid-tier text prices in micro-USD per million tokens, from
// https://ai.google.dev/gemini-api/docs/pricing (read 2026-11-07). The free
// tier costs nothing, but usage is always metered at paid prices so the
// per-client cap holds if the key moves to a paid project. Only models listed
// here may be configured, so every request has a known cost ceiling.
export const geminiModels = {
  'gemini-2.5-flash-lite': {
    input: 100_000,
    cachedInput: 10_000,
    output: 400_000
  },
  // Up to 200k input tokens; longer prompts are refused before dispatch.
  'gemini-2.5-pro': {
    input: 1_250_000,
    cachedInput: 125_000,
    output: 10_000_000
  },
  'gemini-2.5-flash': {
    input: 300_000,
    cachedInput: 30_000,
    output: 2_500_000
  },
  'gemini-3.1-flash-lite': {
    input: 250_000,
    cachedInput: 25_000,
    output: 1_500_000
  },
  'gemini-3-flash-preview': {
    input: 500_000,
    cachedInput: 50_000,
    output: 3_000_000
  }
} as const

export type GeminiModel = keyof typeof geminiModels

/**
 * Decision D5: Flash-Lite labels and classifies, Flash writes copy. The agent
 * plan (AGENT_MAP.md) adds `plan` for rare, hard reasoning (Brand strategist,
 * Brief writer, Calendar planner) on 2.5 Pro.
 */
export const defaultGeminiModels = {
  label: 'gemini-2.5-flash-lite',
  copy: 'gemini-2.5-flash',
  /** Judging and second tries: inspectors, low-confidence re-tags. */
  review: 'gemini-2.5-flash',
  plan: 'gemini-2.5-pro'
} as const satisfies Record<string, GeminiModel>

export type AiPurpose = keyof typeof defaultGeminiModels

/**
 * Upper bound of input tokens per picture. Gemini counts a picture as 258
 * tokens per 768px tile; 8,000 covers a full-length email screenshot (about
 * 30 tiles). Pictures are left out of the byte count, so a large base64
 * string doesn't inflate the reservation.
 */
export const imageTokenAllowance = 8_000

/** Allowance for framing tokens around the request. */
export const protocolOverheadTokens = 2_000

export function isGeminiModel(value: string): value is GeminiModel {
  return Object.hasOwn(geminiModels, value)
}

export function geminiCostMicro(
  model: GeminiModel,
  usage: {
    inputTokens: number
    outputTokens: number
    cachedInputTokens?: number
  }
) {
  const price = geminiModels[model]
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens)
  return Math.ceil(
    ((usage.inputTokens - cached) * price.input +
      cached * price.cachedInput +
      usage.outputTokens * price.output) /
      1_000_000
  )
}

/**
 * Upper bound for one request: a tokenizer emits at most one token per UTF-8
 * byte, so the serialized request's byte length plus framing bounds input
 * tokens. Output (which includes thinking tokens) is charged at the full
 * `maxOutputTokens`.
 */
export function geminiEstimateMicro(
  model: GeminiModel,
  serializedRequest: string,
  maxOutputTokens: number,
  imageCount = 0
) {
  return Math.max(
    1,
    geminiCostMicro(model, {
      inputTokens:
        Buffer.byteLength(serializedRequest, 'utf8') +
        protocolOverheadTokens +
        imageCount * imageTokenAllowance,
      outputTokens: maxOutputTokens
    })
  )
}
