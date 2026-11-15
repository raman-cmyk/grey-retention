import type { Browser } from '@playwright/test'

export const width: number
export const scale: number
export const maxBytes: number
export function renderSection(
  browser: Browser,
  input: { document: string; height: number; origins: readonly string[] },
  timeoutMs?: number
): Promise<{ png: Buffer; width: number; height: number }>
