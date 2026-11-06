import { z } from 'zod'

/**
 * The editable Brand profile (OWNER_JOURNEYS §18 decision 5). Field keys and
 * limits mirror `private.brand_section_fields` in migration 20260914090018;
 * `sections.test.ts` keeps them in step.
 */
export type FieldKind = 'text' | 'long' | 'list' | 'terms'
export type FieldSpec = {
  key: string
  label: string
  kind: FieldKind
  max: number
}
export type SectionKey =
  'identity' | 'products' | 'tone' | 'vocabulary' | 'sample_copy' | 'audience'
export type Term = { term: string; definition: string }
export type SectionContent = Record<string, string | string[] | Term[]>

export const sections: {
  key: SectionKey
  title: string
  /** Where the section sits in the old app (Brand Truth or Copy & Voice). */
  group: 'truth' | 'voice'
  fields: FieldSpec[]
}[] = [
  {
    key: 'identity',
    title: 'Brand Identity',
    group: 'truth',
    fields: [
      { key: 'brand_name', label: 'Brand name', kind: 'text', max: 120 },
      { key: 'niche', label: 'Niche', kind: 'text', max: 200 },
      { key: 'positioning', label: 'Positioning', kind: 'long', max: 2000 },
      {
        key: 'geographic_market',
        label: 'Geographic market',
        kind: 'text',
        max: 200
      },
      { key: 'website', label: 'Website', kind: 'text', max: 300 },
      { key: 'origin_story', label: 'Origin story', kind: 'long', max: 5000 },
      {
        key: 'target_audience',
        label: 'Target audience',
        kind: 'long',
        max: 2000
      }
    ]
  },
  {
    key: 'products',
    title: 'Product Intelligence',
    group: 'truth',
    fields: [
      {
        key: 'hero_product_url',
        label: 'Hero product URL',
        kind: 'text',
        max: 500
      },
      { key: 'summary', label: 'Product summary', kind: 'long', max: 2000 }
    ]
  },
  {
    key: 'tone',
    title: 'Tone of Voice',
    group: 'voice',
    fields: [
      { key: 'formality', label: 'Formality', kind: 'text', max: 60 },
      { key: 'energy', label: 'Energy', kind: 'text', max: 60 },
      { key: 'warmth', label: 'Warmth', kind: 'text', max: 60 },
      { key: 'archetype', label: 'Archetype', kind: 'text', max: 60 },
      { key: 'do', label: 'Do', kind: 'list', max: 300 },
      { key: 'dont', label: 'Don’t', kind: 'list', max: 300 }
    ]
  },
  {
    key: 'vocabulary',
    title: 'Vocabulary',
    group: 'voice',
    fields: [
      { key: 'preferred', label: 'Preferred', kind: 'list', max: 300 },
      { key: 'avoid', label: 'Avoid', kind: 'list', max: 300 },
      { key: 'terms', label: 'Brand-specific terms', kind: 'terms', max: 300 },
      {
        key: 'signature_phrases',
        label: 'Signature phrases',
        kind: 'list',
        max: 300
      }
    ]
  },
  {
    key: 'sample_copy',
    title: 'Sample Copy',
    group: 'voice',
    fields: [
      { key: 'subject_lines', label: 'Subject lines', kind: 'list', max: 300 },
      { key: 'opening_lines', label: 'Opening lines', kind: 'list', max: 300 },
      { key: 'ctas', label: 'CTAs', kind: 'list', max: 300 },
      { key: 'sign_offs', label: 'Sign-offs', kind: 'list', max: 300 }
    ]
  },
  {
    key: 'audience',
    title: 'Audience',
    group: 'voice',
    fields: [
      {
        key: 'primary_persona',
        label: 'Primary persona',
        kind: 'long',
        max: 2000
      },
      { key: 'age_range', label: 'Age range', kind: 'text', max: 60 },
      { key: 'pain_points', label: 'Pain points', kind: 'list', max: 300 },
      { key: 'motivations', label: 'Motivations', kind: 'list', max: 300 },
      {
        key: 'emotional_notes',
        label: 'Emotional notes',
        kind: 'list',
        max: 300
      }
    ]
  }
]

export const sectionKeys = sections.map((s) => s.key)
export function sectionSpec(key: string) {
  return sections.find((s) => s.key === key) ?? null
}

/** Lists hold up to 15 items; term lists up to 30 (database limits). */
export const LIST_MAX = 15
export const TERMS_MAX = 30

function fieldSchema(field: FieldSpec) {
  if (field.kind === 'text' || field.kind === 'long')
    return z
      .string()
      .max(field.max, `${field.label}: at most ${field.max} characters.`)
  if (field.kind === 'list')
    return z
      .array(
        z
          .string()
          .min(1)
          .max(
            field.max,
            `${field.label}: each line at most ${field.max} characters.`
          )
      )
      .max(LIST_MAX, `${field.label}: at most ${LIST_MAX} lines.`)
  return z
    .array(
      z
        .object({
          term: z.string().min(1).max(80, 'Each term at most 80 characters.'),
          definition: z
            .string()
            .max(300, 'Each definition at most 300 characters.')
        })
        .strict()
    )
    .max(TERMS_MAX, `${field.label}: at most ${TERMS_MAX} terms.`)
}

/** Strict schema for one section's content (unknown keys are refused). */
export function contentSchema(key: SectionKey) {
  const spec = sectionSpec(key)!
  return z
    .object(
      Object.fromEntries(
        spec.fields.map((f) => [f.key, fieldSchema(f).optional()])
      )
    )
    .strict()
}

/**
 * What Identity and Tone show before the owner first saves them: the brand
 * details every AI feature already reads, so editing never blanks them.
 * Long lines are split into sentences to fit the 300-character list items.
 */
export function savedBrandDefaults(brand: {
  brand_name: string
  domain: string
  positioning: string
  voice: string
  prohibitions: string
}): Partial<Record<SectionKey, SectionContent>> {
  const items = (text: string) =>
    text
      .split(/\r?\n/)
      .flatMap((line) =>
        line.length > 300 ? line.split(/(?<=[.!?])\s+/) : [line]
      )
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, LIST_MAX)
  return {
    identity: {
      brand_name: brand.brand_name,
      positioning: brand.positioning,
      website: brand.domain
    },
    tone: { do: items(brand.voice), dont: items(brand.prohibitions) }
  }
}

const termLine = /^(.+?)\s+(?:—|–|-|:)\s+(.*)$/

/**
 * Reads an edit form: text fields as typed, lists one item per line, terms as
 * "term — definition" per line. Returns content and the locked field keys.
 */
export function readSectionForm(key: SectionKey, form: FormData) {
  const spec = sectionSpec(key)!
  const content: SectionContent = {}
  for (const field of spec.fields) {
    const raw = form.get(field.key)
    if (typeof raw !== 'string') continue
    const text = raw.replace(/\r\n/g, '\n')
    if (field.kind === 'text' || field.kind === 'long')
      content[field.key] = text.trim()
    else {
      const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
      content[field.key] =
        field.kind === 'list'
          ? lines
          : lines.map((line) => {
              const match = line.match(termLine)
              return match
                ? { term: match[1]!.trim(), definition: match[2]!.trim() }
                : { term: line, definition: '' }
            })
    }
  }
  const fieldKeys = new Set(spec.fields.map((f) => f.key))
  const locked = form
    .getAll('lock')
    .filter(
      (value): value is string =>
        typeof value === 'string' && fieldKeys.has(value)
    )
  return { content, locked: [...new Set(locked)] }
}

/** Text for an edit box: lists one per line, terms as "term — definition". */
export function fieldText(
  field: FieldSpec,
  value: SectionContent[string] | undefined
) {
  if (value === undefined) return ''
  if (typeof value === 'string') return value
  return value
    .map((item) =>
      typeof item === 'string'
        ? item
        : item.definition
          ? `${item.term} — ${item.definition}`
          : item.term
    )
    .join('\n')
}
