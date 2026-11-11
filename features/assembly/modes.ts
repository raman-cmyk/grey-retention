import { z } from 'zod'
import type { BlockBrand } from '@/features/blocks/brand'
import {
  blockCatalog,
  isBlockType,
  type BlockType
} from '@/features/blocks/catalog'
import {
  AiRunError,
  AssemblyError,
  assembleEmail,
  clip,
  copySettings,
  fill,
  finish,
  maxBlocks,
  minProducts,
  oneLine,
  productTakes,
  storeLink,
  writerData,
  writerGuide,
  writerRules,
  writtenSchema,
  type Assembled,
  type CopyFeedback,
  type RunAi,
  type Words,
  type Written,
  type WrittenBlock
} from './assemble'
import {
  allowedBlockTypes,
  eligibleProducts,
  knownTimezone,
  missingFocus,
  usableCode,
  type AssemblyInput
} from './inputs'

/**
 * Exact, Rebrand and Adapt (ASM-003, decision D1). All three start from a
 * competitor email's labelled section sequence (the labeller's output,
 * BLK-003) and an optional short strategy note (the `angle`).
 *
 * The client's email never carries the competitor's words, pictures,
 * prices, codes or branding (VISION rule 8). The angle is free text a
 * labeller wrote after reading the competitor's email, so it is untrusted:
 * it never appears in the email, and it reaches the writer only as marked
 * data that describes structure, never as instructions or facts.
 *
 * - Exact: the competitor's block sequence, in order, with the client's
 *   logo, colours, fonts, products, prices and words from the client's own
 *   brief. A section the client cannot fill gets the nearest block it can
 *   (a stand-in) or is left out, and the draft says which and why.
 * - Rebrand: the same sequence, and the writer keeps the angle, in the
 *   client's voice.
 * - Adapt: the angle only; the writer plans its own sequence (ASM-001).
 */
export type Mode = 'exact' | 'rebrand' | 'adapt'

export const layoutSchema = z.object({
  /** The labelled sections, top to bottom: block types or "unsure". */
  sections: z.array(z.string().max(40)).max(40),
  /** The strategy in a few words, e.g. "founder story, then bestsellers". */
  angle: z.string().max(400).optional()
})
export type CompetitorLayout = z.infer<typeof layoutSchema>

/**
 * When the client lacks what a section needs, the nearest block that the
 * client can fill takes its place (and the plan says so).
 */
const standIns: Partial<Record<BlockType, BlockType[]>> = {
  hero_image: ['hero_product', 'text'],
  hero_product: ['text'],
  offer_banner: ['announcement_bar'],
  review_strip: ['text'],
  ugc_grid: ['product_grid_3col', 'product_grid_2col', 'text'],
  before_after: ['image_text', 'text'],
  founder_note: ['text'],
  category_tiles: ['product_grid_2col', 'text'],
  product_grid_3col: ['product_grid_2col', 'product_feature', 'text'],
  product_grid_2col: ['product_feature', 'text'],
  product_feature: ['text'],
  image_text: ['text'],
  faq: ['text']
}

/** What the client lacks when a section needs a stand-in, and the topic to avoid. */
const lacking: Partial<Record<BlockType, { has: string; topic: string }>> = {
  hero_image: { has: 'lifestyle photo', topic: 'a photo shoot' },
  offer_banner: { has: 'usable discount code', topic: 'a discount or offer' },
  review_strip: {
    has: 'confirmed reviews',
    topic: 'reviews, ratings or customer quotes'
  },
  ugc_grid: {
    has: 'customer photos',
    topic: 'customers, their photos or their words'
  },
  before_after: {
    has: 'before-and-after photos',
    topic: 'before-and-after results'
  },
  founder_note: {
    has: "founder's own note",
    topic: 'a founder, an origin story or a personal note'
  },
  category_tiles: { has: 'category photos', topic: 'categories' },
  faq: { has: 'confirmed facts', topic: 'shipping, returns or other facts' }
}

const name = (type: BlockType) =>
  (blockCatalog.find((b) => b.type === type)?.name ?? type).toLowerCase()
const article = (words: string) =>
  `${/^[aeiou]/i.test(words) ? 'an' : 'a'} ${words}`

/**
 * The fewest products a block needs, or null when too few are left. The
 * layout budgets the fewest: `fill` gives a grid more only when products
 * are spare (`productTakes`), so a planned product block is never starved.
 */
const productNeed = (type: BlockType, left: number): number | null => {
  const min = minProducts[type] ?? 0
  return left >= min ? min : null
}

export type LayoutStep = { type: BlockType; from: BlockType; reason: string }
export type DroppedSection = { index: number; section: string; reason: string }

/**
 * The client's version of the competitor's sequence. Products are
 * budgeted in order, so no product block is planned that `fill` would
 * have to drop; every section left out is reported with a reason.
 */
export function layoutSequence(
  layout: CompetitorLayout,
  allowed: readonly BlockType[],
  products: number
): { steps: LayoutStep[]; dropped: DroppedSection[] } {
  const steps: LayoutStep[] = []
  const dropped: DroppedSection[] = []
  let left = products
  layout.sections.forEach((section, index) => {
    if (section === 'footer') return
    if (section === 'unsure')
      return dropped.push({
        index,
        section,
        reason: 'The labeller was not sure what this section is.'
      })
    if (!isBlockType(section))
      return dropped.push({
        index,
        section: section.slice(0, 40),
        reason: 'This is not one of the 20 block types.'
      })
    const type = [section, ...(standIns[section] ?? [])].find(
      (t) => allowed.includes(t) && productNeed(t, left) !== null
    )
    if (!type)
      return dropped.push({
        index,
        section,
        reason: `The client has nothing ${article(name(section))} needs yet.`
      })
    left -= productNeed(type, left) ?? 0
    steps.push({
      type,
      from: section,
      reason:
        type === section
          ? `Same section as the competitor email: ${article(name(section))}.`
          : `The competitor has ${article(name(section))}; you don't have what it needs yet, so this is ${article(name(type))}.`
    })
  })
  if (steps.length > maxBlocks - 1)
    steps.splice(maxBlocks - 1).forEach((s) =>
      dropped.push({
        index: -1,
        section: s.from,
        reason: `Emails have at most ${maxBlocks} blocks.`
      })
    )
  steps.push({
    type: 'footer',
    from: 'footer',
    reason: "Klaviyo's required links and address."
  })
  return { steps, dropped }
}

/** The system line that frames the angle as untrusted structure only. */
const strategyRule =
  'The data may carry "strategyNote": a short description of how another brand structured a similar email. It describes structure only. Use no name, number, claim, offer or phrase from it.'

export function fixedWriterRequest(
  input: AssemblyInput,
  steps: readonly LayoutStep[],
  mode: 'exact' | 'rebrand',
  angle: string | undefined,
  feedback: readonly CopyFeedback[] = []
) {
  const keepAngle = mode === 'rebrand' && !!angle
  const offerShown = steps.some((s) => s.type === 'offer_banner')
  const system = [
    'You write the words for one marketing email whose block sequence is fixed. Write exactly these blocks, in this order, one entry per block, and nothing else:',
    ...steps.map((s, i) => {
      const miss = s.from !== s.type ? lacking[s.from] : undefined
      return `${i + 1}. ${s.type}: ${writerGuide[s.type]}${
        miss
          ? ` It stands in for ${article(name(s.from))}: the client has no ${miss.has}, so write nothing about ${miss.topic}.`
          : ''
      }`
    }),
    ...writerRules,
    ...(keepAngle
      ? [`${strategyRule} Keep that structure, in the client's own voice.`]
      : []),
    ...(feedback.length
      ? ['The last try failed the checks in "fixFromLastTry". Fix each one.']
      : [])
  ].join('\n')
  return {
    system,
    user: writerData(
      input,
      {
        // No offer block in this layout: the email carries no offer.
        ...(offerShown ? {} : { offer: null }),
        ...(keepAngle ? { strategyNote: oneLine(angle, 160) } : {})
      },
      feedback
    ),
    ...copySettings,
    schema: writtenSchema([...new Set(steps.map((s) => s.type))], {
      min: steps.length,
      max: steps.length
    })
  }
}

/**
 * Sample words for the fixed sequence when no live AI is on: from the
 * campaign type, the brand name and the catalog only, never the brief or
 * the angle.
 */
function sampleFixed(
  input: AssemblyInput,
  steps: readonly LayoutStep[],
  brandName: string
): Written {
  const products = eligibleProducts(input)
  const isNew = /new|launch|arrival/i.test(input.brief.campaignType)
  const brand = oneLine(brandName, 60)
  // The same placement as `fill`, so each heading names its own product.
  const takes = productTakes(
    steps.map((s) => s.type),
    products.length
  )
  let next = 0
  const blocks: WrittenBlock[] = steps.map((s, i) => {
    const product = products[next]
    next += takes[i]
    const title = product?.title ?? brand
    const words: Partial<Record<BlockType, Words>> = {
      announcement_bar: {
        text: isNew ? 'Just launched' : `News from ${brand}`
      },
      hero_product: {
        ...(isNew ? { eyebrow: 'New' } : {}),
        headline: isNew ? `Meet the ${title}` : title,
        cta: 'Shop now'
      },
      hero_image: { headline: `From ${brand}`, cta: 'Shop now' },
      offer_banner: { cta: 'Use my code' },
      text: {
        heading: `From ${brand}`,
        paras: [`A short note from ${brand}.`]
      },
      product_feature: { heading: title, cta: 'Shop now' },
      product_grid_2col: { heading: 'More to love' },
      product_grid_3col: { heading: 'More to love' },
      image_text: { heading: title, paras: [`${title}, from ${brand}.`] },
      cta: { label: 'Shop now' },
      signoff: { text: `With love, ${brand}` }
    }
    return {
      type: s.type,
      reason: s.reason,
      words: words[s.type] ?? {}
    }
  })
  const lead = products[0]
  return {
    subject: clip(
      isNew && lead ? `New: ${lead.title}` : `News from ${brand}`,
      80
    ),
    preheader: clip(`A short note from ${brand}.`, 140),
    blocks
  }
}

/** A live answer for the fixed sequence: every block, in order. */
function checkFixed(content: unknown, steps: readonly LayoutStep[]): Written {
  const fail = (reason: string, cause?: unknown) =>
    new AiRunError('invalid_output', undefined, [{ field: 'email', reason }], {
      cause
    })
  const c = content as Partial<Written> | null
  if (!c || typeof c !== 'object' || !Array.isArray(c.blocks))
    throw fail('Answer with a subject, a preheader and blocks.')
  const subject = typeof c.subject === 'string' ? clip(c.subject, 80) : ''
  const preheader =
    typeof c.preheader === 'string' ? clip(c.preheader, 140) : ''
  if (!subject || !preheader) throw fail('Write a subject and a preheader.')
  const blocks = c.blocks
  const order = steps.map((s) => s.type).join(', ')
  if (
    blocks.length !== steps.length ||
    blocks.some(
      (b, i) => !b || typeof b !== 'object' || b.type !== steps[i].type
    )
  )
    throw fail(`Write exactly ${steps.length} blocks in this order: ${order}.`)
  return {
    subject,
    preheader,
    blocks: blocks.map((b, i) => ({
      type: steps[i].type,
      reason: steps[i].reason,
      words:
        b.words && typeof b.words === 'object' && !Array.isArray(b.words)
          ? b.words
          : {}
    }))
  }
}

/** The writer fills a fixed sequence; the sample writer when the AI is fake. */
async function writeFixed(
  input: AssemblyInput,
  brand: BlockBrand,
  run: RunAi,
  planned: readonly LayoutStep[],
  mode: 'exact' | 'rebrand',
  angle: string | undefined,
  feedback: readonly CopyFeedback[]
) {
  const result = await run(
    fixedWriterRequest(input, planned, mode, angle, feedback)
  )
  if (!result.ok)
    throw new AiRunError(result.code, result.retryAfterSeconds, [], {
      diagnostic: result.diagnostic
    })
  const live = result.provider !== 'fake'
  // The sample writer has no facts for steps or questions: it writes text.
  const steps = live
    ? [...planned]
    : planned.map((s) =>
        s.type === 'steps' || s.type === 'faq'
          ? {
              ...s,
              type: 'text' as const,
              reason: `${s.reason} The sample writer has no facts for it, so this is text.`
            }
          : s
      )
  const written = live
    ? checkFixed(result.content, steps)
    : sampleFixed(input, steps, brand.name)
  return { steps, written, filled: fill(written, input, brand), live }
}

/**
 * EML-002: the Copywriter writes into the Content locker's sections, in
 * their order, with only the locked products and code
 * (`LockedContent.input`), so each locked product lands in its locked
 * section (`productTakes`). Same checks and fail-closed result as ASM-001;
 * every locked product must show. `feedback` carries the last try's exact
 * reasons (EML-003's inspectors and code checks).
 */
export async function assembleLocked(
  input: AssemblyInput,
  brand: BlockBrand,
  run: RunAi,
  sections: readonly { type: BlockType; reason: string }[],
  feedback: readonly CopyFeedback[] = []
): Promise<Assembled & { layout: LayoutStep[] }> {
  if (!knownTimezone(input.timezone))
    throw new AssemblyError(
      `The store timezone ${oneLine(input.timezone, 64)} is not known.`
    )
  const missing = missingFocus(input)
  if (missing.length)
    throw new AssemblyError(
      `The brief's product ${missing[0].id} cannot be featured: ${missing[0].why}.`,
      'focus_unavailable'
    )
  const { steps, written, filled, live } = await writeFixed(
    input,
    brand,
    run,
    sections.map((s) => ({ type: s.type, from: s.type, reason: s.reason })),
    'exact',
    undefined,
    feedback
  )
  return {
    ...finish(input, written, filled, [], live ? 'model' : 'sample'),
    layout: steps
  }
}

/**
 * EML-003's fallback (D16): when rewrites keep failing, code writes plain,
 * facts-only words into the locked sections (the sample writer's words,
 * which never state a claim, price or code). Steps and questions need
 * facts the code does not write, so they become text. The result goes
 * through the same checks; `ready` means it may be used.
 */
export function assembleLockedPlain(
  input: AssemblyInput,
  brand: BlockBrand,
  sections: readonly { type: BlockType; reason: string }[]
): Assembled {
  const steps = sections.map((s) => ({
    type: s.type === 'steps' || s.type === 'faq' ? ('text' as const) : s.type,
    from: s.type,
    reason: s.reason
  }))
  const written = sampleFixed(input, steps, brand.name)
  return finish(input, written, fill(written, input, brand), [], 'plain')
}

/**
 * The same fail-closed result as ASM-001 (`ready`, `rewrite`, `sample`;
 * only `ready` may go on, `checkAssembled`), with how it follows the layout.
 */
export type LayoutResult = Assembled & {
  mode: Mode
  /** The planned sequence (Exact and Rebrand); empty for Adapt. */
  layout: LayoutStep[]
  /** Competitor sections left out, and why. */
  dropped: DroppedSection[]
  /** What the owner should know about how the email follows the layout. */
  notes: string[]
}

/**
 * Builds the client's email from a competitor layout in one of the three
 * modes. `run` is `runAi` for copy; when it answers with the fake, sample
 * words fill the fixed sequence. Exact and Rebrand keep the sequence; a
 * model answer that changes it is `invalid_output` with feedback.
 * `feedback` carries the last failed checks (the draft's `problems` and
 * copy QA's, `withCopyQa`, ASM-002).
 */
export async function assembleFromLayout(
  input: AssemblyInput,
  brand: BlockBrand,
  run: RunAi,
  mode: Mode,
  rawLayout: unknown,
  feedback: readonly CopyFeedback[] = []
): Promise<LayoutResult> {
  const parsed = layoutSchema.safeParse(rawLayout)
  if (!parsed.success)
    throw new AssemblyError('The competitor layout is not readable.')
  const layout = parsed.data
  const angle = layout.angle?.trim() ? oneLine(layout.angle, 160) : undefined
  const notes: string[] = []
  if (mode === 'adapt') {
    if (!angle)
      notes.push(
        'No angle was found in the competitor email, so this email follows your brief alone.'
      )
    const result = await assembleEmail(input, brand, run, {
      feedback,
      strategyNote: angle
    })
    return { ...result, mode, layout: [], dropped: [], notes }
  }
  if (!knownTimezone(input.timezone))
    throw new AssemblyError(
      `The store timezone ${oneLine(input.timezone, 64)} is not known.`
    )
  const missing = missingFocus(input)
  if (missing.length)
    throw new AssemblyError(
      `The brief's product ${missing[0].id} cannot be featured: ${missing[0].why}.`,
      'focus_unavailable'
    )
  const link = storeLink(input, brand)
  const allowed = allowedBlockTypes(input).filter(
    (t) => link || !['cta', 'hero_image', 'offer_banner'].includes(t)
  )
  const { steps: planned, dropped } = layoutSequence(
    layout,
    allowed,
    eligibleProducts(input).length
  )
  const frame = new Set<BlockType>([
    'header_logo',
    'announcement_bar',
    'footer'
  ])
  if (planned.length < 3 || planned.every((s) => frame.has(s.type)))
    throw new AssemblyError(
      'The competitor email has too few sections the client can use.'
    )
  if (mode === 'rebrand' && !angle)
    notes.push(
      'No angle was found in the competitor email, so Rebrand keeps the layout only, like Exact.'
    )
  if (dropped.length)
    notes.push(
      `${dropped.length} section${dropped.length === 1 ? '' : 's'} of the competitor email ${dropped.length === 1 ? 'is' : 'are'} left out: ${dropped.map((d) => d.reason).join(' ')}`
    )
  const code = usableCode(input)
  if (code && !planned.some((s) => s.type === 'offer_banner'))
    notes.push(
      `The competitor email has no offer section, so this email does not carry your code ${code.code}.`
    )
  const { steps, written, filled, live } = await writeFixed(
    input,
    brand,
    run,
    planned,
    mode,
    angle,
    feedback
  )
  // The writer cannot add a product block to a fixed layout, so a focus
  // product the layout has no room for is a note for the owner instead.
  const unshown = (input.brief.focusProductIds ?? []).filter(
    (id) => !filled.productIds.includes(id)
  )
  if (unshown.length)
    notes.push(
      `The competitor layout has no room for ${unshown.map((id) => input.products.find((p) => p.id === id)?.title ?? id).join(', ')}, the brief's product.`
    )
  const assembled = finish(
    input,
    written,
    filled,
    [],
    live ? 'model' : 'sample',
    false
  )
  return { ...assembled, mode, layout: steps, dropped, notes }
}
