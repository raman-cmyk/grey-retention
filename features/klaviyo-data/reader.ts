import 'server-only'
import { cache } from 'react'
import { sampleKlaviyoSnapshot } from './fixture'
import type { KlaviyoData } from './types'

/**
 * The brand's Klaviyo data for owner screens. With the fake provider
 * (`ADAPTER_MODE=fake`, the default) it is labelled sample data. The live
 * read adapter is not built yet, so real mode honestly reports "not
 * connected" instead of showing anything made up.
 */
export const klaviyoData = cache(
  async (timezone: string, now: Date = new Date()): Promise<KlaviyoData> => {
    if (process.env.ADAPTER_MODE === 'real') return { state: 'not_connected' }
    return {
      state: 'sample',
      snapshot: sampleKlaviyoSnapshot({ now, timezone })
    }
  }
)
