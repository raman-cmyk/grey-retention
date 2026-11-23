import { geminiModels, type GeminiModel } from './gemini-pricing'
import { rewriteModels, type RewriteModel } from './openai-pricing'

/**
 * Owner pick #83 (D27): when each model we may call is shut down, as its
 * provider announced it, for the model retirement watch
 * (`features/ai/retirement-watch.ts`). Every model in the price tables
 * has a line (a test keeps them in step), so a model added there must be
 * looked up here too.
 *
 * `shutdownOn` is the provider's announced date (YYYY-MM-DD), null when
 * none is announced. `checkedOn` is when someone last read the provider's
 * deprecation page for it, null when no one has yet: the watch then says
 * the date is unknown instead of guessing. Read these pages to update:
 * https://ai.google.dev/gemini-api/docs/deprecations and
 * https://platform.openai.com/docs/deprecations.
 */
export type Retirement = {
  provider: 'gemini' | 'openai'
  shutdownOn: string | null
  /** The model the provider names to move to, when it names one. */
  replacement?: string
  checkedOn: string | null
}

/** The deprecation pages, by provider (for the admin's next step). */
export const deprecationPages = {
  gemini: 'https://ai.google.dev/gemini-api/docs/deprecations',
  openai: 'https://platform.openai.com/docs/deprecations'
} as const

// Not read yet: the build sessions that wrote this could not reach either
// page (their network allows neither host). Fill each line from the pages.
export const modelRetirements: Record<GeminiModel | RewriteModel, Retirement> =
  {
    'gemini-2.5-flash-lite': {
      provider: 'gemini',
      shutdownOn: null,
      checkedOn: null
    },
    'gemini-2.5-flash': {
      provider: 'gemini',
      shutdownOn: null,
      checkedOn: null
    },
    'gemini-2.5-pro': { provider: 'gemini', shutdownOn: null, checkedOn: null },
    'gemini-3.1-flash-lite': {
      provider: 'gemini',
      shutdownOn: null,
      checkedOn: null
    },
    'gemini-3-flash-preview': {
      provider: 'gemini',
      shutdownOn: null,
      checkedOn: null
    },
    'gpt-6.1-terra': { provider: 'openai', shutdownOn: null, checkedOn: null },
    'gpt-6-luna': { provider: 'openai', shutdownOn: null, checkedOn: null }
  }

/** Every model the price tables allow, by provider. */
export const pricedModels = {
  gemini: Object.keys(geminiModels) as GeminiModel[],
  openai: Object.keys(rewriteModels) as RewriteModel[]
}
