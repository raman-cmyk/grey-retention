import type { Browser, BrowserType } from '@playwright/test'

export function loadableOrigins(origins: Iterable<string>): Set<string>
export function makeInert(html: string): string
export function launch(chromium: BrowserType): Promise<Browser>
