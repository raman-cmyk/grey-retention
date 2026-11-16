import { productTakes } from '@/features/assembly/assemble'
import type { BlockType } from './catalog'

/**
 * DST-007: how tall each block is drawn, in CSS px at 600 wide on a
 * desktop (the email's own layout, not its phone one), with the block
 * library's sample content (`samples.ts`), as Chromium measures it. Live
 * sections are drawn at about these heights: nothing stretches them, so
 * only a designed picture or the number of sections makes an email
 * taller. The browser test `tests/e2e/email-length.spec.ts` fails when a
 * block drifts from its height here.
 */
export const blockHeights: { readonly [T in BlockType]: number } = {
  announcement_bar: 38,
  header_logo: 70,
  hero_product: 677,
  hero_image: 560,
  offer_banner: 335,
  text: 198,
  steps: 222,
  product_feature: 316,
  product_grid_2col: 811,
  product_grid_3col: 351,
  image_text: 316,
  review_strip: 225,
  founder_note: 387,
  faq: 270,
  ugc_grid: 367,
  category_tiles: 701,
  before_after: 379,
  cta: 96,
  signoff: 78,
  footer: 183
}

/** A product grid: its heading, then a row per `per` products. */
export const gridRows: Partial<
  Record<BlockType, { base: number; row: number; per: number }>
> = {
  product_grid_2col: { base: 75, row: 368, per: 2 },
  product_grid_3col: { base: 75, row: 276, per: 3 }
}

/** A block's height showing `products` products (a grid grows by its rows; none: its sample's). */
export function blockHeight(family: BlockType, products = 0) {
  const grid = gridRows[family]
  return grid && products > 0
    ? grid.base + Math.ceil(products / grid.per) * grid.row
    : blockHeights[family]
}

/** The email's height at 600 wide, in CSS px (D25: about 2,000). */
export const emailHeight = { min: 1_800, max: 2_400 }

/** About how tall these sections make an email, with `products` placed as `fill` places them. */
export function emailHeightOf(families: readonly BlockType[], products: number) {
  const takes = productTakes(families, products)
  return families.reduce((n, f, i) => n + blockHeight(f, takes[i]), 0)
}
