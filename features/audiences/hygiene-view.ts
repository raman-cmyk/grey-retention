import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { klaviyoData, type KlaviyoData } from '@/features/klaviyo-data/reader'
import { validTimezone } from '@/lib/brand-time'
import { getServerEnvironment } from '@/lib/env/server'
import type { Database } from '@/lib/supabase/database.types'
import { createClient } from '@/lib/supabase/server'
import {
  countHygiene,
  engagedWords,
  hygieneCountWords,
  hygieneDefaults,
  hygieneRule,
  hygieneRuleKey,
  hygieneRuleLines,
  type HygieneSettings
} from './hygiene'

/**
 * PICK-101: the "Left out" card on Audiences. How many people the store's
 * emails leave out and why, in plain words, and the owner's setting. The
 * numbers say where they come from: the sample store's people (sample
 * data, as the rest of Audiences today), or the size Klaviyo gives GROS's
 * own segment once a draft has gone in (bounced and suppressed people are
 * then said, not counted: Klaviyo skips them by itself). Nothing is made
 * up when there is nothing to count.
 */
export type HygieneView =
  | {
      state: 'ready'
      enabled: boolean
      days: number
      /** The setting's revision the page read (0: never saved). */
      revision: number
      /** The big number ("1,240"), or null when not counted. */
      number: string | null
      /** What the number means, or why there is none. */
      words: string
      /** Where the number comes from. */
      source: string | null
      /** The rule in plain words. */
      lines: string[]
    }
  | { state: 'unavailable' }

/** GROS's segment as stored (`klaviyo_hygiene_segments`). */
export type StoredSegment = {
  state: string
  profileCount: number | null
  reason: string | null
}

const format = (n: number) => new Intl.NumberFormat('en-US').format(n)

const reasonWords: Record<string, string> = {
  missing_scope:
    'Not applied in Klaviyo yet: your Klaviyo key cannot make segments. Reconnect Klaviyo with a key that can.',
  refused:
    'Not applied in Klaviyo yet: Klaviyo did not take the segment. GROS tries again tomorrow.',
  no_email_metrics:
    'Not applied yet: Klaviyo has no email history to judge from. Nobody is left out for being quiet.',
  metrics_unread:
    'Not applied yet: GROS could not read your Klaviyo history. It tries again tomorrow.',
  segment_gone:
    'Not applied in Klaviyo: its segment was deleted there. GROS makes it again tomorrow.'
}

/** The card from what was read. Pure, for tests. */
export function hygieneView(input: {
  settings: HygieneSettings
  revision: number
  data: KlaviyoData | null
  stored: StoredSegment | null
  now: Date
}): HygieneView {
  const rule = hygieneRule(input.settings)
  const base = {
    state: 'ready' as const,
    enabled: rule.enabled,
    days: rule.days,
    revision: input.revision,
    lines: hygieneRuleLines(rule)
  }
  const groups =
    input.data?.state === 'sample'
      ? input.data.snapshot.profileGroups
      : undefined
  if (groups) {
    const counts = countHygiene(groups, rule, input.now)
    return {
      ...base,
      number: format(counts.leftOut),
      words: hygieneCountWords(counts, rule),
      source: `Sample data: ${format(counts.reachable)} of ${format(counts.total)} people can get an email.`
    }
  }
  if (!rule.enabled)
    return {
      ...base,
      number: null,
      words: 'Klaviyo skips people who bounced or are suppressed.',
      source: null
    }
  const s = input.stored
  if (s?.state === 'ready' && s.profileCount !== null)
    return {
      ...base,
      number: format(s.profileCount),
      words: `${s.profileCount === 1 ? '1 person' : `${format(s.profileCount)} people`} with no ${engagedWords} in ${rule.days} days. Klaviyo also skips everyone who bounced or is suppressed.`,
      source: 'From Klaviyo, for every email GROS puts there.'
    }
  if (s && (s.state === 'no_data' || s.state === 'failed') && s.reason)
    return {
      ...base,
      number: null,
      words:
        reasonWords[s.reason] ??
        'Not applied in Klaviyo yet. GROS tries again tomorrow.',
      source: null
    }
  return {
    ...base,
    number: null,
    words: 'Counted when GROS puts its next email in Klaviyo.',
    source: null
  }
}

type Db = SupabaseClient<Database>

async function readStored(db: Db, tenantId: string) {
  const settings = await db
    .from('list_hygiene_settings')
    .select('enabled,days,revision')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (settings.error) throw settings.error
  const own: HygieneSettings = settings.data
    ? { enabled: settings.data.enabled, days: settings.data.days }
    : hygieneDefaults
  const segment = await db
    .from('klaviyo_hygiene_segments')
    .select('state,profile_count,reason')
    .eq('tenant_id', tenantId)
    .eq('rule_key', hygieneRuleKey(hygieneRule(own)))
    .maybeSingle()
  if (segment.error) throw segment.error
  return {
    settings: own,
    revision: settings.data?.revision ?? 0,
    stored: segment.data
      ? {
          state: segment.data.state,
          profileCount: segment.data.profile_count,
          reason: segment.data.reason
        }
      : null
  }
}

/** The card for the signed-in member's workspace. */
export async function hygieneReadModel(
  context: ClientRequestContext,
  now = new Date()
): Promise<HygieneView> {
  try {
    const db = await createClient()
    const demo = !db || getServerEnvironment().AUTH_MODE === 'demo'
    const [stored, data] = await Promise.all([
      demo
        ? { settings: hygieneDefaults, revision: 0, stored: null }
        : readStored(db, context.tenantId),
      klaviyoData(
        context.tenantId,
        validTimezone(context.timezone),
        now.getTime()
      ).catch(() => null)
    ])
    return hygieneView({ ...stored, data, now })
  } catch {
    return { state: 'unavailable' }
  }
}
