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
export type EmailView = 'desktop' | 'phone' | 'dark'
export const emailViews: Readonly<
  Record<EmailView, Readonly<{ width: number; colorScheme: 'light' | 'dark' }>>
>
export const maxEmailHeight: number
export const maxEmailBytes: number
export const emailWindow: number
export function renderEmail(
  browser: Browser,
  input: { document: string; view: EmailView; origins: readonly string[] },
  timeoutMs?: number
): Promise<{
  image: Buffer
  contentType: 'image/jpeg'
  width: number
  height: number
  cut: boolean
  wide: boolean
}>
