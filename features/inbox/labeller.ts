import type { BlockType } from '@/features/blocks/catalog'
import type { EmailSection } from './sections'

/**
 * The INB-003 rules for a section's family (one of the 20 block types),
 * from its structure and words: honest, cheap and fixed. The Section tagger
 * (features/intelligence/tagger.ts) uses them as its sample family.
 */
export type SectionLabel = {
  type: BlockType | 'unsure'
  confidence: number
  source: 'sample'
}

const price = /[$£€]\s?\d/
const sure = (type: BlockType, confidence: number): SectionLabel => ({
  type,
  confidence,
  source: 'sample'
})

/**
 * Rules from the section's structure and words: honest, cheap and fixed.
 * It says 'unsure' rather than guess.
 */
export function sampleLabel(
  s: EmailSection,
  { ordinal, of }: { ordinal: number; of: number }
): SectionLabel {
  const text = s.text.toLowerCase()
  const prices = (s.text.match(/[$£€]\s?\d+/g) ?? []).length
  if (/unsubscribe|manage (your )?preferences/.test(text))
    return sure('footer', 0.9)
  // "View in browser" above the email is its top bar, not the footer.
  if (/view (it |this )?(in (your )?browser|online)|trouble viewing/.test(text))
    return ordinal <= 2 ? sure('announcement_bar', 0.6) : sure('footer', 0.7)
  if (ordinal <= 2 && s.images === 0 && s.words > 0 && s.words <= 15)
    return sure('announcement_bar', 0.7)
  if (ordinal <= 3 && s.images === 1 && s.wideImages === 0 && s.words <= 3)
    return sure('header_logo', 0.7)
  if (s.images >= 2 && prices >= 2) {
    // Six products are two rows of three or three rows of two: the
    // template's own column width says which.
    const thirds = /\b33(\.\d+)?%|mj-column-per-33/i.test(s.html)
    return sure(
      s.images % 3 === 0 && (s.images % 2 !== 0 || thirds)
        ? 'product_grid_3col'
        : 'product_grid_2col',
      0.7
    )
  }
  if (s.images >= 4 && /instagram|tag us|#\w+/.test(text))
    return sure('ugc_grid', 0.6)
  if (s.images >= 3) return sure('category_tiles', 0.5)
  if (/★|☆|\breviews?\b|rated \d|stars?\b/.test(text) && /["“”]/.test(s.text))
    return sure('review_strip', 0.6)
  if ((s.text.match(/\?/g) ?? []).length >= 2) return sure('faq', 0.6)
  if (/\bstep (1|one)\b|^1[.)]\s/m.test(text)) return sure('steps', 0.6)
  if (/\bbefore\b.*\bafter\b/.test(text) && s.images >= 1)
    return sure('before_after', 0.6)
  if (/\bfounder\b|^[-—–]\s?\w+/m.test(text) && s.words >= 20)
    return sure('founder_note', 0.6)
  if (/\d{1,2}\s?% off|\bcode\b|\bsave\b/.test(text) && s.words <= 25)
    return sure('offer_banner', 0.6)
  if (s.links.length >= 1 && s.images === 0 && s.words <= 6)
    return sure('cta', 0.7)
  if (
    ordinal >= of - 2 &&
    s.images === 0 &&
    s.words <= 20 &&
    /thanks|thank you|cheers|\bxo\b|love,|see you/.test(text)
  )
    return sure('signoff', 0.6)
  if (s.images === 1 && (ordinal <= 5 || s.wideImages === 1) && s.words < 10)
    return sure(price.test(s.text) ? 'hero_product' : 'hero_image', 0.6)
  if (s.images === 1 && price.test(s.text)) return sure('product_feature', 0.6)
  if (s.images >= 1 && s.words >= 30) return sure('image_text', 0.6)
  if (s.images === 0 && s.words > 0) return sure('text', 0.7)
  return { type: 'unsure', confidence: 0.2, source: 'sample' }
}
