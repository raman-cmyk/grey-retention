import {
  type Block,
  type BlockContentInput,
  type BlockImage,
  type BlockType,
  blockTypes,
  parseBlock
} from './catalog'
import type { BlockBrand } from './brand'

/**
 * Sample content for every block type, for the block gallery (BLK-002)
 * and the tests. The brand is fictional and every picture is a plain
 * shape with no text in it (VISION rule 10). Screens that show these must
 * say they are samples.
 */
export const sampleBrand: BlockBrand = {
  name: 'Cedar Lane',
  colors: { primary: '#2f4a3a', accent: '#c9a96e', background: '#fbf8f2' },
  font: 'Playfair Display'
}

const shades = [
  '#d9cdb8',
  '#b9c4b1',
  '#c7b3a3',
  '#a9b8c2',
  '#d6c2c8',
  '#c2c9a4'
]

/** A plain, text-free picture: a soft block of colour with one shape. */
export function samplePhoto(
  index: number,
  alt: string,
  ratio: 'square' | 'wide' = 'square'
): BlockImage {
  const w = 600
  const h = ratio === 'wide' ? 360 : 600
  const fill = shades[index % shades.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/><circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 4}" fill="#ffffff" fill-opacity="0.45"/></svg>`
  return { url: `data:image/svg+xml;base64,${btoa(svg)}`, alt }
}

const shop = 'https://cedar-lane.example'
const product = (i: number, title: string, price: string) => ({
  title,
  price,
  image: samplePhoto(i, `${title} (sample photo)`),
  url: `${shop}/products/${i}`
})

const content: { [T in BlockType]: BlockContentInput<T> } = {
  header: {
    links: [
      { label: 'New', url: `${shop}/new` },
      { label: 'Best sellers', url: `${shop}/best` },
      { label: 'Gifts', url: `${shop}/gifts` }
    ]
  },
  hero: {
    image: samplePhoto(0, 'A linen throw on a reading chair (sample)', 'wide'),
    headline: 'Slow mornings, made softer',
    subline: 'The new linen collection is here, washed for a lived-in feel.',
    cta: { label: 'Shop the collection', url: `${shop}/linen` }
  },
  offer_banner: {
    headline: '15% off your first order',
    detail: 'On everything in the linen collection.',
    code: 'WELCOME15',
    expiry: 'Ends Sunday at midnight',
    cta: { label: 'Use my code', url: `${shop}/linen` }
  },
  free_shipping_bar: { text: 'Free shipping on orders over $60' },
  product_feature: {
    product: {
      ...product(1, 'Washed Linen Throw', '$89'),
      compareAt: '$110'
    },
    headline: 'Our most-loved throw',
    body: 'Stone-washed for a soft hand from day one. Light enough for summer, warm enough for autumn evenings.',
    cta: { label: 'Shop the throw', url: `${shop}/products/1` }
  },
  product_grid_2: {
    headline: 'Best sellers',
    products: [
      product(2, 'Linen Pillow Cover', '$34'),
      product(3, 'Waffle Bath Towel', '$42'),
      product(4, 'Cotton Table Runner', '$29'),
      product(5, 'Stoneware Mug', '$18')
    ]
  },
  product_grid_3: {
    headline: 'Just in',
    products: [
      product(0, 'Oak Serving Board', '$48'),
      product(1, 'Beeswax Candle', '$22'),
      product(2, 'Linen Napkins, set of 4', '$36')
    ]
  },
  category_tiles: {
    headline: 'Shop by room',
    tiles: [
      {
        image: samplePhoto(3, 'Bedroom (sample)'),
        label: 'Bedroom',
        url: `${shop}/bedroom`
      },
      {
        image: samplePhoto(4, 'Kitchen (sample)'),
        label: 'Kitchen',
        url: `${shop}/kitchen`
      },
      {
        image: samplePhoto(5, 'Bath (sample)'),
        label: 'Bath',
        url: `${shop}/bath`
      },
      {
        image: samplePhoto(0, 'Living room (sample)'),
        label: 'Living',
        url: `${shop}/living`
      }
    ]
  },
  image_text: {
    image: samplePhoto(2, 'Folded linen on a shelf (sample)'),
    headline: 'Made to soften with time',
    body: 'Every piece is woven from European flax and washed twice, so it feels broken-in from the first night.',
    cta: { label: 'Read our story', url: `${shop}/story` },
    imageSide: 'left'
  },
  text: {
    headline: 'A note on our autumn colours',
    body: 'This season we went back to the hills behind our studio for the palette: moss, oat and a deep clay.\n\nEach colour is dyed in small batches, so no two throws are quite the same.'
  },
  founder_note: {
    photo: samplePhoto(1, 'The founder (sample)'),
    greeting: 'Hi there,',
    body: 'I started Cedar Lane because I could not find bedding that felt as good in year three as in week one.\n\nThank you for being here. Hit reply and tell me what you would like us to make next.',
    signoff: 'Maya',
    role: 'Founder, Cedar Lane'
  },
  review_strip: {
    headline: 'What customers say',
    reviews: [
      {
        quote: 'Softest throw I have owned. Gets better every wash.',
        author: 'Priya S.',
        rating: 5
      },
      {
        quote: 'Lovely colour, arrived in two days.',
        author: 'Tom R.',
        rating: 5
      },
      {
        quote: 'Great quality, slightly smaller than expected.',
        author: 'Ana L.',
        rating: 4
      }
    ]
  },
  ugc_grid: {
    headline: 'In your homes',
    photos: [
      samplePhoto(0, 'Customer photo of a bedroom (sample)'),
      samplePhoto(2, 'Customer photo of a sofa (sample)'),
      samplePhoto(4, 'Customer photo of a table (sample)')
    ],
    caption: 'Tag us to be featured.',
    cta: { label: 'See more', url: `${shop}/community` }
  },
  before_after: {
    before: samplePhoto(3, 'A plain bed before (sample)'),
    after: samplePhoto(1, 'The same bed with the linen set (sample)'),
    beforeLabel: 'Before',
    afterLabel: 'After',
    caption: 'One bed, one linen set, ten minutes.'
  },
  benefits: {
    headline: 'Why Cedar Lane',
    items: [
      { title: 'Washed twice', body: 'Soft from the first night.' },
      { title: '100-night trial', body: 'Sleep on it before you decide.' },
      { title: 'Made to last', body: 'Flax that gets better with time.' }
    ]
  },
  how_it_works: {
    headline: 'How the trial works',
    steps: [
      { title: 'Order', body: 'Pick your set and colour.' },
      { title: 'Sleep on it', body: 'Use it for up to 100 nights.' },
      { title: 'Decide', body: 'Keep it or send it back for free.' }
    ]
  },
  comparison: {
    headline: 'Cedar Lane against the usual',
    usLabel: 'Cedar Lane',
    themLabel: 'Typical linen',
    rows: [
      { feature: 'Pre-washed', us: 'Twice', them: 'No' },
      { feature: 'Trial', us: '100 nights', them: '30 days' },
      { feature: 'Flax origin', us: 'Europe', them: 'Mixed' }
    ]
  },
  faq: {
    headline: 'Questions',
    items: [
      {
        question: 'How do I wash linen?',
        answer: 'Cold or warm, gentle cycle, then tumble low or line dry.'
      },
      {
        question: 'What if it does not suit me?',
        answer: 'Send it back within 100 nights for a full refund.'
      },
      {
        question: 'How long does shipping take?',
        answer: 'Most orders arrive in 2 to 4 working days.'
      }
    ]
  },
  cta: {
    headline: 'Ready for softer evenings?',
    body: 'The autumn colours are in stock now.',
    cta: { label: 'Shop now', url: `${shop}/autumn` }
  },
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
