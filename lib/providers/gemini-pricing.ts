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

/** Decision D5: Flash-Lite labels and classifies, Flash writes copy. */
export const defaultGeminiModels = {
  label: 'gemini-2.5-flash-lite',
  copy: 'gemini-2.5-flash'
} as const satisfies Record<string, GeminiModel>

export type AiPurpose = keyof typeof defaultGeminiModels

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
  maxOutputTokens: number
) {
  return Math.max(
    1,
    geminiCostMicro(model, {
      inputTokens:
        Buffer.byteLength(serializedRequest, 'utf8') + protocolOverheadTokens,
      outputTokens: maxOutputTokens
    })
  )
}
