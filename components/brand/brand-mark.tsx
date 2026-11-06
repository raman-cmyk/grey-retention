import Image from 'next/image'
import { cn } from '@/lib/utils'
import {
  defaultBrandPresentation,
  type BrandPresentation
} from '@/lib/branding/presentation'

export function BrandMark({
  compact = false,
  className,
  brand = defaultBrandPresentation
}: {
  compact?: boolean
  className?: string
  brand?: BrandPresentation
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      {brand.logo.src ? (
        <Image
          src={brand.logo.src}
          alt={compact ? brand.logo.alt : ''}
          width={32}
          height={32}
          unoptimized
          className="size-8 object-contain"
        />
      ) : (
        <span
          className="relative grid size-8 place-items-center rounded-[10px] bg-[var(--brand-primary)] text-[var(--on-brand)]"
          aria-hidden
        >
          <span className="absolute h-px w-4 rotate-45 bg-current" />
          <span className="absolute h-px w-4 -rotate-45 bg-current" />
          <span className="size-1.5 rounded-full bg-current" />
        </span>
      )}
      {!compact && (
        <span className="font-[family-name:var(--font-display)] text-base font-normal tracking-[-0.01em]">
          {brand.productName}
        </span>
      )}
      {compact && !brand.logo.src && (
        <span className="sr-only">{brand.productName}</span>
      )}
    </div>
  )
}
