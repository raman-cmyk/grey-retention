import type { AiCall } from '@/features/agents/runtime'
import type { AiRunResult } from '@/features/ai/run'
import { FakeAiProvider } from '@/lib/providers/fake'

/**
 * REL-EVL: scripted fake models for the golden set. None calls a provider.
 * Each answers like a model of a known kind, so the set shows what the
 * email build does with it:
 *
 * - `careful`: every agent answers well, the first time.
 * - `careless`: each agent's first answer breaks the rules: a section plan
 *   without the logo, a made-up product, and words with claims, a code and
 *   a discount the brand never gave, and words it bans (only the copy
 *   checks catch those). Its next words are not in the brand's voice
 *   (only the inspectors catch that); its third are good.
 * - `stubborn`: the Copywriter puts a template tag in every subject (only
 *   the subject check catches it), so the email must fall back to plain
 *   copy.
 * - `fixture`: every agent gets what the repo's fake provider answers
 *   (`FakeAiProvider`), from a model said to be live, so every step falls
 *   back to code.
 */
export type FakeModelKind = 'careful' | 'careless' | 'stubborn' | 'fixture'

const answer = (content: unknown): AiRunResult => ({
  ok: true,
  content,
  provider: 'gemini',
  model: 'golden-fake',
  costMicro: 0,
  inputTokens: 1,
  outputTokens: 1,
  settled: true
})

/** The JSON an agent's task or the writer's data carries. */
const dataOf = (user: string): Record<string, unknown> => {
  const json = user.startsWith('Data (JSON): ') ? user.slice(13) : user
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const asked = (data: Record<string, unknown>) =>
  'fix_these_problems_from_your_last_answer' in data || 'fixFromLastTry' in data

type Variant = { variantId: string; family: string }

function planSections(data: Record<string, unknown>, careless: boolean) {
  const variants = (data.variants ?? []) as Variant[]
  const slot = (data.slot ?? {}) as { products?: number; offer?: boolean }
  const sections: { variantId: string; purpose: string }[] = []
  const add = (family: string, purpose: string) => {
    const v = variants.find((x) => x.family === family)
    if (!v) return false
    sections.push({ variantId: v.variantId, purpose })
    return true
  }
  let left = slot.products ?? 0
  if (!careless) add('header_logo', 'The logo at the top.')
  if (slot.offer) add('offer_banner', 'The offer and its code.')
  if (left >= 1 && add('hero_product', 'Leads with the first product.')) left--
  add('text', 'Says why this email matters.')
  if (left >= 2 && add('product_grid_2col', 'Two more products.')) left -= 2
  else if (left >= 1 && add('product_feature', 'One more product.')) left--
  add('cta', 'One clear next step.')
  add('footer', 'The required links and address.')
  return { sections }
}

type Need = { section: number; products_needed: number }

function lockProducts(data: Record<string, unknown>, careless: boolean) {
  const needs = (data.product_sections ?? []) as Need[]
  const ids = [
    ...((data.planned_products ?? []) as { id: string }[]),
    ...((data.other_products ?? []) as { id: string }[])
  ].map((p) => p.id)
  let next = 0
  return {
    sections: needs.map((n) => ({
      section: n.section,
      products: Array.from({ length: n.products_needed }, (_, i) =>
        careless && i === 0 && next === 0 ? (next++, 'p-made-up') : ids[next++]
      )
    }))
  }
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Plain, true words per block: no claims, prices or codes. */
function goodWords(type: string, data: Record<string, unknown>) {
  const products = (data.products ?? []) as string[]
  const facts = (data.facts ?? []) as string[]
  switch (type) {
    case 'announcement_bar':
      return { text: 'Something new from the shop' }
    case 'hero_product':
      return {
        headline: products[0] ? `Meet the ${products[0]}` : 'Made for home',
        cta: 'Shop now'
      }
    case 'hero_image':
      return { headline: 'Made for slow evenings', cta: 'Shop now' }
    case 'offer_banner':
      return { detail: 'Use your code at checkout.', cta: 'Use my code' }
    case 'text':
      return {
        heading: 'A note from the shop',
        paras: ['We picked these for quiet evenings at home.']
      }
    case 'image_text':
      return {
        heading: 'For quiet evenings',
        paras: ['A small thing for the evening.']
      }
    case 'steps':
      return {
        heading: 'Three small steps',
        items: [
          ['Trim the wick', 'Keep it short before you light it.'],
          ['Take your time', 'Let the top melt across the first time.'],
          ['Keep it still', 'Set it down away from open windows.']
        ]
      }
    case 'faq':
      return {
        heading: 'Good to know',
        items: facts.length
          ? [['What should I know?', facts[0]]]
          : [['How do I look after it?', 'Keep it dry and out of the sun.']]
      }
    case 'product_feature':
      return {
        heading: 'Picked for this week',
        body: 'A quiet favourite for the evening.',
        cta: 'Shop now'
      }
    case 'product_grid_2col':
    case 'product_grid_3col':
      return { heading: 'More to love' }
    case 'cta':
      return { label: 'Shop the collection' }
    case 'signoff':
      return { text: 'See you soon' }
    default:
      return {}
  }
}

/** What the Copywriter gets wrong in this answer, if anything. */
type Slip = 'claims' | 'voice' | 'tag' | null

/** The Copywriter: the blocks its instructions list, in order. */
function write(system: string, data: Record<string, unknown>, slip: Slip) {
  const types = [...system.matchAll(/^\d+\. ([a-z0-9_]+):/gm)].map((m) => m[1])
  const products = (data.products ?? []) as string[]
  const kind = title(String(data.campaignType ?? 'news'))
  const good = `${kind} picks: ${products[0] ?? 'a note from the shop'}`
  const retaken = JSON.stringify(data.fixFromLastTry ?? '').includes(
    'already has this subject'
  )
  const subject = {
    claims: 'Half price on everything, today only',
    voice: good,
    tag: `{{ first_name }}, ${good}`
  }
  return {
    subject: slip ? subject[slip] : retaken ? `${good}, this week` : good,
    preheader:
      slip === 'claims'
        ? 'Free shipping on every order, guaranteed for life. So cheap.'
        : 'A few things for slow evenings at home.',
    blocks: types.map((type) => ({
      type,
      reason: 'Plan.',
      words:
        slip === 'claims' && type === 'text'
          ? {
              heading: 'Hurry, the best in the world',
              paras: ['Use code FREE70 for 70% off, today only.']
            }
          : slip === 'voice' && type === 'text'
            ? { heading: 'Yo, check this out fam', paras: ['It slaps, fam.'] }
            : goodWords(type, data)
    }))
  }
}

/** The careless Copywriter's slip: by the problems it was sent back with. */
function carelessSlip(data: Record<string, unknown>): Slip {
  const fix = JSON.stringify(data.fixFromLastTry ?? '')
  if (!('fixFromLastTry' in data)) return 'claims'
  return fix.includes('brand’s voice') ? null : 'voice'
}

/** A fake inspector that flags only words not in the brand's voice. */
function inspect(data: Record<string, unknown>) {
  const email = (data.email ?? {}) as {
    blocks?: { id: string; text: string }[]
  }
  return {
    problems: (email.blocks ?? [])
      .filter((b) => /\bfam\b/i.test(b.text))
      .map((b) => ({
        field: b.id,
        quote: b.text.slice(0, 120),
        reason: 'It is not in the brand’s voice.',
        fix: 'Say it plainly and warmly.'
      }))
  }
}

/** The fake model of one kind, by agent (the first part of the caller key). */
export function fakeModel(kind: FakeModelKind): AiCall {
  return async (call) => {
    if (kind === 'fixture') {
      const said = await new FakeAiProvider().generate({
        ...call.request,
        model: 'fake',
        timeoutMs: 1_000
      })
      return answer(said.content)
    }
    const who = call.callerKey.split(':')[0]
    const data = dataOf(call.request.user)
    const careless = kind === 'careless' && !asked(data)
    switch (who) {
      case 'section-planner':
        return answer(planSections(data, careless))
      case 'content-locker':
        return answer(lockProducts(data, careless))
      case 'copywriter':
        return answer(
          write(
            call.request.system,
            data,
            kind === 'stubborn'
              ? 'tag'
              : kind === 'careless'
                ? carelessSlip(data)
                : null
          )
        )
      case 'brand-inspector':
      case 'email-inspector':
        return answer(inspect(data))
      default:
        return { ok: false, code: 'setup_required' }
    }
  }
}
