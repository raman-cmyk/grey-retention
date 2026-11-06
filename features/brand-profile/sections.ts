import { z } from 'zod'

/**
 * The editable Brand profile (OWNER_JOURNEYS §18 decision 5). Section field
 * keys and limits mirror the latest `private.brand_section_fields`
 * (migration 20260914090019); `sections.test.ts` keeps them in step.
 *
 * Brand facts (`fact`) are not section content: they live only in
 * brand_profiles, which every AI feature reads after the owner approves, and
 * are shown and edited on the Identity and Tone cards.
 */
export type FieldKind = 'text' | 'long' | 'list' | 'terms'
export type BrandFact =
  'brand_name' | 'domain' | 'positioning' | 'voice' | 'prohibitions'
export type FieldSpec = {
  key: string
  label: string
  kind: FieldKind
  max: number
  /** Set for brand facts: the brand_profiles column it edits. */
  fact?: BrandFact
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
  /** What the AI reads from this card today (honest label). */
  aiNote: string
  fields: FieldSpec[]
}[] = [
  {
    key: 'identity',
    title: 'Brand Identity',
    group: 'truth',
    aiNote:
      'The AI reads the brand name, website and positioning once you approve the brand. The other fields are notes for your team; the AI does not read them yet.',
    fields: [
      {
        key: 'brand_name',
        label: 'Brand name',
        kind: 'text',
        max: 120,
        fact: 'brand_name'
      },
      { key: 'niche', label: 'Niche', kind: 'text', max: 200 },
      {
        key: 'positioning',
        label: 'Positioning',
        kind: 'long',
        max: 5000,
        fact: 'positioning'
      },
      {
        key: 'geographic_market',
        label: 'Geographic market',
        kind: 'text',
        max: 200
      },
      {
        key: 'website',
        label: 'Website',
        kind: 'text',
        max: 300,
        fact: 'domain'
      },
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
    aiNote: 'Notes for your team. The AI does not read this section yet.',
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
    aiNote:
      'The AI reads Do and Don’t once you approve the brand. The four tiles are notes for your team; the AI does not read them yet.',
    fields: [
      { key: 'formality', label: 'Formality', kind: 'text', max: 60 },
      { key: 'energy', label: 'Energy', kind: 'text', max: 60 },
      { key: 'warmth', label: 'Warmth', kind: 'text', max: 60 },
      { key: 'archetype', label: 'Archetype', kind: 'text', max: 60 },
      { key: 'do', label: 'Do', kind: 'long', max: 5000, fact: 'voice' },
      {
        key: 'dont',
        label: 'Don’t',
        kind: 'long',
        max: 5000,
        fact: 'prohibitions'
      }
    ]
  },
  {
    key: 'vocabulary',
    title: 'Vocabulary',
    group: 'voice',
    aiNote: 'Notes for your team. The AI does not read this section yet.',
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
    aiNote: 'Notes for your team. The AI does not read this section yet.',
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
    aiNote: 'Notes for your team. The AI does not read this section yet.',
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
/** The section's own fields (stored in brand_profile_sections). */
export const contentFields = (key: SectionKey) =>
  sectionSpec(key)!.fields.filter((f) => !f.fact)
/** The brand facts shown on this card (stored in brand_profiles). */
export const factFields = (key: SectionKey) =>
  sectionSpec(key)!.fields.filter((f) => f.fact)
export const hasFacts = (key: SectionKey) => factFields(key).length > 0

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

/** Strict schema for one section's own content (unknown keys are refused). */
export function contentSchema(key: SectionKey) {
  return z
    .object(
      Object.fromEntries(
        contentFields(key).map((f) => [f.key, fieldSchema(f).optional()])
      )
    )
    .strict()
}

export type BrandFacts = Partial<Record<BrandFact, string>>

/** Strict schema for the brand facts a card edits (brand_profiles limits). */
export function factsSchema(key: SectionKey) {
  return z
    .object(
      Object.fromEntries(
        factFields(key).map((f) => {
          const text = z
            .string()
            .max(f.max, `${f.label}: at most ${f.max} characters.`)
          return [
            f.fact!,
            (f.fact === 'brand_name'
              ? text.min(2, 'Brand name: at least 2 characters.')
              : text
            ).optional()
          ]
        })
      )
    )
    .strict()
}

const termLine = /^(.+?)\s+(?:—|–|--)\s+(.*)$/

/**
 * Reads an edit form: text fields as typed, lists one item per line, terms as
 * "term — definition" per line. Brand facts come back separately; locks only
 * apply to the section's own fields.
 */
export function readSectionForm(key: SectionKey, form: FormData) {
  const content: SectionContent = {}
  const facts: BrandFacts = {}
  for (const field of sectionSpec(key)!.fields) {
    const raw = form.get(field.key)
    if (typeof raw !== 'string') continue
    const text = raw.replace(/\r\n/g, '\n')
    if (field.fact) facts[field.fact] = text.trim()
    else if (field.kind === 'text' || field.kind === 'long')
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
  const lockable = new Set(contentFields(key).map((f) => f.key))
  const locked = form
    .getAll('lock')
    .filter(
      (value): value is string =>
        typeof value === 'string' && lockable.has(value)
    )
  return {
    content,
    facts: hasFacts(key) ? facts : null,
    locked: [...new Set(locked)]
  }
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

/** Text the sample writer added starts with this marker. */
export const SAMPLE_MARK = 'Sample: '
const isSample = (text: string) => text.startsWith(SAMPLE_MARK)

/** True when any value still holds sample text the owner has not replaced. */
export function hasSampleText(content: SectionContent) {
  return Object.values(content).some((value) =>
    typeof value === 'string'
      ? isSample(value)
      : value.some((item) =>
          typeof item === 'string'
            ? isSample(item)
            : isSample(item.term) || isSample(item.definition)
        )
  )
}

/** True when a field has nothing in it yet. */
export function isEmptyValue(value: SectionContent[string] | undefined) {
  return value === undefined || value.length === 0
}
