import type { SectionContent, SectionKey } from './sections'

/** What a writer may use: only facts the workspace already saved. */
export type BrandFacts = {
  brandName: string
  website: string
  positioning: string
  voice: string
  prohibitions: string
  products: { title: string; url: string }[]
}

/**
 * "Redo with AI" for one Brand profile section. Only a sample writer exists:
 * it spends nothing, calls nothing, and builds suggestions from saved facts.
 * Where it has no fact, it says so instead of inventing one (no made-up
 * origin stories, claims, numbers or audiences).
 */
export interface BrandProfileWriter {
  readonly live: boolean
  suggest(section: SectionKey, facts: BrandFacts): Promise<SectionContent>
}

const lines = (text: string, max = 15) =>
  text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => line.trim().replace(/[.]+$/, ''))
    .filter((line) => line.length > 0 && line.length <= 300)
    .slice(0, max)
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text
const missing = (what: string) => `Sample: add ${what} here.`

export class SampleBrandProfileWriter implements BrandProfileWriter {
  readonly live = false
  async suggest(
    section: SectionKey,
    facts: BrandFacts
  ): Promise<SectionContent> {
    const name = clip(facts.brandName.trim() || 'Your brand', 120)
    const first = facts.products[0]?.title
    const productNames = facts.products
      .slice(0, 5)
      .map((p) => clip(p.title, 300))
    switch (section) {
      case 'identity':
        return {
          brand_name: name,
          niche: first
            ? clip(`Products like ${first}`, 200)
            : missing('your niche'),
          positioning: clip(
            facts.positioning.trim() ||
              missing('one sentence on what makes you different'),
            2000
          ),
          geographic_market: missing('the country or region you sell to'),
          website: clip(facts.website.trim(), 300),
          origin_story: missing('how the brand started, in your own words'),
          target_audience: missing('who buys from you')
        }
      case 'products':
        return {
          hero_product_url: clip(facts.products[0]?.url ?? '', 500),
          summary: productNames.length
            ? clip(`Catalogue includes: ${productNames.join(', ')}.`, 2000)
            : missing('your main products')
        }
      case 'tone':
        return {
          formality: 'Balanced',
          energy: 'Calm',
          warmth: 'Warm',
          archetype: 'Guide',
          do: lines(facts.voice).length
            ? lines(facts.voice)
            : ['Say plainly what the product is', 'Keep sentences short'],
          dont: lines(facts.prohibitions).length
            ? lines(facts.prohibitions)
            : ['No invented claims or urgency']
        }
      case 'vocabulary':
        return {
          preferred: [name, ...productNames].slice(0, 15),
          avoid: ['Act now', 'Guaranteed'],
          terms: productNames.slice(0, 3).map((title) => ({
            term: clip(title, 80),
            definition: 'Sample: describe this product in one line.'
          })),
          signature_phrases: [
            clip(`From the ${name} team`, 300),
            'Hi {{ first_name }},'
          ]
        }
      case 'sample_copy':
        return {
          subject_lines: [
            clip(`New from ${name}`, 300),
            ...(first ? [clip(`Meet ${first}`, 300)] : []),
            clip(`A quick note from ${name}`, 300)
          ],
          opening_lines: [
            'Hi {{ first_name }},',
            clip(`Here is what is new at ${name}.`, 300)
          ],
          ctas: first
            ? ['Shop now', clip(`See ${first}`, 300)]
            : ['Shop now', 'Take a look'],
          sign_offs: [clip(`The ${name} team`, 300)]
        }
      case 'audience':
        return {
          primary_persona: missing(
            'a short description of your typical customer'
          ),
          age_range: missing('an age range'),
          pain_points: [missing('what problem you solve')],
          motivations: [missing('why customers choose you')],
          emotional_notes: [missing('how customers should feel')]
        }
    }
  }
}

/** The sample writer while AI runs on the fake provider (the default). */
export function brandProfileWriter(
  provider: string | undefined = process.env.AI_DEFAULT_PROVIDER
): BrandProfileWriter | null {
  return (provider ?? 'fake') === 'fake' ? new SampleBrandProfileWriter() : null
}
