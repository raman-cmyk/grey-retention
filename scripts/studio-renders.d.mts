import type { Browser, BrowserType } from '@playwright/test'

/** One section to draw, as the app hands it out (DST-001b). */
export type RenderJob = {
  job: string
  lease: string
  render: string
  document: string
  height: number
  origins: string[]
  upload: string
}

export const perRun: number
export const runBudgetMs: number
export function launch(chromium: BrowserType): Promise<Browser>
export function run(input: {
  base: string
  secret: string
  browser: Browser
  log?: (line: string) => void
  now?: () => number
}): Promise<{ drawn: number; failed: number }>
