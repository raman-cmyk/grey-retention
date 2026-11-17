import type { Browser } from '@playwright/test'

/** A grey-level grid (DST-004b1's `LumaGrid`). */
export type LumaGrid = { width: number; height: number; values: number[] }

export const gridBudget: { columns: number; rows: number }
export const maxCropBytes: number
export const cropMs: number
export function averageGrid(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  budget: { columns: number; rows: number }
): LumaGrid
export function lumaGrid(
  browser: Browser,
  jpeg: Uint8Array,
  timeoutMs?: number
): Promise<LumaGrid | null>
export function fetchCrop(url: string, ms?: number): Promise<Uint8Array>
