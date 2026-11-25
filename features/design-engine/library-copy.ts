import type { Browser } from '@playwright/test'
import type { Blueprint, Item, Section } from './blueprint'
import { copyBlueprint, type CopyResult } from './copy'
import { leaksOf, LeakCheckError, type Leak } from './leaks'
import {
  photoTools,
  sizedPhotos,
  swapWithCrops,
  type Cut,
  type PhotoTools
} from './photos'
import type { DrawMode } from './render'
import {
  swapBrand,
  swapOwnWords,
  type Cropper,
  type SwapBrand,
  type SwapPicture,
  type SwapProduct
} from './swap'
import type { WordPools, WordRules } from './words'

/**
 * DES-ENGINE-002b: a library email copied for a brand, the whole way the
 * browser job runs it ("Use this design", Copy): the store's photos sized
 * and cut to each slot's shape (`photos.ts`), the brand swap, the draw
 * and structure check (`copyBlueprint`), the library Footer block added
 * when the original had no footer text (Klaviyo needs one), and the leak
 * check against the original's own HTML. Never throws; a leak makes the
 * copy unusable (`ok` true with `leaks`, the caller refuses it).
 */

export type LibraryCopyInput = {
  /** The stored blueprint (no pictures or links). */
  source: Blueprint
  /** The original's own (marked) HTML, for the leak check. */
  sourceHtml: string
  /** The original brand's names and domains. */
  sourceNames: readonly string[]
  brand: SwapBrand
  products: readonly SwapProduct[]
  words: WordPools
  rules: WordRules
  /** Everything the brand's content says, for the leak check. */
  vocabulary: readonly string[]
  mode?: DrawMode
  /**
   * How photos are cut to a slot's shape: 'canvas' (the centre, drawn in
   * the locked browser; the default), a cropper (tests), or none.
   */
  crop?: 'canvas' | Cropper | null
  /** The photo tools (tests); default: `photoTools` in this browser. */
  tools?: PhotoTools
  /**
   * Where a cut photo (an inline JPEG) is kept: its https address, or
   * null. A Klaviyo drawing takes only https pictures, so the browser job
   * hands each cut photo over here and uploads it after (DES-ENGINE-002b2).
   */
  host?: (inline: string, index: number) => string | null
}

export type LibraryCopyResult =
  | (Extract<CopyResult, { ok: true }> & {
      leaks: Leak[]
      /** The library Footer block was added (the original had no footer text). */
      footerAdded: boolean
      /**
       * The cut photos, by the placeholder address each has in `html`
       * until it is hosted (the browser job uploads them; a preview puts
       * them inline with `withCutsInline`).
       */
      cuts: Cut[]
    })
  | { ok: false; error: string }

/** The reason a Footer block is added, after "Section n (footer)". */
export const footerAddedWhy =
  'is the footer Klaviyo needs (the unsubscribe link and address), which the original did not have'

/** The blueprint with each inline picture replaced by its hosted address. */
function hosted(
  bp: Blueprint,
  host: (inline: string, index: number) => string | null
): Blueprint {
  const seen = new Map<string, string | null>()
  const walk = (items: readonly Item[]): Item[] =>
    items.map((item) => {
      if (item.type === 'row')
        return {
          ...item,
          columns: item.columns.map((c) => ({ ...c, items: walk(c.items) }))
        }
      if (item.type !== 'image' || !item.src?.startsWith('data:')) return item
      if (!seen.has(item.src)) seen.set(item.src, host(item.src, seen.size))
      return { ...item, src: seen.get(item.src) ?? null }
    })
  return {
    ...bp,
    sections: bp.sections.map((s) => ({ ...s, items: walk(s.items) }))
  }
}

/** The blueprint with an empty footer section at its end, for the Footer block. */
function withFooter(bp: Blueprint): Blueprint {
  const last = bp.sections.at(-1)!
  const footer: Section = {
    ordinal: last.ordinal + 1,
    kind: 'footer',
    gapBefore: 0,
    x: 0,
    width: bp.width,
    height: 0,
    background: null,
    around: bp.body,
    items: [],
    bottom: 0,
    unsupported: null
  }
  return { ...bp, sections: [...bp.sections, footer] }
}

export async function libraryCopy(
  browser: Browser,
  input: LibraryCopyInput
): Promise<LibraryCopyResult> {
  try {
    // Photos only from the fixed list of hosts (`photoOrigins`), never one
    // a store's own data names.
    const tools = input.tools ?? photoTools(browser)
    const crop = input.crop === undefined ? 'canvas' : input.crop
    // Photos of unknown size are read first (a catalog keeps none).
    const products = await Promise.all(
      input.products.map(async (p) => {
        if (!p.photo) return p
        const [photo] = await sizedPhotos(tools, [p.photo])
        return { ...p, photo: photo ?? null }
      })
    )
    const one = async (p: SwapPicture | null | undefined) =>
      p ? ((await sizedPhotos(tools, [p]))[0] ?? null) : null
    const brand = {
      ...input.brand,
      // The logo's own shape decides its width; a catalog keeps no sizes.
      logo: await one(input.brand.logo),
      logoOnDark: await one(input.brand.logoOnDark),
      photos: await sizedPhotos(tools, input.brand.photos ?? [])
    }
    const swapIn = {
      source: input.source,
      brand,
      products,
      words: input.words,
      rules: input.rules
    }
    const swapped =
      crop === 'canvas'
        ? await swapWithCrops(swapIn, tools)
        : swapBrand({ ...swapIn, cropper: crop })
    if (!swapped.ok) return swapped
    let source = input.source
    let target = input.host
      ? hosted(swapped.target, input.host)
      : swapped.target
    const blocked = new Map(swapped.blocked)
    const footerAdded =
      !swapped.footer &&
      source.sections.length < 40 &&
      source.sections.length > 0
    if (footerAdded) {
      source = withFooter(source)
      target = withFooter(target)
      blocked.set(source.sections.at(-1)!.ordinal, footerAddedWhy)
    }
    const result = await copyBlueprint(browser, source, target, {
      blocked,
      lengthen: swapped.lengthen,
      brand: swapped.blockBrand,
      mode: input.mode ?? 'preview'
    })
    if (!result.ok) return result
    const leaks = leaksOf({
      source: input.source,
      sourceHtml: input.sourceHtml,
      html: result.html,
      sourceNames: input.sourceNames,
      vocabulary: [...input.vocabulary, ...swapOwnWords(input.brand)]
    })
    return {
      ...result,
      leaks,
      footerAdded,
      cuts: ((swapped as { cuts?: Cut[] }).cuts ?? []) as Cut[]
    }
  } catch (error) {
    if (error instanceof LeakCheckError)
      return { ok: false, error: error.message }
    return {
      ok: false,
      error: `The email could not be copied: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

/** The copy's HTML with each cut photo inline (previews and the gate's pictures). */
export const withCutsInline = (html: string, cuts: readonly Cut[]) =>
  cuts.reduce((out, c) => out.split(c.placeholder).join(c.inline), html)
