import type { Route } from 'next'

/**
 * The GROS addresses of Klaviyo's own campaigns, flows, flow emails and
 * metrics (UI-KLV). They are reads of what Klaviyo did and earned, so they
 * sit under Results (the bar's Results item stays current) and lead back
 * to it. A segment's and a list's page are under Audiences (UI-AUDc).
 */
export const resultsHref: Route = '/results'

const at = (base: string, id: string) =>
  `/results/${base}/${encodeURIComponent(id)}` as Route

/** A Klaviyo campaign's page. */
export const klaviyoCampaignHref = (id: string) => at('campaigns', id)
/** A flow's page. */
export const flowHref = (id: string) => at('flows', id)
/** One email of a flow (its flow is found from the email). */
export const flowEmailHref = (id: string) => at('flow-emails', id)
/** A metric's page. */
export const metricHref = (id: string) => at('metrics', id)
