import type { Browser, BrowserType } from '@playwright/test'

export type ScreenshotJob = {
  job: string
  lease: string
  html: string
  images: { ref: string; url: string }[]
  upload: string
  sections: { ordinal: number; upload: string }[]
}

export const width: number
export const maxWidth: number
export const maxHeight: number
export const maxBytes: number
export const perRun: number
export const cropBudgetMs: number
export const uploadBudgetMs: number
/** How long one picture or style (`loadMs`) and the page (`pageMs`) may take. */
export const timing: { loadMs: number; pageMs: number }
export function launch(chromium: BrowserType): Promise<Browser>
export function prepareHtml(
  html: string,
  images: ScreenshotJob['images']
): string
export function allowedOrigins(
  job: Pick<ScreenshotJob, 'html' | 'images'>
): Set<string>
export function render(
  browser: Browser,
  job: Pick<ScreenshotJob, 'html' | 'images'> &
    Partial<Pick<ScreenshotJob, 'sections'>>,
  html: string,
  /** When to stop cropping sections (epoch milliseconds). */
  until?: number,
  times?: { loadMs: number; pageMs: number }
): Promise<{
  image: Uint8Array
  width: number
  height: number
  sections: {
    ordinal: number
    top: number
    height: number
    image: Uint8Array
  }[]
  /** The job's own pictures or styles refused (a redirect) or failed. */
  unloaded: number
}>
export function run(options: {
  base: string
  secret: string
  browser: Browser
  log?: (line: string) => void
  times?: { loadMs: number; pageMs: number }
}): Promise<{ taken: number; failed: number; unloaded: number }>
