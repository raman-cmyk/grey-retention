import type { WordPools, WordRules } from '../words'
import type { Cropper, SwapBrand, SwapPicture, SwapProduct } from '../swap'
import { picture } from './pictures'

/**
 * DES-ENGINE-002 gate: a **synthetic test brand** the 20 library-shaped
 * golden emails are copied for. Made up for the test (D8): a tea shop
 * with its own palette, fonts, logo, icons, photos, catalog, offer and
 * words, none of them taken from the golden emails (their made-up store
 * is "Sample Store"; its words come from `kit.ts says`). Every picture is
 * a plain colour made in code (`pictures.ts`).
 */

const colourOf = new Map<string, string>()
const pic = (
  width: number,
  height: number,
  color: string,
  alt: string
): SwapPicture => {
  const src = picture(width, height, color)
  colourOf.set(src, color)
  return { src, width, height, alt }
}

export const testBrand: SwapBrand = {
  name: 'Fernhill Tea',
  site: 'https://fernhill.example/',
  ink: '#1f2a24',
  background: '#f4efe6',
  accent: '#2f6b4f',
  dark: '#18302a',
  headingFont: 'Fraunces',
  bodyFont: 'Inter',
  logo: pic(180, 60, '#2f6b4f', 'Fernhill Tea'),
  logoOnDark: pic(180, 60, '#f4efe6', 'Fernhill Tea'),
  icons: [
    pic(64, 64, '#2f6b4f', 'Fernhill on Instagram'),
    pic(64, 64, '#3d7d60', 'Fernhill on Pinterest'),
    pic(64, 64, '#4b8f71', 'Fernhill on YouTube'),
    pic(64, 64, '#5aa182', 'Fernhill on TikTok')
  ].map((p, i) => ({ ...p, href: `https://fernhill.example/follow/${i + 1}` })),
  photos: [
    pic(1200, 600, '#8fa98f', 'Tea garden at dawn'),
    pic(1200, 800, '#a7b89a', 'Teapot on a wooden bench'),
    pic(960, 1200, '#b9c4a5', 'Leaves drying in baskets'),
    pic(1200, 1200, '#c6cfb3', 'A cup of green tea')
  ],
  radius: 6,
  address: '12 Hill Lane, Greenfield'
}

const product = (
  id: string,
  title: string,
  price: string,
  color: string,
  compareAt: string | null = null
): SwapProduct => ({
  id,
  title,
  price,
  compareAt,
  url: `https://fernhill.example/products/${id}`,
  photo: pic(800, 800, color, title)
})

export const testProducts: SwapProduct[] = [
  product('green', 'Hill green', '$14.00', '#6f8f5f', '$18.00'),
  product('black', 'Smoky black', '$16.00', '#4a3b2f'),
  product('oolong', 'Amber oolong', '$19.00', '#a8743c', '$24.00'),
  product('white', 'Silver needle', '$24.00', '#d8d2c0'),
  product('mint', 'Fresh mint', '$12.00', '#7fb59a'),
  product('chai', 'Spiced chai', '$15.00', '#8a5a3c'),
  product('rooibos', 'Red rooibos', '$13.00', '#a0442c'),
  product('matcha', 'Ceremony matcha', '$29.00', '#5d8a3a')
]

export const testRules: WordRules = {
  offer: { code: 'FERN15', percent: 15 },
  maxDiscountPercent: 20
}

/** The brand's own words, as its writers would hand them over. */
export const testWords: WordPools = {
  headline: [
    'Tea picked this spring',
    'Fresh leaves are here',
    'Steep, sip, repeat',
    'Our first flush of the year has landed',
    '15% off loose leaf',
    'Brew a better cup',
    'From our hills to your kettle',
    'Questions about brewing'
  ],
  subheadline: [
    'Grown on our own slopes',
    'How we pick each leaf',
    'Brewing guide',
    'Picked by hand'
  ],
  eyebrow: ['FIRST FLUSH', 'NEW HARVEST', 'TEA NOTES'],
  body: [
    'Each tin holds leaves we picked on the hill above our barn.',
    'We dry them slowly over two days so the flavour stays round.',
    'Use water just off the boil and give green tea two minutes.',
    'Black tea likes it hot and can steep for four minutes or more.',
    'Every order ships in a tin you can refill at any of our stalls.',
    'Tell us how you brew and we will suggest a blend to try next.',
    'Our pickers walk the rows at first light when the leaves are cool.',
    'A spoon of leaves makes one pot; a second steep is often sweeter.',
    'Loose leaf keeps for a year in a dark, dry cupboard.',
    'Store tins away from the stove and from strong spices.'
  ],
  button: [
    'Shop',
    'Buy',
    'Add',
    'Shop tea',
    'Brew guide',
    'Shop the range',
    'Find your blend',
    'Take 15% off'
  ],
  caption: [
    'Picked in April',
    'Ships in a refillable tin',
    'Steep for two minutes',
    'Ask us anything about tea'
  ]
}

/**
 * The fake image worker for plain-colour test photos: a plain colour cut
 * to any shape is the same colour, so the cut is exact. Only for the
 * test's own pictures; a real photo needs a real cropper.
 */
export const testCropper: Cropper = (photo, width, height) => {
  const color = colourOf.get(photo.src)
  if (!color) return null
  return { ...pic(width, height, color, photo.alt), width, height }
}

/** Everything the test brand's content says. */
export const testVocabulary: string[] = [
  testBrand.name,
  testBrand.address ?? '',
  ...(testBrand.icons ?? []).map((i) => i.alt),
  ...(testBrand.photos ?? []).map((p) => p.alt),
  ...testProducts.flatMap((p) => [p.title, p.price, p.compareAt ?? '']),
  ...Object.values(testWords).flat(),
  testRules.offer?.code ?? ''
]

/** The golden emails' own made-up store, as its emails name it. */
export const goldenStoreNames = ['Sample Store', 'example.com']
