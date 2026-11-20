import {
  defaultGeminiModels,
  type AiPurpose
} from '@/lib/providers/gemini-pricing'
import { aiSetup } from './setup'
import {
  deprecationPages,
  modelRetirements,
  type Retirement
} from '@/lib/providers/model-retirements'

/**
 * Owner pick #83 (D27): the model retirement watch. For every model the
 * app would call now (`aiSetup` for each purpose: the fake calls none), it
 * says in plain words when its provider shuts it down, warning
 * `warnDays` before, from the dates in `modelRetirements`. A model whose
 * date no one has checked lately is said to be unknown, never safe. Pure
 * apart from the setup it is given; read on the admin Operations page.
 */

/** Warn this many days before a shutdown (six weeks: time to test a move). */
export const warnDays = 42
/** A date "none announced" is trusted this long after it was checked. */
export const recheckDays = 90

export type ModelInUse = {
  provider: 'gemini' | 'openai'
  model: string
  purposes: AiPurpose[]
}

export type RetirementLine = ModelInUse & {
  state: 'retired' | 'soon' | 'ok' | 'unknown'
  detail: string
}

const purposeWords: Record<AiPurpose, string> = {
  label: 'labelling',
  copy: 'writing',
  review: 'checking',
  plan: 'planning'
}

/** The setting that picks a purpose's model, for the admin's next step. */
const settingFor = (provider: 'gemini' | 'openai', purpose: AiPurpose) =>
  `${provider.toUpperCase()}_${purpose.toUpperCase()}_MODEL`

const day = 24 * 60 * 60 * 1000
const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / day
  )

/**
 * The models in use, one line each with the purposes it serves, from each
 * purpose's setup (as `aiSetup` gives it).
 */
export function modelsInUse(
  setups: Record<
    AiPurpose,
    { ready: boolean; provider: string; model?: string }
  >
): ModelInUse[] {
  const out: ModelInUse[] = []
  for (const purpose of Object.keys(setups) as AiPurpose[]) {
    const s = setups[purpose]
    if (!s.ready || !s.model) continue
    if (s.provider !== 'gemini' && s.provider !== 'openai') continue
    const line = out.find(
      (m) => m.provider === s.provider && m.model === s.model
    )
    if (line) line.purposes.push(purpose)
    else out.push({ provider: s.provider, model: s.model, purposes: [purpose] })
  }
  return out
}

/** What the watch says of each model in use, on `today` (YYYY-MM-DD). */
export function retirementWatch(
  inUse: readonly ModelInUse[],
  today: string,
  table: Record<string, Retirement> = modelRetirements
): RetirementLine[] {
  return inUse.map((m) => {
    const r = table[m.model]
    const uses = m.purposes.map((p) => purposeWords[p]).join(', ')
    const settings = m.purposes.map((p) => settingFor(m.provider, p)).join(', ')
    const move = r?.replacement
      ? `move ${settings} to ${r.replacement}`
      : `move ${settings} to another model in its price table`
    const page = deprecationPages[m.provider]
    if (r?.shutdownOn) {
      const left = daysBetween(today, r.shutdownOn)
      if (left <= 0)
        return {
          ...m,
          state: 'retired',
          detail: `Shut down on ${r.shutdownOn}: its calls for ${uses} fail and fall back. ${capital(move)}.`
        }
      if (left <= warnDays)
        return {
          ...m,
          state: 'soon',
          detail: `Shuts down on ${r.shutdownOn}, in ${left} day${left === 1 ? '' : 's'} (used for ${uses}): ${move} before then.`
        }
      return {
        ...m,
        state: 'ok',
        detail: `Shuts down on ${r.shutdownOn}, in ${left} days (used for ${uses}).`
      }
    }
    if (r?.checkedOn && daysBetween(r.checkedOn, today) <= recheckDays)
      return {
        ...m,
        state: 'ok',
        detail: `No shutdown announced when checked on ${r.checkedOn} (used for ${uses}).`
      }
    return {
      ...m,
      state: 'unknown',
      detail: `${r?.checkedOn ? `Its shutdown date was last checked on ${r.checkedOn}` : 'Its shutdown date has never been checked'} (used for ${uses}): read ${page} and update lib/providers/model-retirements.ts.`
    }
  })
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The models the app would call now, from this server's settings. */
export function modelsInUseNow(env: NodeJS.ProcessEnv = process.env) {
  const purposes = Object.keys(defaultGeminiModels) as AiPurpose[]
  return modelsInUse(
    Object.fromEntries(
      purposes.map((p) => {
        const s = aiSetup(p, env)
        return [
          p,
          {
            ready: s.ready,
            provider: s.provider,
            model: s.ready ? s.model : undefined
          }
        ]
      })
    ) as Parameters<typeof modelsInUse>[0]
  )
}
