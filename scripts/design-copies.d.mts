import type { Browser } from '@playwright/test'
import type {
  LibraryCopyInput,
  LibraryCopyResult
} from '../features/design-engine/library-copy'
import type { PhotoTools } from '../features/design-engine/photos'
import type { SectionOutcome } from '../features/design-engine/copy'

export const perRun: number
export const runBudgetMs: number
export const copyBudgetMs: number
export const uploadBudgetMs: number
export const reportMs: number
export function claimUntil(start: number): number
export function linkOk(url: string): boolean
export function photoHosts(origins: unknown): string[]
export function sectionOf(s: SectionOutcome): {
  ordinal: number
  kind: string
  result: SectionOutcome['result']
  reason: string | null
}
export function upload(
  url: string | undefined,
  inline: string,
  fetchImpl?: typeof fetch,
  ms?: number
): Promise<void>
export function run(options: {
  base: string
  secret: string
  browser: Browser
  log?: (line: string) => void
  copy?: (
    browser: Browser,
    input: LibraryCopyInput
  ) => Promise<LibraryCopyResult>
  tools?: (origins: string[]) => PhotoTools
  /** The engine version reported (tests; else `ENGINE_VERSION`). */
  engine?: string
  send?: (url: string | undefined, inline: string, ms: number) => Promise<void>
  /** A new browser after a copy ran out of time; without it the run stops. */
  relaunch?: () => Promise<Browser>
  now?: () => number
}): Promise<{
  copied: number
  failed: number
  retry: number
  /** The app runs another engine version: nothing was handed out. */
  skew: boolean
  /** Builds the app carried on after the copies. */
  carried: number
}>
