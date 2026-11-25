import type { Browser } from '@playwright/test'
import type { StoredMeasure } from '../features/design-engine/stored'

export type BlueprintJob = {
  job: string
  lease: string
  html: string
  images: { ref: string; url: string }[]
}

export const perRun: number
export const runBudgetMs: number
export function pictureOrigins(job: Pick<BlueprintJob, 'images'>): string[]
export function run(options: {
  base: string
  secret: string
  browser: Browser
  log?: (line: string) => void
  measure?: (
    browser: Browser,
    html: string,
    origins: readonly string[]
  ) => Promise<StoredMeasure>
  /** The engine version reported (tests; else `ENGINE_VERSION`). */
  engine?: string
  now?: () => number
}): Promise<{ measured: number; failed: number; retry: number }>
