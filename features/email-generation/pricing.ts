// Standard short-context prices (≤272K input tokens) in micro-USD per million
// tokens, from https://developers.openai.com/api/docs/pricing (read
// 2026-10-29). Only models listed here may be configured, so every request
// has a known cost ceiling before dispatch.
export const rewriteModels = {
  'gpt-6.1-terra': { input: 1_000_000, cachedInput: 50_000, output: 5_000_000 },
  'gpt-6-luna': { input: 100_000, cachedInput: 10_000, output: 500_000 }
} as const

export type RewriteModel = keyof typeof rewriteModels
export const defaultRewriteModel: RewriteModel = 'gpt-6.1-terra'

/** Allowance for message framing and special tokens around the request. */
export const protocolOverheadTokens = 2_000
/** Requests above this are refused before dispatch (short-context pricing). */
export const maxRequestBytes = 250_000

export function isRewriteModel(value: string): value is RewriteModel {
  return Object.hasOwn(rewriteModels, value)
}

export function costMicro(
  model: RewriteModel,
  usage: {
    inputTokens: number
    outputTokens: number
    cachedInputTokens?: number
  }
) {
  const price = rewriteModels[model]
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens)
  return Math.ceil(
    ((usage.inputTokens - cached) * price.input +
      cached * price.cachedInput +
      usage.outputTokens * price.output) /
      1_000_000
  )
}

/**
 * Upper bound for one request. Byte-level BPE tokenizers emit at most one
 * token per UTF-8 byte, so the byte length of the complete serialized request
 * (instructions, input, schema and options) plus a fixed framing allowance
 * bounds input tokens for any script, emoji or escaping. Output is charged at
 * the full `max_output_tokens`, which already includes reasoning tokens.
 */
export function estimateMicro(
  model: RewriteModel,
  serializedRequest: string,
  maxOutputTokens: number
) {
  return costMicro(model, {
    inputTokens:
      Buffer.byteLength(serializedRequest, 'utf8') + protocolOverheadTokens,
    outputTokens: maxOutputTokens
  })
}
