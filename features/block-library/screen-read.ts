import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { blockKinds, type BlockKind } from '@/features/design-engine/blocks'
import { drawBlueprint } from '@/features/design-engine/render'
import { swapBrand, type SwapBrand } from '@/features/design-engine/swap'
import type { WordPools } from '@/features/design-engine/words'
import { swapBrandOf } from '@/features/email-build/library-copy'
import type { Store } from '@/features/email-build/ports'
import { libraryScratchOn } from '@/features/email-build/scratch-switch'
import { ownStoreSource } from '@/features/onboarding/store-source'
import { createServiceClient } from '@/lib/supabase/service'
import { blockBlueprints, workspaceLibrary, type WorkspaceBlock } from './read'

/**
 * DES-ENGINE-004b: the library screen's view. The member is checked first
 * (`requireRequestContext` by the page: this workspace only); then the
 * service role reads the blocks this workspace may use (`workspaceLibrary`:
 * shared ones and its own private ones, never another workspace's) and
 * draws each one shown in **the brand's own look** on the server
 * (`swapBrand` + `drawBlueprint`): the brand's colours, fonts, logo and
 * products, preview words GROS writes from the brand's name and products.
 * A block holds no competitor word, picture or link (structure only), and
 * neither does what reaches the browser. Each kind shows its most used
 * layouts first.
 */

export const screenLimits = {
  /** Layouts drawn per kind. */
  perKind: 6
} as const

export type ShownBlock = {
  id: string
  kind: BlockKind
  /** How many sections in the library use this layout. */
  uses: number
  /** From more than one brand's emails. */
  brands: number
  yours: boolean
  hidden: boolean
  /** The block drawn in the brand's look (sanitized again by the screen). */
  html: string
}

export type LibraryView =
  | {
      ok: false
      on: boolean
      /** Why, when on: the library or the store could not be read, or no store yet. */
      why?: 'unread' | 'no_store'
    }
  | {
      ok: true
      on: true
      /** The owner or an admin: may hide a layout. */
      manager: boolean
      brandName: string
      /** Every block this workspace may use, by kind (counts). */
      total: number
      kinds: { kind: BlockKind; count: number; shown: ShownBlock[] }[]
    }

/**
 * The workspace's own store, never a sample one: a store not read yet, or
 * one that cannot be read now, shows the page's own state instead of
 * another brand's look.
 */
async function storeOf(
  db: NonNullable<ReturnType<typeof createServiceClient>>,
  tenant: string
): Promise<Store | 'no_store'> {
  try {
    return await ownStoreSource(db).read(tenant)
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'plan_store_changed')
      return 'no_store'
    throw error
  }
}

/** Words GROS writes for the preview, from the brand's own name and products. */
export function previewWords(
  brandName: string,
  products: readonly string[]
): WordPools {
  const name = brandName.trim() || 'Your brand'
  return {
    headline: [`New from ${name}`, ...products.slice(0, 4)],
    subheadline: [`Picked for you by ${name}`],
    eyebrow: [name],
    body: [
      `A short note from ${name} about what is new this week, written for your customers in your own voice.`
    ],
    button: ['Shop now', 'See more'],
    caption: [name]
  }
}

/** One block drawn in the brand's look, or null when it cannot be drawn. */
export function drawInBrand(
  blueprint: Parameters<typeof swapBrand>[0]['source'],
  brand: SwapBrand,
  products: Parameters<typeof swapBrand>[0]['products']
): string | null {
  try {
    const swapped = swapBrand({
      source: blueprint,
      brand,
      products,
      words: previewWords(
        brand.name,
        products.map((p) => p.title)
      ),
      rules: { offer: null, maxDiscountPercent: 0 },
      cropper: null
    })
    if (!swapped.ok) return null
    return drawBlueprint(swapped.target, { mode: 'preview', title: brand.name })
  } catch {
    return null
  }
}

export async function readLibraryScreen(
  context: Pick<ClientRequestContext, 'tenantId' | 'tenantRole'>,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<LibraryView> {
  const on = libraryScratchOn(env)
  if (!on) return { ok: false, on: false }
  const db = createServiceClient()
  if (!db) return { ok: false, on: true }
  try {
    const [blocks, store] = await Promise.all([
      workspaceLibrary(db, context.tenantId, { withHidden: true }),
      storeOf(db, context.tenantId)
    ])
    if (store === 'no_store') return { ok: false, on: true, why: 'no_store' }
    const brand = swapBrandOf(
      store.brand,
      store.confirmed?.lifestylePhoto,
      store.fonts
    )
    const products = store.products.slice(0, 6).map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      compareAt: null,
      url: p.url,
      photo: null
    }))
    const byKind = new Map<BlockKind, WorkspaceBlock[]>()
    for (const b of blocks)
      byKind.set(b.kind, [...(byKind.get(b.kind) ?? []), b])
    const picked = blockKinds.flatMap((k) =>
      (byKind.get(k) ?? []).slice(0, screenLimits.perKind)
    )
    const prints = await blockBlueprints(
      db,
      context.tenantId,
      picked.map((b) => b.id)
    )
    const kinds = blockKinds
      .filter((k) => byKind.has(k))
      .map((kind) => {
        const all = byKind.get(kind)!
        return {
          kind,
          count: all.length,
          shown: all.slice(0, screenLimits.perKind).flatMap((b) => {
            const bp = prints.get(b.id)
            const html = bp ? drawInBrand(bp, brand, products) : null
            return html
              ? [
                  {
                    id: b.id,
                    kind,
                    uses: b.uses,
                    brands: b.brands,
                    yours: b.yours,
                    hidden: b.hidden,
                    html
                  }
                ]
              : []
          })
        }
      })
    return {
      ok: true,
      on: true,
      manager: context.tenantRole === 'owner' || context.tenantRole === 'admin',
      brandName: brand.name,
      total: blocks.length,
      kinds
    }
  } catch {
    return { ok: false, on: true, why: 'unread' }
  }
}
