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
  until?: number
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
}>
export function run(options: {
  base: string
  secret: string
  browser: Browser
  log?: (line: string) => void
}): Promise<{ taken: number; failed: number }>
