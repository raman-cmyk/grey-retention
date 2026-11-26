import type { Browser } from '@playwright/test'
import {
  parseBlueprint,
  type Blueprint,
  type Item
} from '@/features/design-engine/blueprint'
import { desktopWindow, measureHtml } from '@/features/design-engine/browser'
import { blueprintFrom } from '@/features/design-engine/measure'
import {
  checkStored,
  failureOf,
  storedLimit,
  type StoredMeasure
} from '@/features/design-engine/stored'
import type { UploadDesign } from './limits'
import { placeholderIndex } from './prepare'

/**
 * DES-ENGINE-003: an uploaded email measured into its blueprint, once, by
 * the browser job (`scripts/design-uploads.mjs`), in the same locked
 * browser as every measurement (JavaScript off, no request at all: every
 * picture the file carried is already an empty drawing of its own size,
 * its placeholder beside it). Our own section marks are trusted (the
 * server marked it).
 * - **Another brand's email** is kept as the inbox keeps one: no picture
 *   address, no link (`forStorage`, rule 8).
 * - **The brand's own design** keeps its pictures (their placeholders,
 *   which the copy turns into the stored pictures' links) and its links;
 *   a picture that is not one of its stored ones keeps its web address
 *   only when it is https (the copy then builds that section from a block
 *   and says why), else none.
 * Never throws.
 */

const keepPictures = (items: readonly Item[], stored: number): Item[] =>
  items.map((item) => {
    if (item.type === 'row')
      return {
        ...item,
        columns: item.columns.map((c) => ({
          ...c,
          items: keepPictures(c.items, stored)
        }))
      }
    if (item.type !== 'image' || !item.src) return item
    const n = placeholderIndex(item.src)
    if (n !== null) return n < stored ? item : { ...item, src: null }
    return /^https:\/\//i.test(item.src) ? item : { ...item, src: null }
  })

/** An own design's blueprint as kept: valid, small enough, pictures checked. */
export function checkOwn(value: unknown, stored: number): StoredMeasure {
  const parsed = parseBlueprint(value)
  if (!parsed.ok) return { ok: false, failure: 'not_valid', retry: false }
  const bp: Blueprint = {
    ...parsed.blueprint,
    sections: parsed.blueprint.sections.map((s) => ({
      ...s,
      items: keepPictures(s.items, stored)
    }))
  }
  if (JSON.stringify(bp).length > storedLimit)
    return { ok: false, failure: 'stored_too_large', retry: false }
  return { ok: true, blueprint: bp }
}

/** The blueprint as kept for this upload's kind. */
export const checkUpload = (
  value: unknown,
  design: UploadDesign,
  stored: number
): StoredMeasure =>
  design === 'other' ? checkStored(value) : checkOwn(value, stored)

export async function measureUpload(
  browser: Browser,
  html: string,
  design: UploadDesign,
  stored: number
): Promise<StoredMeasure> {
  try {
    const measured = await measureHtml(browser, html, desktopWindow, {
      origins: [],
      trustMarks: true
    })
    if (!measured.ok) return failureOf(measured.error)
    const made = blueprintFrom(measured.measurement)
    if (!made.ok) return failureOf(made.error)
    return checkUpload(made.blueprint, design, stored)
  } catch (error) {
    return failureOf(error instanceof Error ? error.message : String(error))
  }
}
