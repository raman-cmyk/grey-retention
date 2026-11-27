import type { Browser } from '@playwright/test'
import type { Blueprint, Section } from './blueprint'
import { copyBlueprint, type CopyResult } from './copy'
import { leaksOf, LeakCheckError, type Leak } from './leaks'
import { lookProblems } from './look'
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
   * DES-ENGINE-003b: the brand's own design (an upload the owner marked
   * as his): its look is kept (`swapBrand` `keepLook`), only the content
   * changes; no leak check against itself, the look kept check instead.
   */
  keepLook?: boolean
}

export type LibraryCopyResult =
  | (Extract<CopyResult, { ok: true }> & {
      leaks: Leak[]
      /**
       * DES-ENGINE-003b: an own design's look as drawn against the
       * original (`lookProblems`); empty when kept, or not an own design.
       */
      look: string[]
      /** The library Footer block was added (the original had no footer text). */
      footerAdded: boolean
      /**
       * The cut photos, by the placeholder address each has in `html`
       * until it is hosted (the browser job uploads them; a preview puts
       * them inline with `withCutsInline`).
       */
      cuts: Cut[]
    })
  | {
      ok: false
      error: string
      /**
       * DES-ENGINE-002b2: the browser failed (it crashed, a page closed or
       * timed out), not the email: worth another try. False for a refusal
       * that would be the same every time (a copy that does not fit, a
       * leak check without the original).
       */
      retry: boolean
    }

/** A browser failure, not the email's (Playwright's and the engine's words). */
export const transientError = (error: string) =>
  /could not be copied:|could not be opened|took too long|timeout|timed out|target (?:page|closed)|has been closed|browser.*closed|crash|protocol error|disconnected|net::err/i.test(
    error
  )

/** The reason a Footer block is added, after "Section n (footer)". */
export const footerAddedWhy =
  'is the footer Klaviyo needs (the unsubscribe link and address), which the original did not have'

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
      rules: input.rules,
      ...(input.keepLook ? { keepLook: true } : {})
    }
    const swapped =
      crop === 'canvas'
        ? await swapWithCrops(swapIn, tools)
        : swapBrand({ ...swapIn, cropper: crop })
    if (!swapped.ok) return { ...swapped, retry: false }
    let source = input.source
    let target = swapped.target
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
    if (!result.ok) return { ...result, retry: transientError(result.error) }
    // The brand's own design is not checked against itself (its words,
    // pictures and links are the brand's own); its look must be kept.
    const leaks = input.keepLook
      ? []
      : leaksOf({
          source: input.source,
          sourceHtml: input.sourceHtml,
          html: result.html,
          sourceNames: input.sourceNames,
          vocabulary: [...input.vocabulary, ...swapOwnWords(input.brand)]
        })
    const look = input.keepLook
      ? lookProblems(
          source,
          result.drawn,
          new Set(
            result.sections
              .filter((s) => s.result !== 'copied')
              .map((s) => s.ordinal)
          )
        )
      : []
    return {
      ...result,
      leaks,
      look,
      footerAdded,
      cuts: ((swapped as { cuts?: Cut[] }).cuts ?? []) as Cut[]
    }
  } catch (error) {
    if (error instanceof LeakCheckError)
      return { ok: false, error: error.message, retry: false }
    return {
      ok: false,
      error: `The email could not be copied: ${error instanceof Error ? error.message : String(error)}`,
      retry: true
    }
  }
}

/** The copy's HTML with each cut photo inline (previews and the gate's pictures). */
export const withCutsInline = (html: string, cuts: readonly Cut[]) =>
  cuts.reduce((out, c) => out.split(c.placeholder).join(c.inline), html)
