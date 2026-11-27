import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database } from '@/lib/supabase/database.types'

/**
 * PLN-040b (owner pick #40): what GROS itself knows about the offer emails
 * already in Klaviyo, so a new 15-day plan picks a sale up where it was
 * (`PlanInput.existing[].percent`, `ladderStart`) instead of starting back
 * at 10% right after a 25% email.
 *
 * Klaviyo's campaigns carry no percent, and their words are never read for
 * one. Only an email GROS drafted counts: the newest drafted build of that
 * Klaviyo campaign (`email_builds.klaviyo_campaign_id`, the draft the owner
 * then scheduled or sent), its code and the percent the email shows
 * (`email.code`, `email.offer.percent`); for a build made before the email
 * kept its percent, the planned email's offer (`strategy_runs.plan`, its
 * slot), when it names the same code. A draft without a code gives nothing.
 * Both reads are this workspace's only, with the worker's client.
 */

type Db = SupabaseClient<Database>

/** At most this many campaigns are looked up (the plan takes 200 sends). */
export const maxLookups = 200

const percent = z.coerce.number().int().min(1).max(100)
const buildRow = z.object({
  run_id: z.string(),
  slot: z.number().int().min(0),
  klaviyo_campaign_id: z.string().min(1),
  code: z.string().min(1).nullable(),
  offer: z.object({ percent: percent }).nullable().optional().catch(null)
})
const plannedOffer = z.object({
  offer: z.object({ code: z.string(), percent: percent }).nullable()
})

/**
 * The percent of the code GROS drafted for each of these Klaviyo
 * campaigns, by campaign id. `live` says which Klaviyo the history was
 * read from: a fake draft never answers for a live campaign (or the other
 * way round). A failed read throws; the caller plans without it.
 */
export async function readOfferPercents(
  db: Db,
  tenantId: string,
  { campaignIds, live }: { campaignIds: readonly string[]; live: boolean }
): Promise<Map<string, number>> {
  const ids = [...new Set(campaignIds.filter((id) => id.length > 0))].slice(
    0,
    maxLookups
  )
  const found = new Map<string, number>()
  if (!ids.length) return found
  const builds = await db
    .from('email_builds')
    .select(
      'run_id,slot,klaviyo_campaign_id,code:email->>code,offer:email->offer'
    )
    .eq('tenant_id', tenantId)
    .eq('state', 'drafted')
    .eq('sample_draft', !live)
    .in('klaviyo_campaign_id', ids)
    .order('created_at', { ascending: false })
  if (builds.error) throw builds.error
  // The newest drafted build of each campaign: what Klaviyo was given.
  const newest = new Map<string, z.infer<typeof buildRow>>()
  for (const raw of builds.data ?? []) {
    const row = buildRow.safeParse(raw)
    if (!row.success || newest.has(row.data.klaviyo_campaign_id)) continue
    newest.set(row.data.klaviyo_campaign_id, row.data)
  }
  const older: z.infer<typeof buildRow>[] = []
  for (const [campaign, row] of newest) {
    if (row.code === null) continue
    if (row.offer) found.set(campaign, row.offer.percent)
    else older.push(row)
  }
  if (!older.length) return found
  const runs = await db
    .from('strategy_runs')
    .select('id,slots:plan->slots')
    .eq('tenant_id', tenantId)
    .in('id', [...new Set(older.map((r) => r.run_id))])
  if (runs.error) throw runs.error
  const slotsOf = new Map(
    (runs.data ?? []).map((r) => [
      (r as { id: string }).id,
      (r as { slots?: unknown }).slots
    ])
  )
  for (const row of older) {
    const slots = slotsOf.get(row.run_id)
    const planned = plannedOffer.safeParse(
      Array.isArray(slots) ? slots[row.slot] : null
    )
    const offer = planned.success ? planned.data.offer : null
    if (offer && offer.code === row.code)
      found.set(row.klaviyo_campaign_id, offer.percent)
  }
  return found
}
