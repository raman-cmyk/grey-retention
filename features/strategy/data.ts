import type { PlanInput } from './plan'
import { sampleCompetitors, sampleStore } from './sample'

/**
 * Where "Plan next 15 days" reads the store from: a typed port with a
 * sample version. Lane B's readers (ONB-101..105: site, Klaviyo catalog
 * and history, ads, reviews) and the campaign defaults replace the sample
 * one store at a time; the plan code does not change.
 */
export type StrategyData = {
  load(input: { tenantId: string; start: string }): Promise<{
    /** Raw store data for `readPulseInput` (checked there). */
    pulse: unknown
    /** Raw competitor data for `readMapperInput` (checked there). */
    mapper: unknown
    /** The rest of the plan's input (checked by `readPlanInput`). */
    plan: Pick<
      PlanInput,
      | 'industry'
      | 'sendsPerWeek'
      | 'sendTime'
      | 'products'
      | 'audiences'
      | 'blackouts'
      | 'existing'
    >
  }>
}

/** The sample store (D8: neutral names, synthetic facts) for every workspace. */
export const sampleStrategyData: StrategyData = {
  async load({ start }) {
    const store = sampleStore(start)
    const competitors = sampleCompetitors(start)
    return {
      pulse: store,
      mapper: {
        industry: store.brand.industry,
        brandSize: 'small',
        start,
        ...competitors
      },
      plan: {
        industry: store.brand.industry,
        sendsPerWeek: 3,
        sendTime: '10:00',
        products: store.products.map((p) => ({
          id: p.id,
          title: p.title,
          inStock: p.stock !== 0,
          availableFrom:
            p.launchedOn && p.launchedOn >= start ? p.launchedOn : null
        })),
        audiences: [
          { id: 'sample-engaged', label: 'Engaged subscribers (sample)' }
        ],
        blackouts: store.dates
          .filter((d) => d.kind === 'blackout')
          .map((d) => d.date),
        existing: []
      }
    }
  }
}
