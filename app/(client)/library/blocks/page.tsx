import { PageHeading, Notice } from '@/components/ui/workspace'
import { BlockGallery } from '@/features/blocks/gallery'
import { blockGallery } from '@/features/blocks/gallery-data'

export const metadata = { title: 'Block library' }

/** BLK-002: the 20 block types every email is built from, in the brand. */
export default async function BlockLibraryPage() {
  const gallery = await blockGallery()
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="Block library"
        description="Every email Grey Retention writes is built from these 20 blocks, in your brand. The products, photos and words here are samples."
      />
      <div className="mb-6">
        <Notice>{gallery.brandNote}</Notice>
      </div>
      <BlockGallery items={gallery.items} brandName={gallery.brandName} />
    </div>
  )
}
