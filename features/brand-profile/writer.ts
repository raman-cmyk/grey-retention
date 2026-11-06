import {
  SAMPLE_MARK,
  contentFields,
  isEmptyValue,
  type SectionContent,
  type SectionKey,
  type Term
} from './sections'

/** What a writer may use: only facts the workspace already saved. */
export type WriterFacts = {
  brandName: string
  products: { title: string; url: string }[]
}

/**
 * "Redo with AI" for one Brand profile section. It returns only the fields it
 * wants to change; the database keeps every other field and every field the
 * owner locked. It never sees or suggests brand facts (name, website,
 * positioning, Do, Don’t): only the owner changes what the AI reads.
 */
export interface BrandProfileWriter {
  readonly live: boolean
  suggest(input: {
    section: SectionKey
    facts: WriterFacts
    current: SectionContent
    locked: string[]
  }): Promise<SectionContent>
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text
const sample = (text: string, max: number) => clip(`${SAMPLE_MARK}${text}`, max)
const missing = (what: string, max: number) => sample(`add ${what} here.`, max)

/** Sample text per field; every string starts with "Sample: ". */
function sampleFields(
  facts: WriterFacts
): Record<string, SectionContent[string]> {
  const name = facts.brandName.trim() || 'your brand'
  const titles = facts.products.slice(0, 5).map((p) => p.title.trim())
  const first = titles[0]
  return {
    niche: missing('your niche', 200),
    geographic_market: missing('the country or region you sell to', 200),
    origin_story: missing('how the brand started, in your own words', 5000),
    target_audience: missing('who buys from you', 2000),
    summary: titles.length
      ? sample(
          `your product list includes ${titles.join(', ')}. Add what makes them special here.`,
          2000
        )
      : missing('your main products', 2000),
    preferred: [sample(name, 300), ...titles.map((t) => sample(t, 300))],
    avoid: [sample('words you never use', 300)],
    terms: (titles.length ? titles.slice(0, 3) : ['Your own word']).map(
      (title): Term => ({
        term: clip(title, 80),
        definition: sample('say what this means in one line.', 300)
      })
    ),
    signature_phrases: [sample('Hi {{ first_name }},', 300)],
    subject_lines: [
      sample(`New from ${name}`, 300),
      ...(first ? [sample(`Meet ${first}`, 300)] : [])
    ],
    opening_lines: [
      sample('Hi {{ first_name }},', 300),
      sample(`Here is what is new at ${name}.`, 300)
    ],
    ctas: [sample(first ? `See ${first}` : 'Take a look', 300)],
    sign_offs: [sample(`The ${name} team`, 300)],
    primary_persona: missing(
      'a short description of your typical customer',
      2000
    ),
    age_range: missing('an age range', 60),
    pain_points: [missing('what problem you solve', 300)],
    motivations: [missing('why customers choose you', 300)],
    emotional_notes: [missing('how customers should feel', 300)]
  }
}

/**
 * The sample writer (AI on the fake provider): spends nothing, calls nothing,
 * and only fills fields that are still empty, with text marked "Sample:".
 * It never replaces the owner's words and never guesses tone or a hero
 * product it has no facts for.
 */
export class SampleBrandProfileWriter implements BrandProfileWriter {
  readonly live = false
  async suggest({
    section,
    facts,
    current,
    locked
  }: Parameters<BrandProfileWriter['suggest']>[0]): Promise<SectionContent> {
    const fill = sampleFields(facts)
    const keep = new Set(locked)
    const out: SectionContent = {}
    for (const field of contentFields(section)) {
      const value = fill[field.key]
      if (value === undefined || keep.has(field.key)) continue
      if (isEmptyValue(current[field.key])) out[field.key] = value
    }
    return out
  }
}

/** The sample writer while AI runs on the fake provider (the default). */
export function brandProfileWriter(
  provider: string | undefined
): BrandProfileWriter | null {
  return (provider ?? 'fake') === 'fake' ? new SampleBrandProfileWriter() : null
}
