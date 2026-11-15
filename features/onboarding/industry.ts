import { industries, type Industry } from '@/features/intelligence/taxonomy'

/**
 * The brand's industry on the fixed list (CI-001) from a sentence in its own
 * words, such as the catalog analyst's "offering" finding: "Sells menswear
 * basics: overshirts, knitwear and bags." Whole words only (never "ring"
 * inside "offering" or "hair" inside "chairs"), counted per industry.
 * `industriesInWords` gives every industry named, most words first;
 * `industryInWords` the first of them, `other` when no word is known, null
 * for no words at all.
 *
 * `industryOf` (features/intelligence/classifier.ts) stays for an admin's
 * short niche words; this one is for sentences.
 */

/**
 * Ties go to the earlier one: who it is for first (dog sweaters are a pet
 * brand, baby lotion a baby brand), then the more specific kind of product.
 */
const order: Industry[] = [
  'pet',
  'baby',
  'beauty_tools',
  'haircare',
  'skincare',
  'beauty',
  'supplements',
  'wellness',
  'fitness',
  'jewelry',
  'accessories',
  'apparel',
  'kitchen',
  'food_drink',
  'home',
  'outdoor',
  'electronics'
]

const known: Record<Exclude<Industry, 'other'>, string[]> = {
  beauty_tools: [
    'hair dryer',
    'hairdryer',
    'straightener',
    'curler',
    'epilator',
    'beauty tools',
    'beauty tool',
    'hair tools',
    'hair tool',
    'styling tools',
    'beauty devices',
    'beauty device'
  ],
  haircare: ['hair', 'haircare', 'shampoo', 'conditioner', 'scalp'],
  skincare: [
    'body butter',
    'lip balm',
    'cream',
    'lotion',
    'balm',
    'soap',
    'skin',
    'skincare',
    'serum',
    'moisturizer',
    'moisturiser',
    'cleanser',
    'toner',
    'spf',
    'sunscreen',
    'retinol',
    'facial',
    'acne'
  ],
  beauty: [
    'beauty',
    'makeup',
    'make-up',
    'cosmetic',
    'cosmetics',
    'lipstick',
    'mascara',
    'fragrance',
    'perfume',
    'nail'
  ],
  supplements: [
    'supplement',
    'vitamin',
    'multivitamin',
    'protein',
    'nutrition',
    'capsule',
    'gummies',
    'collagen',
    'probiotic'
  ],
  wellness: [
    'wellness',
    'wellbeing',
    'well-being',
    'sleep',
    'mindful',
    'mindfulness',
    'meditation',
    'aromatherapy',
    'massage',
    'cbd',
    'self care',
    'self-care'
  ],
  fitness: [
    'fitness',
    'gym',
    'yoga',
    'pilates',
    'workout',
    'sport',
    'sports',
    'athletic',
    'dumbbell',
    'kettlebell'
  ],
  jewelry: [
    'jewelry',
    'jewellery',
    'jewel',
    'ring',
    'necklace',
    'earring',
    'bracelet',
    'pendant',
    'charm',
    'diamond'
  ],
  accessories: [
    'accessories',
    'accessory',
    'bag',
    'handbag',
    'backpack',
    'tote',
    'wallet',
    'belt',
    'watch',
    'watches',
    'eyewear',
    'sunglasses',
    'glasses',
    'hat',
    'cap',
    'scarf',
    'scarves',
    'umbrella'
  ],
  apparel: [
    'apparel',
    'fashion',
    'clothing',
    'clothes',
    'garment',
    'shirt',
    'overshirt',
    't-shirt',
    'tee',
    'dress',
    'dresses',
    'jeans',
    'denim',
    'jacket',
    'coat',
    'sweater',
    'hoodie',
    'trousers',
    'pants',
    'shorts',
    'skirt',
    'sock',
    'shoe',
    'sneaker',
    'boot',
    'footwear',
    'lingerie',
    'tailoring'
  ],
  baby: [
    'sleep sack',
    'baby',
    'babies',
    'kid',
    'kids',
    'child',
    'children',
    'toddler',
    'infant',
    'maternity',
    'nursery',
    'teether',
    'diaper',
    'nappy',
    'swaddle',
    'stroller',
    'pacifier'
  ],
  pet: [
    'pet',
    'dog',
    'cat',
    'puppy',
    'kitten',
    'petcare',
    'flea',
    'tick',
    'collar',
    'leash',
    'litter'
  ],
  kitchen: [
    'kitchen',
    'kitchenware',
    'cookware',
    'bakeware',
    'glassware',
    'dinnerware',
    'tableware',
    'drinkware',
    'cooking',
    'knife',
    'knives',
    'pan',
    'utensil'
  ],
  food_drink: [
    'hot dog',
    'ice cream',
    'food',
    'snack',
    'coffee',
    'tea',
    'matcha',
    'kombucha',
    'sweets',
    'drink',
    'beverage',
    'wine',
    'spirits',
    'beer',
    'chocolate',
    'candy',
    'sauce',
    'spice',
    'honey',
    'granola',
    'cookie',
    'bakery'
  ],
  home: [
    'home',
    'home fragrance',
    'homeware',
    'homewares',
    'furniture',
    'decor',
    'décor',
    'bedding',
    'candle',
    'interior',
    'interiors',
    'garden',
    'gardening',
    'chair',
    'table',
    'sofa',
    'rug',
    'lamp',
    'lighting',
    'towel',
    'vase'
  ],
  outdoor: [
    'outdoor',
    'outdoors',
    'camping',
    'hiking',
    'surf',
    'surfing',
    'bike',
    'cycling',
    'ski',
    'skiing',
    'climbing',
    'fishing'
  ],
  electronics: [
    'smart home',
    'ring light',
    'electronics',
    'electronic',
    'tech',
    'audio',
    'gadget',
    'phone',
    'headphones',
    'earbuds',
    'speaker',
    'charger',
    'laptop',
    'camera'
  ]
}

/** Words that end in "wear" are clothes (knitwear, menswear), not eyewear. */
const wearWord = /^[a-z]+wear$/

const singleWords = new Map<string, Industry[]>()
const twoWords = new Map<string, Industry[]>()
for (const industry of order)
  for (const phrase of known[industry as Exclude<Industry, 'other'>]) {
    const map = phrase.includes(' ') ? twoWords : singleWords
    map.set(phrase, [...(map.get(phrase) ?? []), industry])
  }

/** The word, and its singular when it ends in -s, -es or -ies. */
const forms = (word: string) => [
  word,
  ...(word.length > 3 && word.endsWith('s') ? [word.slice(0, -1)] : []),
  ...(word.length > 4 && word.endsWith('es') ? [word.slice(0, -2)] : []),
  ...(word.length > 4 && word.endsWith('ies') ? [`${word.slice(0, -3)}y`] : [])
]

export type IndustryScore = { industry: Industry; words: number }

/**
 * How many of each industry's words the text has, most first (ties in
 * `order`). A known two-word name counts twice and uses up both words, so
 * "ice cream" is never also "cream" and "hair tools" never also "hair".
 */
export function industryScores(text: string | null): IndustryScore[] {
  const lower = (text ?? '').trim().toLowerCase()
  if (!lower) return []
  if ((industries as readonly string[]).includes(lower))
    return lower === 'other' ? [] : [{ industry: lower as Industry, words: 1 }]
  const words = lower.split(/[^\p{L}\p{N}-]+/u).filter(Boolean)
  const score = new Map<Industry, number>()
  const add = (found: Industry[] | undefined, points: number) => {
    for (const industry of found ?? [])
      score.set(industry, (score.get(industry) ?? 0) + points)
  }
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!
    const pair =
      i + 1 < words.length
        ? forms(`${word} ${words[i + 1]}`).find((f) => twoWords.has(f))
        : undefined
    if (pair) {
      add(twoWords.get(pair), 2)
      i++
      continue
    }
    const joined = word.includes('-')
      ? forms(word.replace(/-+/g, ' ')).find((f) => twoWords.has(f))
      : undefined
    if (joined) {
      add(twoWords.get(joined), 2)
      continue
    }
    const single = forms(word).find((f) => singleWords.has(f))
    if (single) add(singleWords.get(single), 1)
    else if (wearWord.test(word) && word !== 'eyewear') add(['apparel'], 1)
    else if (word.includes('-'))
      // "dog-friendly" counts its "dog".
      for (const part of word.split('-')) {
        const found = forms(part).find((f) => singleWords.has(f))
        if (found) add(singleWords.get(found), 1)
      }
  }
  return order
    .filter((industry) => (score.get(industry) ?? 0) > 0)
    .sort((a, b) => score.get(b)! - score.get(a)!)
    .map((industry) => ({ industry, words: score.get(industry)! }))
}

export function industriesInWords(text: string | null): Industry[] {
  return industryScores(text).map((s) => s.industry)
}

export function industryInWords(text: string | null): Industry | null {
  if (!(text ?? '').trim()) return null
  return industriesInWords(text)[0] ?? 'other'
}
