import { parseFragment, type DefaultTreeAdapterTypes as T } from 'parse5'
import { htmlToText } from '@/features/email-generation/html'
import type { AiProvider } from '@/lib/providers/contracts'
import { AiProviderError } from '@/lib/providers/contracts'
import {
  blockCatalog,
  blockTypes,
  isBlockType,
  type BlockType
} from './catalog'

/**
 * The section labeller (VISION Step 1, BLK-003). Its only job: given one
 * section of a competitor email, pick which of the 20 block types it is,
 * or say "unsure". It never finds section boundaries (the inbox does,
 * INB-003) and never invents a type: the answer is checked against the
 * fixed list. With a live AI provider (GEM-001: Gemini Flash-Lite) the
 * model decides; with the AI port's fake an honest rule-based sample
 * labeller answers and says so. Pictures of sections are sent once the AI
 * port can carry them (GEM-001); until then the model reads the text and
 * the counts.
 */
export type SectionInput = {
  /** One section's HTML (a table row, an image slice…). */
  html: string
}

export type SectionLabel = {
  type: BlockType | 'unsure'
  /** 0 to 1. Below `confidentFrom` the type is reported as unsure. */
  confidence: number
  source: 'model' | 'sample'
}

/** Labels below this go to the ops queue as "unsure" (VISION section 10). */
export const confidentFrom = 0.6
const maxText = 2_000

/** What the section contains, counted from the parsed HTML. */
export type SectionFacts = {
  text: string
  words: number
  images: number
  links: number
  prices: number
  percents: number
  stars: number
  questions: number
  /** Most cells side by side in one table row. */
  columns: number
  /** Table rows with at least two cells. */
  rows: number
  /** Links sitting in a coloured cell: buttons. */
  buttons: number
  /** Text comes before the first picture (an eyebrow and headline). */
  eyebrow: boolean
}

const isElement = (n: T.ChildNode | T.ParentNode): n is T.Element =>
  'tagName' in n

export function sectionFacts(html: string): SectionFacts {
  const root = parseFragment(html.slice(0, 200_000))
  let images = 0
  let links = 0
  let columns = 0
  let rows = 0
  let buttons = 0
  const stack: (T.ParentNode | T.ChildNode)[] = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (isElement(node)) {
      if (node.tagName === 'img') images++
      if (
        node.tagName === 'a' &&
        node.attrs.some((a) => a.name === 'href' && a.value.trim())
      ) {
        links++
        const cell = node.parentNode
        if (
          cell &&
          isElement(cell) &&
          cell.tagName === 'td' &&
          cell.attrs.some(
            (a) =>
              a.name === 'bgcolor' ||
              (a.name === 'style' && /background/i.test(a.value))
          )
        )
          buttons++
      }
      if (node.tagName === 'tr') {
        const cells = node.childNodes.filter(
          (c) => isElement(c) && (c.tagName === 'td' || c.tagName === 'th')
        ).length
        columns = Math.max(columns, cells)
        if (cells >= 2) rows++
      }
    }
    if ('childNodes' in node) stack.push(...node.childNodes)
    if (isElement(node) && node.tagName === 'template')
      stack.push((node as T.Template).content)
  }
  const text = htmlToText(html).slice(0, maxText)
  const firstImage = html.search(/<img\b/i)
  const eyebrow =
    firstImage > 0 &&
    htmlToText(html.slice(0, firstImage)).trim().split(/\s+/).length >= 2
  return {
    text,
    words: text.split(/\s+/).filter(Boolean).length,
    images,
    links,
    prices: (
      text.match(/(?:[$€£¥₹]|\b(?:USD|EUR|GBP|AUD|CAD|NPR|Rs\.?))\s?\d/g) ?? []
    ).length,
    percents: (text.match(/\d\s?%/g) ?? []).length,
    stars: (text.match(/[★☆⭐]/g) ?? []).length,
    questions: (text.match(/\?/g) ?? []).length,
    columns,
    rows,
    buttons,
    eyebrow
  }
}

const has = (text: string, pattern: RegExp) => pattern.test(text)

/**
 * The sample labeller: plain rules over the section's facts, used when no
 * live AI is switched on. It is a baseline, not the gate's model.
 */
export function sampleLabel(facts: SectionFacts): {
  type: BlockType | 'unsure'
  confidence: number
} {
  const t = facts.text.toLowerCase()
  const f = facts
  const sure = (type: BlockType, confidence = 0.8) => ({ type, confidence })
  if (has(t, /unsubscribe|manage (your )?preferences|view in (your )?browser/))
    return sure('footer', 0.9)
  if (f.stars >= 3 || has(t, /\breviews?\b|verified (buyer|purchase)/))
    return sure('review_strip')
  if (has(t, /\bbefore\b/) && has(t, /\bafter\b/) && f.images >= 2)
    return sure('before_after')
  if (f.questions >= 2 && f.images === 0) return sure('faq')
  if (f.images === 0 && f.links === 0 && f.words <= 16 && f.buttons === 0) {
    if (has(t, /with love|cheers|thank you|thanks|warmly|the .* team$/))
      return sure('signoff', 0.7)
    if (has(t, /shipping|delivery|returns|ships|launched|new|ends/))
      return sure('announcement_bar', 0.7)
  }
  if (
    (f.percents > 0 || has(t, /\bcode\b|\bsale\b/)) &&
    f.prices <= 1 &&
    f.images <= 1 &&
    f.words <= 60
  )
    return sure('offer_banner', 0.7)
  // Numbered rows: 1, 2, 3 each on its own.
  if (
    f.images === 0 &&
    f.prices === 0 &&
    has(t, /(^|\n)\s*1\s*\n[\s\S]*(^|\n)\s*2\s*\n/m)
  )
    return sure('steps', 0.7)
  // One picture with a price (and maybe the old price) is one product.
  if (f.images === 1 && f.prices >= 1 && f.prices <= 2)
    return sure('product_feature', 0.7)
  if (f.prices >= 3)
    return sure(
      f.columns % 3 === 0 && f.columns > 0
        ? 'product_grid_3col'
        : 'product_grid_2col',
      0.7
    )
  if (f.prices === 2) return sure('product_grid_2col', 0.7)
  if (
    has(t, /founder|\bfrom (me|our founder)\b|^hi\b|^dear\b/) &&
    f.words >= 30
  )
    return sure('founder_note', 0.65)
  if (f.images >= 3 && f.words <= 25 && f.links <= 2)
    return sure('ugc_grid', 0.6)
  if (f.images >= 2 && f.links >= 2 && f.words <= 30)
    return sure('category_tiles', 0.6)
  if (f.images === 0 && f.buttons === 1 && f.words <= 6) return sure('cta', 0.7)
  // A logo (picture or name) linked to the store, nothing else.
  if (f.images <= 1 && f.words <= 4 && f.links >= 1 && f.buttons === 0)
    return sure('header_logo', 0.6)
  if (f.images === 1 && f.columns >= 2 && f.words > 10)
    return sure('image_text', 0.65)
  // A picture with a headline and a button: a short eyebrow line above the
  // headline marks the product hero, a picture first marks the photo hero.
  if (f.images === 1 && f.buttons >= 1 && f.words <= 40)
    return sure(f.eyebrow ? 'hero_product' : 'hero_image', 0.6)
  if (f.images === 1 && f.words > 40) return sure('image_text', 0.6)
  if (f.images === 0 && f.buttons === 1 && f.words <= 40)
    return sure('cta', 0.6)
  if (f.images === 0 && f.words > 15) return sure('text', 0.65)
  return { type: 'unsure', confidence: 0.2 }
}

const system = [
  'You label one section of a marketing email. Answer with exactly one block type from this fixed list, or "unsure" if none fits:',
  ...blockCatalog.map((b) => `- ${b.type}: ${b.name}. ${b.purpose}`),
  'Judge the layout and purpose, not the brand. Never invent a type. Give your confidence from 0 to 1.'
].join('\n')

export const labelSchema = {
  name: 'section_label',
  definition: {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', enum: [...blockTypes, 'unsure'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 }
    },
    required: ['type', 'confidence']
  }
}

/** The AI request for one section: its text, counts and picture. */
export function labelRequest(input: SectionInput, model: string) {
  const f = sectionFacts(input.html)
  const user = [
    `Section text: ${f.text || '(no text)'}`,
    `Pictures: ${f.images}; links: ${f.links}; prices: ${f.prices}; percentages: ${f.percents}; stars: ${f.stars}; questions: ${f.questions}; most columns side by side: ${f.columns}.`
  ].join('\n')
  return {
    system,
    user,
    model,
    maxOutputTokens: 60,
    temperature: 0,
    responseKind: 'json' as const,
    schema: labelSchema,
    timeoutMs: 30_000
  }
}

/** Keeps a model answer only if it is one of the 20 types, confident enough. */
export function checkedLabel(content: unknown): {
  type: BlockType | 'unsure'
  confidence: number
} {
  const answer = content as { type?: unknown; confidence?: unknown } | null
  const raw = Number(answer?.confidence)
  const confidence = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0
  if (!isBlockType(answer?.type) || confidence < confidentFrom)
    return { type: 'unsure', confidence }
  return { type: answer.type, confidence }
}

/**
 * Labels one section. With a live provider the model decides; when `ai`
 * is the AI port's fake (`live: false`) the sample rules decide. Provider
 * failures are not hidden: they reach the caller, which retries or sends
 * the section to the ops queue.
 */
export async function labelSection(
  input: SectionInput,
  ai: { provider: AiProvider; model: string; live: boolean }
): Promise<SectionLabel> {
  if (!ai.live) {
    const label = sampleLabel(sectionFacts(input.html))
    return {
      ...(label.confidence < confidentFrom
        ? { type: 'unsure' as const, confidence: label.confidence }
        : label),
      source: 'sample'
    }
  }
  const response = await ai.provider.generate(labelRequest(input, ai.model))
  if (typeof response.content !== 'object' || response.content === null)
    throw new AiProviderError('invalid_output', 'usage', {
      usage: {
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens
      },
      diagnostic: 'label_not_json'
    })
  return { ...checkedLabel(response.content), source: 'model' }
}
