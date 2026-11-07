import {
  type Block,
  type BlockContentInput,
  type BlockPhoto,
  type BlockType,
  blockTypes,
  parseBlock
} from './catalog'
import type { BlockBrand } from './brand'

/**
 * Sample content for every block type, for the block gallery (BLK-002)
 * and the tests. The brand is fictional and every picture is a plain
 * block of colour with no text in it (VISION rule 10). Screens that show
 * these must say they are samples.
 */
export const sampleBrand: BlockBrand = {
  name: 'Cedar Lane',
  site: 'https://cedar-lane.example',
  font: 'Playfair Display',
  ink: '#1f2a24',
  background: '#fbf8f2',
  accent: '#2f4a3a',
  dark: '#1f3328',
  radius: '8px'
}

// Solid-colour PNGs (1×1 square, 5×3 wide), stretched by the email's own
// width. PNG, not SVG, so sanitized previews keep them.
const squarePng = [
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mO4eXYHAAThAl+DZCD5AAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPYeWQjAARoAi8NmjqpAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mM4vnkxAARiAh5TkS4eAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mNYueMQAAQxAiQqiRAZAAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mO4dugEAATSAmGEawv4AAAAAElFTkSuQmCC',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mM4dHIJAASAAjAkaa3aAAAAAElFTkSuQmCC'
]
const widePng = [
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAEUlEQVR42mO4eXYHMmIgwAcAVnwjg0v9T3AAAAAASUVORK5CYII=',
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAEUlEQVR42mPYeWQjMmIgwAcAEYUgs6BkBNsAAAAASUVORK5CYII=',
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAEUlEQVR42mM4vnkxMmIgwAcA+zIftBQasboAAAAASUVORK5CYII=',
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAEUlEQVR42mNYueMQMmIgwAcAAB4gDjcUXC0AAAAASUVORK5CYII=',
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAEUlEQVR42mO4dugEMmIgwAcAWC8joSvEC3gAAAAASUVORK5CYII=',
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAEUlEQVR42mM4dHIJMmIgwAcAFDcgwrn2AMcAAAAASUVORK5CYII='
]

/** A plain, text-free picture: one soft block of colour. */
export function samplePhoto(
  index: number,
  alt: string,
  ratio: 'square' | 'wide' = 'square'
): BlockPhoto {
  const list = ratio === 'wide' ? widePng : squarePng
  return {
    image: `data:image/png;base64,${list[index % list.length]}`,
    alt
  }
}

const shop = 'https://cedar-lane.example'
const product = (i: number, title: string, price: string) => ({
  title,
  price,
  image: samplePhoto(i, title).image,
  alt: `${title} (sample photo)`,
  url: `${shop}/products/${i}`
})

const content: { [T in BlockType]: BlockContentInput<T> } = {
  announcement_bar: { text: 'Free shipping on orders over $60' },
  header_logo: {},
  hero_product: {
    eyebrow: 'Just in',
    headline: 'Meet the Washed Linen Throw',
    sub: 'Stone-washed for a soft hand from the first night.',
    ...samplePhoto(1, 'The linen throw (sample)'),
    url: `${shop}/products/1`,
    cta: 'Shop the throw',
    panel: '#eef2ec'
  },
  hero_image: {
    ...samplePhoto(0, 'A linen throw on a reading chair (sample)', 'wide'),
    headline: 'Slow mornings, made softer',
    sub: 'The new linen collection is here, washed for a lived-in feel.',
    url: `${shop}/linen`,
    cta: 'Shop the collection'
  },
  offer_banner: {
    headline: '15% off your first order',
    detail: 'On everything in the linen collection.',
    code: 'WELCOME15',
    expiry: 'Ends Sunday at midnight',
    url: `${shop}/linen`,
    cta: 'Use my code'
  },
  text: {
    heading: 'A note on our autumn colours',
    paras: [
      'This season we went back to the hills behind our studio for the palette: moss, oat and a deep clay.',
      'Each colour is dyed in small batches, so no two throws are quite the same.'
    ]
  },
  steps: {
    heading: 'How to care for linen',
    items: [
      ['Wash cool.', 'A gentle cycle keeps the fibres soft.'],
      ['Dry low.', 'Tumble low or line dry in the shade.'],
      ['Skip the iron.', 'The rumpled look is part of the charm.']
    ]
  },
  product_feature: {
    product: { ...product(1, 'Washed Linen Throw', '$89'), compareAt: '$110' },
    heading: 'Our most-loved throw',
    body: 'Light enough for summer, warm enough for autumn evenings.',
    cta: 'Shop the throw'
  },
  product_grid_2col: {
    heading: 'Best sellers',
    products: [
      product(2, 'Linen Pillow Cover', '$34'),
      product(3, 'Waffle Bath Towel', '$42'),
      product(4, 'Cotton Table Runner', '$29'),
      product(5, 'Stoneware Mug', '$18')
    ]
  },
  product_grid_3col: {
    heading: 'Just in',
    products: [
      product(0, 'Oak Serving Board', '$48'),
      product(1, 'Beeswax Candle', '$22'),
      product(2, 'Linen Napkins, set of 4', '$36')
    ]
  },
  category_tiles: {
    heading: 'Shop by room',
    tiles: [
      {
        ...samplePhoto(3, 'Bedroom (sample)'),
        label: 'Bedroom',
        url: `${shop}/bedroom`
      },
      {
        ...samplePhoto(4, 'Kitchen (sample)'),
        label: 'Kitchen',
        url: `${shop}/kitchen`
      },
      {
        ...samplePhoto(5, 'Bath (sample)'),
        label: 'Bath',
        url: `${shop}/bath`
      },
      {
        ...samplePhoto(0, 'Living room (sample)'),
        label: 'Living',
        url: `${shop}/living`
      }
    ]
  },
  image_text: {
    ...samplePhoto(2, 'Folded linen on a shelf (sample)'),
    heading: 'Made to soften with time',
    paras: [
      'Every piece is woven from European flax and washed twice, so it feels broken-in from the first night.'
    ],
    cta: 'Read our story',
    url: `${shop}/story`,
    imageSide: 'left'
  },
  founder_note: {
    photo: samplePhoto(1, 'The founder (sample)'),
    greeting: 'Hi there,',
    paras: [
      'I started Cedar Lane because I could not find bedding that felt as good in year three as in week one.',
      'Thank you for being here. Hit reply and tell me what you would like us to make next.'
    ],
    signoff: 'Maya',
    role: 'Founder, Cedar Lane'
  },
  review_strip: {
    heading: 'What customers say',
    reviews: [
      {
        quote: 'Softest throw I have owned. Gets better every wash.',
        author: 'Priya S.',
        rating: 5
      },
      { quote: 'Lovely colour, arrived quickly.', author: 'Tom R.', rating: 5 },
      {
        quote: 'Great quality, slightly smaller than expected.',
        author: 'Ana L.',
        rating: 4
      }
    ]
  },
  ugc_grid: {
    heading: 'In your homes',
    photos: [
      samplePhoto(0, 'Customer photo of a bedroom (sample)'),
      samplePhoto(2, 'Customer photo of a sofa (sample)'),
      samplePhoto(4, 'Customer photo of a table (sample)')
    ],
    caption: 'Tag us to be featured.',
    cta: 'See more',
    url: `${shop}/community`
  },
  before_after: {
    before: samplePhoto(3, 'A plain bed before (sample)'),
    after: samplePhoto(1, 'The same bed with the linen set (sample)'),
    beforeLabel: 'Before',
    afterLabel: 'After',
    caption: 'One bed, one linen set, ten minutes.'
  },
  faq: {
    heading: 'Questions',
    items: [
      [
        'How do I wash linen?',
        'Cold or warm, gentle cycle, then tumble low or line dry.'
      ],
      [
        'What if it does not suit me?',
        'Send it back within 30 days for a full refund.'
      ],
      [
        'How long does shipping take?',
        'Most orders arrive in 3 to 5 working days.'
      ]
    ]
  },
  cta: { label: 'Shop the collection', url: `${shop}/autumn` },
  signoff: { text: 'With love, the Cedar Lane team' },
  footer: {
    note: 'You get this email because you signed up at cedar-lane.example.'
  }
}

/** One valid sample block per type, in catalog order. */
export const sampleBlocks: Record<BlockType, Block> = Object.fromEntries(
  blockTypes.map((type) => {
    const parsed = parseBlock(type, content[type])
    if (!parsed.ok)
      throw new Error(`Sample ${type} is invalid: ${parsed.error}`)
    return [type, parsed.block]
  })
) as Record<BlockType, Block>
