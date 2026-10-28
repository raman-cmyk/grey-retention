import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { generateRollingFixture } from './fixture-planner'
export const planningJobKinds = ['calendar.plan', 'reviews.remind']
export async function runPlanningJob(
  db: SupabaseClient<Database>,
  job: Database['public']['Tables']['job_runs']['Row']
) {
  if (job.kind === 'reviews.remind') {
    const r = await db.rpc('finish_reminder_job', {
      job: job.id,
      lease: job.lease_token!
    })
    if (r.error) throw r.error
    return
  }
  const input = z
    .object({
      startsAt: z.iso.datetime({ offset: true }),
      audienceId: z.uuid(),
      holidays: z
        .array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            date: z.iso.date(),
            notes: z.string()
          })
        )
        .default([])
    })
    .parse(job.input)
  const [brand, tenant, preferences, campaigns, offers] = await Promise.all([
    db
      .from('brand_profiles')
      .select('*')
      .eq('tenant_id', job.tenant_id)
      .single(),
    db.from('tenants').select('timezone').eq('id', job.tenant_id).single(),
    db
      .from('planning_preferences')
      .select('*')
      .eq('tenant_id', job.tenant_id)
      .single(),
    db
      .from('campaigns')
      .select('*')
      .eq('tenant_id', job.tenant_id)
      .is('superseded_by_plan', null),
    db.from('offers').select('*').eq('tenant_id', job.tenant_id)
  ])
  if (
    [brand, tenant, preferences, campaigns, offers].some((r) => r.error) ||
    !brand.data ||
    !tenant.data ||
    !preferences.data
  )
    throw new Error('Planning context unavailable')
  const offer = offers.data?.find(
    (o) => o.kind === 'evergreen' && o.depth_percent === 0
  )
  const output = generateRollingFixture({
    start: input.startsAt,
    timezone: tenant.data.timezone,
    audienceId: input.audienceId,
    brandName: brand.data.brand_name,
    holidays: input.holidays,
    existing: (campaigns.data ?? [])
      .filter(
        (c) =>
          c.calendar_state === 'approved' ||
          ['queued', 'scheduled', 'sent', 'reconciling'].includes(
            c.delivery_state
          )
      )
      .map((c) => {
        const o = offers.data?.find((o) => o.id === c.offer_id)
        return {
          id: c.id,
          audienceId: c.audience_id!,
          plannedAt: c.planned_at,
          discounted: (o?.depth_percent ?? 0) > 0,
          sitewide: o?.kind === 'sitewide',
          offerId: c.offer_id
        }
      }),
    evergreenOffer: offer
      ? { id: offer.id, startsAt: offer.starts_at, endsAt: offer.ends_at }
      : null,
    policy: {
      weeklyCap: preferences.data.weekly_cap,
      discountCap: preferences.data.discount_cap,
      sitewideGap: preferences.data.sitewide_gap
    }
  })
  const r = await db.rpc('finish_plan_job', {
    job: job.id,
    lease: job.lease_token!,
    output
  })
  if (r.error) throw r.error
}
