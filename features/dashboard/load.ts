import 'server-only'
import { campaignWorkspace } from '@/features/campaigns/data'
import {
  campaignNextStep,
  campaignReview,
  overviewModel
} from '@/features/campaigns/overview-model'
import { klaviyoData } from '@/features/klaviyo-data/reader'
import { workspaceCredits } from '@/features/operations/credits'
import { validTimezone } from '@/lib/brand-time'
import { klaviyoTabs, parseTab, type KlaviyoTab } from './klaviyo-card'
import {
  dashboardHref,
  dashboardKpis,
  gauge,
  numbersInsight,
  readQuery,
  upcomingSends
} from './model'

/**
 * Everything the dashboard shows, in ONE brand timezone (the workspace's,
 * docs/OWNER_JOURNEYS.md §18.14), with links that keep the rest of the
 * page's state.
 */
export async function dashboardView(
  raw: Record<string, string | string[] | undefined>
) {
  const workspace = await campaignWorkspace()
  const now = new Date()
  const { context } = workspace
  const timezone = validTimezone(context.timezone)
  const query = readQuery(raw)
  const [klaviyo, credits] = await Promise.all([
    klaviyoData(context.tenantId, timezone, now.getTime()),
    workspaceCredits(context, now)
  ])
  const snapshot = klaviyo.state === 'sample' ? klaviyo.snapshot : null
  const campaigns = workspace.data?.campaigns ?? []
  const tab = parseTab(query.tab)
  return {
    workspace,
    now,
    timezone,
    query,
    klaviyo,
    snapshot,
    owner: context.tenantRole === 'owner',
    campaignsFailed: !workspace.data,
    kpis: snapshot ? dashboardKpis(snapshot) : null,
    revenue: snapshot ? gauge(snapshot, now, null, timezone) : null,
    attribution: query.attr === 'utm' ? ('utm' as const) : ('klaviyo' as const),
    attributionHrefs: {
      klaviyo: dashboardHref(query, { attr: null }),
      utm: dashboardHref(query, { attr: 'utm' })
    },
    sends: upcomingSends(campaigns, snapshot, now),
    // What the owner must act on: problems and missed sends first, then
    // approvals (UIR-015).
    waiting: (() => {
      const model = overviewModel(campaigns, now)
      return [
        ...model.attention.map((c) => ({
          id: c.id,
          title: c.title,
          step: campaignNextStep(c, now) ?? 'Check it'
        })),
        ...model.reviews.map((c) => ({
          id: c.id,
          title: c.title,
          step: campaignReview(c, now) ?? 'Review'
        }))
      ]
    })(),
    seeAllWaiting: dashboardHref(
      query,
      { focus: 'review', p: null },
      'your-campaigns'
    ),
    insight: snapshot ? numbersInsight(snapshot) : null,
    insightShown: query.insight === '1',
    insightHref: dashboardHref(query, { insight: '1' }),
    tab,
    tabHrefs: Object.fromEntries(
      klaviyoTabs.map((key) => [
        key,
        dashboardHref(
          query,
          { tab: key === 'overview' ? null : key },
          'klaviyo-data'
        )
      ])
    ) as Record<KlaviyoTab, ReturnType<typeof dashboardHref>>,
    credits,
    campaignLink: (patch: { focus?: string | null; p?: string | null }) =>
      dashboardHref(query, patch, 'your-campaigns')
  }
}
