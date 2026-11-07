'use client'

import { useEffect, useRef, useState } from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import type { BlockType } from './catalog'
import type { GalleryItem } from './gallery-data'

type Width = 'desktop' | 'phone'
const widths: Record<Width, number> = { desktop: 600, phone: 375 }

/**
 * Frame heights per block, generous enough for the sample content at each
 * width; a taller block scrolls inside its frame. The frame is opaque
 * (sandbox="") so its content is never measured.
 */
const heights: Record<BlockType, [desktop: number, phone: number]> = {
  header: [130, 150],
  hero: [660, 600],
  offer_banner: [400, 460],
  free_shipping_bar: [60, 80],
  product_feature: [380, 760],
  product_grid_2: [800, 640],
  product_grid_3: [360, 1300],
  category_tiles: [680, 480],
  image_text: [380, 760],
  text: [280, 420],
  founder_note: [560, 700],
  review_strip: [280, 700],
  ugc_grid: [300, 240],
  before_after: [400, 300],
  benefits: [220, 520],
  how_it_works: [260, 580],
  comparison: [320, 360],
  faq: [380, 520],
  cta: [240, 300],
  footer: [170, 210]
}

export function BlockGallery({
  items,
  brandName
}: {
  items: GalleryItem[]
  brandName: string
}) {
  const [width, setWidth] = useState<Width>('desktop')
  return (
    <div className="space-y-6">
      <SegmentedControl
        name="block-width"
        legend="Preview width"
        value={width}
        onValueChange={setWidth}
        options={[
          { value: 'desktop', label: 'Desktop · 600px' },
          { value: 'phone', label: 'Phone · 375px' }
        ]}
      />
      <ol className="grid gap-6 lg:grid-cols-2">
        {items.map((item, i) => (
          <li
            key={item.type}
            className="min-w-0 rounded-[var(--radius-panel)] border border-[var(--line)] bg-[var(--surface-raised)] p-5"
          >
            <p className="font-mono text-[0.6875rem] tracking-[0.08em] text-[var(--text-muted)] uppercase">
              {i + 1} of {items.length} · {item.type}
            </p>
            <h2 className="mt-1 text-base font-semibold">{item.name}</h2>
            <p className="mt-2 text-sm">{item.purpose}</p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Needs: {item.needs}
            </p>
            <div className="mt-4">
              <BlockFrame
                title={`${item.name} in ${brandName}, ${width === 'phone' ? 'phone' : 'desktop'} width (sample content)`}
                html={item.html}
                width={widths[width]}
                height={heights[item.type][width === 'phone' ? 1 : 0]}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The block at its real email width, scaled down to fit the card. */
function BlockFrame({
  title,
  html,
  width,
  height
}: {
  title: string
  html: string
  width: number
  height: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const element = box.current
    if (!element) return
    const update = () =>
      setScale(Math.min(1, Math.max(0.3, element.clientWidth / width)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [width])
  return (
    <div
      ref={box}
      data-testid="block-canvas"
      data-width={width}
      className="relative w-full overflow-hidden rounded-xl border border-[var(--line)] bg-white"
      style={{ height: height * scale }}
    >
      <iframe
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={html}
        width={width}
        height={height}
        className="absolute top-0 left-1/2 block max-w-none origin-top border-0 bg-white"
        style={{
          width,
          height,
          transform: `translateX(-50%) scale(${scale})`
        }}
      />
    </div>
  )
}
