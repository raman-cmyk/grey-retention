import {
  defaultGeminiModels,
  type AiPurpose
} from '@/lib/providers/gemini-pricing'
import {
  defaultRewriteModel,
  isRewriteModel
} from '@/lib/providers/openai-pricing'
import {
  enabledWorkspaces,
  rewriteSetup
} from '@/features/email-generation/config'
import { aiSetup } from './setup'
import {
  deprecationPages,
  modelRetirements,
  pricedModels,
  type Retirement
} from '@/lib/providers/model-retirements'

/**
 * Owner pick #83 (D27): the model retirement watch. For every model the
 * app would call now, it says in plain words when its provider shuts it
 * down, warning `warnDays` before, from the dates in `modelRetirements`:
 * GROS's agents (`aiSetup` for each purpose; the fake calls none) and the
 * older email rewriting (`rewriteSetup`, OpenAI, for the workspaces it is
 * on for). A model whose date no one has checked lately, or whose date is
 * not a real day, is said to be unknown, never safe. A purpose set to a
 * model off the price table is said too: its calls fail. Dates are whole
 * UTC days. Read on the admin Operations page.
 */

/** Warn this many days before a shutdown (six weeks: time to test a move). */
export const warnDays = 42
/** "No shutdown announced" is trusted this long after it was checked. */
export const recheckDays = 90

/** What a model is used for: GROS's four purposes, and the old rewriting. */
export type WatchPurpose = AiPurpose | 'rewrite'

export type ModelInUse = {
  provider: 'gemini' | 'openai'
  model: string
  purposes: WatchPurpose[]
}

/** A purpose whose setting names a model off the price table. */
export type Unpriced = { provider: 'gemini' | 'openai'; purpose: WatchPurpose }

export type WatchInput = { inUse: ModelInUse[]; unpriced: Unpriced[] }

export type RetirementLine = {
  /** The model, or the setting for a model off the price table. */
  name: string
  state: 'retired' | 'soon' | 'ok' | 'unknown' | 'unpriced'
  detail: string
}

const purposeWords: Record<WatchPurpose, string> = {
  label: 'labelling',
  copy: 'writing',
  review: 'checking',
  plan: 'planning',
  rewrite: 'the older email rewriting'
}

/** The setting that picks a purpose's model, for the admin's next step. */
const settingFor = (provider: 'gemini' | 'openai', purpose: WatchPurpose) =>
  `${provider.toUpperCase()}_${purpose.toUpperCase()}_MODEL`

const day = 24 * 60 * 60 * 1000
/** A real day as YYYY-MM-DD (never 2027-13-01 or 2027-02-30), else null. */
function dayOf(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d\d-\d\d$/.test(value)) return null
  const t = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value
    ? t
    : null
}
export const isRealDay = (value: string) => dayOf(value) !== null

/** Setups as `aiSetup` and `rewriteSetup` give them. */
type Setup = {
  ready: boolean
  provider: string
  model?: string
  reason?: string
}

/**
 * The models in use, one line each with the purposes it serves, and the
 * purposes set to a model off the price table.
 */
export function modelsInUse(
  setups: Partial<Record<WatchPurpose, Setup>>
): WatchInput {
  const inUse: ModelInUse[] = []
  const unpriced: Unpriced[] = []
  for (const purpose of Object.keys(setups) as WatchPurpose[]) {
    const s = setups[purpose]!
    if (s.provider !== 'gemini' && s.provider !== 'openai') continue
    if (!s.ready) {
      if (s.reason === 'unsupported_model')
        unpriced.push({ provider: s.provider, purpose })
      continue
    }
    if (!s.model) continue
    const line = inUse.find(
      (m) => m.provider === s.provider && m.model === s.model
    )
    if (line) line.purposes.push(purpose)
    else
      inUse.push({ provider: s.provider, model: s.model, purposes: [purpose] })
  }
  return { inUse, unpriced }
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** What the watch says of each model in use, on `today` (YYYY-MM-DD, UTC). */
export function retirementWatch(
  input: WatchInput,
  today: string,
  table: Record<string, Retirement> = modelRetirements
): RetirementLine[] {
  const now = dayOf(today)
  const priced = new Set<string>([
    ...pricedModels.gemini,
    ...pricedModels.openai
  ])
  const lines: RetirementLine[] = input.unpriced.map((u) => ({
    name: settingFor(u.provider, u.purpose),
    state: 'unpriced',
    detail: `Set to a model that is not in the price table, so every call for ${purposeWords[u.purpose]} fails. Set it to a model the table lists.`
  }))
  for (const m of input.inUse) {
    const r = table[m.model]
    const uses = m.purposes.map((p) => purposeWords[p]).join(', ')
    const settings = m.purposes.map((p) => settingFor(m.provider, p)).join(', ')
    const to =
      r?.replacement && priced.has(r.replacement)
        ? r.replacement
        : r?.replacement
          ? `${r.replacement} (add it to the price table first)`
          : 'another model in its price table'
    const move = `move ${settings} (or the default the code uses for ${m.purposes.length === 1 ? 'it' : 'them'}) to ${to}`
    const page = deprecationPages[m.provider]
    const unknown = (why: string): RetirementLine => ({
      name: m.model,
      state: 'unknown',
      detail: `${why} (used for ${uses}): read ${page} and update lib/providers/model-retirements.ts.`
    })
    const shutdown = dayOf(r?.shutdownOn)
    if (r?.shutdownOn && (shutdown === null || now === null)) {
      lines.push(unknown('Its shutdown date in the table is not a real day'))
      continue
    }
    if (shutdown !== null && now !== null) {
      const left = Math.round((shutdown - now) / day)
      const on = r!.shutdownOn
      lines.push(
        left <= 0
          ? {
              name: m.model,
              state: 'retired',
              detail: `Shut down on ${on}: its calls for ${uses} fail and fall back. ${capital(move)}.`
            }
          : left <= warnDays
            ? {
                name: m.model,
                state: 'soon',
                detail: `Shuts down on ${on}, in ${left} day${left === 1 ? '' : 's'} (used for ${uses}): ${move} before then.`
              }
            : {
                name: m.model,
                state: 'ok',
                detail: `Shuts down on ${on}, in ${left} days (used for ${uses}).`
              }
      )
      continue
    }
    const checked = dayOf(r?.checkedOn)
    const since =
      checked !== null && now !== null
        ? Math.round((now - checked) / day)
        : null
    if (since !== null && since >= 0 && since <= recheckDays)
      lines.push({
        name: m.model,
        state: 'ok',
        detail: `No shutdown announced when checked on ${r!.checkedOn} (used for ${uses}).`
      })
    else
      lines.push(
        unknown(
          r?.checkedOn
            ? `Its shutdown date was last checked on ${r.checkedOn}`
            : 'Its shutdown date has never been checked'
        )
      )
  }
  return lines
}

/**
 * The models the app would call now, from this server's settings: each
 * GROS purpose's setup, and the older rewriting's model when its key is
 * set and some workspace has it on (`EMAIL_REWRITE_TENANT_IDS`).
 */
export function modelsInUseNow(
  env: NodeJS.ProcessEnv = process.env
): WatchInput {
  const purposes = Object.keys(defaultGeminiModels) as AiPurpose[]
  const setups: Partial<Record<WatchPurpose, Setup>> = {}
  for (const p of purposes) {
    const s = aiSetup(p, env)
    setups[p] = s.ready
      ? { ready: true, provider: s.provider, model: s.model }
      : { ready: false, provider: s.provider, reason: s.reason }
  }
  const rewrite = rewriteSetup(env)
  const model = env.OPENAI_REWRITE_MODEL?.trim() || defaultRewriteModel
  if (rewrite.provider === 'openai') {
    const someWorkspace =
      enabledWorkspaces(env.EMAIL_REWRITE_TENANT_IDS).size > 0
    if (
      rewrite.ready ||
      (rewrite.reason === 'workspace_not_enabled' && someWorkspace)
    )
      setups.rewrite = { ready: true, provider: 'openai', model }
    else if (rewrite.reason === 'unsupported_model' && !isRewriteModel(model))
      setups.rewrite = {
        ready: false,
        provider: 'openai',
        reason: 'unsupported_model'
      }
  }
  return modelsInUse(setups)
}
