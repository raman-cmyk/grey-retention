import type { Browser } from '@playwright/test'

export const width: number
export const scale: number
export const quality: number
export const maxBytes: number
export const minHeight: number
export const maxHeight: number
export function loadableOrigins(origins: Iterable<string>): Set<string>
export function renderSection(
  browser: Browser,
  input: { document: string; height: number; origins: readonly string[] },
  timeoutMs?: number
): Promise<{
  image: Buffer
  contentType: 'image/jpeg'
  width: number
  height: number
}>
