import 'server-only'
import { previewHtml } from '@/features/email-generation/html'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { brandFromKit, type BlockBrand } from './brand'
import { blockCatalog, type BlockType } from './catalog'
import { blockPreviewDocument } from './render'
import { sampleBlocks, sampleBrand } from './samples'

export type GalleryItem = {
  type: BlockType
  name: string
  purpose: string
  needs: string
  /** Sanitized preview markup (scripts, links and outside loads removed). */
  html: string
}

export type Gallery = {
  items: GalleryItem[]
  brandName: string
  /** Where the colours and font came from, in plain words. */
  brandNote: string
  usesOwnBrand: boolean
}

/**
 * The block gallery (BLK-002): all 20 block types with sample content,
 * drawn in this workspace's brand kit when it has colours, otherwise in a
 * labelled sample brand. The logo stays text here because the preview is
 * isolated from the web; the real email shows it.
 */
export async function blockGallery(): Promise<Gallery> {
  const context = await requireRequestContext('client')
  const brand = await workspaceBrand(context.tenantId)
  return {
    items: blockCatalog.map((b) => ({
      ...b,
      html: previewHtml(
        blockPreviewDocument(sampleBlocks[b.type], brand ?? sampleBrand)
      ).html
    })),
    brandName: (brand ?? sampleBrand).name,
    brandNote: brand
      ? 'Your brand kit colours and font, with sample products and words.'
      : 'Your brand kit has no colours yet, so the blocks show a sample brand. Add your colours and font in Brand & Store.',
    usesOwnBrand: Boolean(brand)
  }
}

async function workspaceBrand(tenantId: string): Promise<BlockBrand | null> {
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const [kit, tenant] = await Promise.all([
    db
      .from('brand_kits')
      .select('colors,fonts')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    db.from('tenants').select('name').eq('id', tenantId).maybeSingle()
  ])
  const colors = kit.data?.colors ?? []
  if (kit.error || !colors.length) return null
  return brandFromKit({
    name: tenant.data?.name ?? '',
    colors,
    fonts: kit.data?.fonts ?? []
  })
}
