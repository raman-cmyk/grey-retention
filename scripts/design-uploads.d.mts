import type { Browser } from '@playwright/test'
import type { StoredMeasure } from '../features/design-engine/stored'

export type UploadJob = {
  job: string
  lease: string
  design: 'own' | 'other'
  pictures: number
  html: string
  etag?: string
}

export const perRun: number
export const runBudgetMs: number
export function run(options: {
  base: string
  secret: string
  browser: Browser
  log?: (line: string) => void
  measure?: (
    browser: Browser,
    html: string,
    design: 'own' | 'other',
    pictures: number
  ) => Promise<StoredMeasure>
  /** The engine version reported (tests; else `ENGINE_VERSION`). */
  engine?: string
  now?: () => number
}): Promise<{
  measured: number
  failed: number
  retry: number
  /** The app runs another engine version: nothing was handed out. */
  skew: boolean
  /** Deleted uploads' folders and leftover folders removed. */
  cleaned: number
}>
