import type { Browser } from '@playwright/test'
import type { Blueprint } from '../features/design-engine/blueprint'
import type { BlockCheck } from '../features/design-engine/blocks'

export const perRun: number
export const runBudgetMs: number
export const renewEveryMs: number
export function run(options: {
  base: string
  secret: string
  browser: Browser
  log?: (line: string) => void
  check?: (browser: Browser, blueprint: Blueprint) => Promise<BlockCheck>
  /** The engine version reported (tests; else `ENGINE_VERSION`). */
  engine?: string
  now?: () => number
}): Promise<{
  sources: number
  passed: number
  failed: number
  retry: number
  /** The app runs another engine version: nothing was handed out. */
  skew: boolean
}>
