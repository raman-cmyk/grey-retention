import { defaultBannedClaims, type BrandFacts } from '@/features/copy-qa/check'
import { industryOf } from '@/features/intelligence/classifier'
import { industries, type Industry } from '@/features/intelligence/taxonomy'

/**
 * Claims safety list (owner pick #62, ONB-062): words to avoid by industry.
 * Copy QA's general list (`defaultBannedClaims`) blocks claims no small store
 * can back; this adds the claims that are risky for one kind of product,
 * such as a medicine claim for skincare or a pesticide claim for pet care.
 * Each group says why in plain words, for the owner and the Brand book.
 *
 * Phrases are matched as whole words, case-insensitively, by copy QA (and the
 * writer is told to avoid them), so each one is specific enough not to catch
 * ordinary copy: never "treat" (a treat, treat yourself) or "green" (a colour).
 */

export type ClaimGroupKey =
  | 'green'
  | 'medical_beauty'
  | 'health'
  | 'weight'
  | 'germs'
  | 'pests'
  | 'pet_health'
  | 'baby_safety'
  | 'drink_health'
  | 'toughness'
  | 'jewelry'

export type ClaimGroup = {
  key: ClaimGroupKey
  /** Plain words: why a brand like this should not say these. */
  reason: string
  phrases: string[]
}

export type ClaimsSafety = {
  /** The industry the list is for; null when the brand's is not known. */
  industry: Industry | null
  groups: ClaimGroup[]
}

/** Copy QA and the writer take at most this many banned phrases. */
export const maxBannedPhrases = 200

const groups: (ClaimGroup & { for: Industry[] | 'all' })[] = [
  {
    key: 'green',
    for: 'all',
    reason:
      'Broad green words need proof. Say the exact fact instead, for example "made with 60% recycled cotton".',
    phrases: [
      'eco-friendly',
      'eco friendly',
      'environmentally friendly',
      'planet friendly',
      'planet-friendly',
      'earth friendly',
      'earth-friendly',
      'climate neutral',
      'climate-neutral',
      'carbon neutral',
      'carbon-neutral',
      'climate positive',
      'carbon negative',
      'zero emissions',
      'fully sustainable',
      '100% sustainable',
      'chemical-free',
      'chemical free',
      'non-toxic',
      'nontoxic'
    ]
  },
  {
    key: 'medical_beauty',
    for: ['skincare', 'beauty', 'haircare', 'beauty_tools'],
    reason:
      'Beauty products may change how skin or hair looks. Treating a skin or hair condition is a medicine claim.',
    phrases: [
      'treats acne',
      'clears acne',
      'heals acne',
      'acne treatment',
      'eczema',
      'psoriasis',
      'rosacea',
      'dermatitis',
      'heals skin',
      'heals your skin',
      'repairs damaged skin',
      'removes scars',
      'scar removal',
      'erases scars',
      'reverses aging',
      'reverses ageing',
      'reverse aging',
      'erases wrinkles',
      'eliminates wrinkles',
      'removes wrinkles',
      'regrows hair',
      'hair regrowth',
      'stops hair loss',
      'prevents hair loss',
      'botox alternative',
      'better than botox',
      'medical grade',
      'medical-grade',
      'prescription strength',
      'hypoallergenic',
      'dermatologist approved',
      'dermatologist tested'
    ]
  },
  {
    key: 'health',
    for: ['supplements', 'wellness', 'fitness', 'food_drink'],
    reason:
      'Only a medicine may say it treats, cures or prevents an illness, or works like one.',
    phrases: [
      'treats anxiety',
      'treats depression',
      'treats insomnia',
      'prevents cancer',
      'fights cancer',
      'prevents disease',
      'prevents illness',
      'boosts immunity',
      'boosts your immune system',
      'immune boosting',
      'immune-boosting',
      'detoxify',
      'detoxifies',
      'flushes toxins',
      'removes toxins',
      'lowers blood pressure',
      'lowers cholesterol',
      'lowers blood sugar',
      'balances blood sugar',
      'reduces inflammation',
      'anti-inflammatory',
      'pain relief',
      'relieves pain',
      'relieves anxiety',
      'anxiety relief',
      'replaces medication',
      'instead of medication',
      'fda cleared',
      'fda registered',
      'pharmaceutical grade',
      'prescription strength'
    ]
  },
  {
    key: 'weight',
    for: ['supplements', 'wellness', 'fitness', 'food_drink'],
    reason:
      'Weight-loss and fat-burning promises need proof most brands cannot show.',
    phrases: [
      'burns fat',
      'burn fat',
      'fat burner',
      'fat-burning',
      'fat burning',
      'melts fat',
      'lose weight fast',
      'guaranteed weight loss',
      'rapid weight loss',
      'boosts metabolism',
      'speeds up metabolism',
      'appetite suppressant',
      'suppresses appetite'
    ]
  },
  {
    key: 'germs',
    for: [
      'apparel',
      'accessories',
      'home',
      'kitchen',
      'fitness',
      'baby',
      'beauty_tools',
      'electronics',
      'outdoor'
    ],
    reason:
      'Killing germs is a claim that needs lab proof and, in many countries, registration.',
    phrases: [
      'antibacterial',
      'anti-bacterial',
      'antimicrobial',
      'anti-microbial',
      'antiviral',
      'anti-viral',
      'kills germs',
      'kills bacteria',
      'kills viruses',
      'kills 99.9%',
      '99.9% of germs',
      '99.9% of bacteria',
      'germ-free',
      'disinfects'
    ]
  },
  {
    key: 'pests',
    for: ['pet', 'home', 'outdoor'],
    reason:
      'Killing or keeping away fleas, ticks or insects is a pesticide claim that needs registration.',
    phrases: [
      'kills fleas',
      'kills ticks',
      'repels fleas',
      'repels ticks',
      'repels mosquitoes',
      'kills mosquitoes',
      'kills bugs',
      'pest-free'
    ]
  },
  {
    key: 'pet_health',
    for: ['pet'],
    reason:
      'Vet endorsements and animal health promises need real, written proof.',
    phrases: [
      'vet recommended',
      'vet-recommended',
      'veterinarian recommended',
      'vet approved',
      'vet-approved',
      'treats arthritis',
      'prevents arthritis',
      'treats anxiety',
      'relieves anxiety'
    ]
  },
  {
    key: 'baby_safety',
    for: ['baby'],
    reason:
      'Safety and health promises for babies need proof and are checked closely.',
    phrases: [
      'pediatrician recommended',
      'pediatrician approved',
      'paediatrician recommended',
      'prevents colic',
      'teething relief',
      'prevents sids',
      'reduces the risk of sids',
      '100% safe',
      'completely safe',
      'totally safe',
      'hypoallergenic'
    ]
  },
  {
    key: 'drink_health',
    for: ['food_drink'],
    reason:
      'Food and drink may not promise health effects, such as no hangover.',
    phrases: [
      'hangover-free',
      'hangover free',
      'no hangover',
      'prevents hangovers',
      'heart healthy',
      'heart-healthy'
    ]
  },
  {
    key: 'toughness',
    for: ['electronics', 'outdoor', 'accessories', 'kitchen'],
    reason: 'Promises like "unbreakable" need proof from real tests.',
    phrases: [
      'military grade',
      'military-grade',
      'unbreakable',
      'indestructible',
      'lasts forever',
      'never breaks'
    ]
  },
  {
    key: 'jewelry',
    for: ['jewelry', 'accessories'],
    reason: 'Sourcing and skin-safety promises for jewelry need proof.',
    phrases: [
      'conflict-free',
      'conflict free',
      'ethically sourced',
      'hypoallergenic',
      'never tarnishes',
      'will never tarnish',
      'tarnish-proof',
      'tarnish proof'
    ]
  }
]

const general = new Set(defaultBannedClaims.map((p) => p.toLowerCase()))

function industryFrom(industry: string | null): Industry | null {
  const words = (industry ?? '').trim().toLowerCase()
  if (!words) return null
  if ((industries as readonly string[]).includes(words))
    return words as Industry
  return industryOf(words)
}

/**
 * The risky claims for a brand's industry: the fixed list's value
 * (`skincare`) or the brand's own words ("Vitamin C serums"). An unknown
 * industry gets the groups every brand shares. A phrase already on copy
 * QA's general list is left out, so nothing is checked twice.
 */
export function claimsSafety(industry: string | null): ClaimsSafety {
  const found = industryFrom(industry)
  return {
    industry: found,
    groups: groups
      .filter(
        (g) => g.for === 'all' || (found !== null && g.for.includes(found))
      )
      .map(({ key, reason, phrases }) => ({
        key,
        reason,
        phrases: phrases.filter((p) => !general.has(p))
      }))
  }
}

/** Every phrase for the industry, once each, in the groups' order. */
export function claimsSafetyPhrases(industry: string | null): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of claimsSafety(industry).groups)
    for (const phrase of group.phrases)
      if (!seen.has(phrase)) {
        seen.add(phrase)
        out.push(phrase)
      }
  return out
}

/** Why a phrase is on the industry's list, or null when it is not. */
export function claimReason(phrase: string, industry: string | null) {
  const p = phrase.trim().toLowerCase()
  return (
    claimsSafety(industry).groups.find((g) => g.phrases.includes(p))?.reason ??
    null
  )
}

/**
 * The brand facts with the industry's risky claims added to the banned
 * list. The brand's own banned words come first and are kept; a phrase is
 * not added when a claim the brand stands behind contains it (a brand that
 * approved "certified carbon neutral" may say it), when the brand already
 * bans it, or past copy QA's limit of 200.
 */
export function withClaimsSafety(
  facts: BrandFacts,
  industry: string | null
): BrandFacts {
  const own = facts.bannedPhrases.slice(0, maxBannedPhrases)
  const banned = new Set(own.map((p) => p.trim().toLowerCase()))
  const approved = facts.approvedClaims.map((c) => c.toLowerCase())
  const added = claimsSafetyPhrases(industry).filter(
    (p) => !banned.has(p) && !approved.some((c) => containsPhrase(c, p))
  )
  return {
    ...facts,
    bannedPhrases: [...own, ...added].slice(0, maxBannedPhrases)
  }
}

/** Whole-word containment, the way copy QA matches a phrase. */
function containsPhrase(text: string, phrase: string) {
  const p = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const left = /^\w/.test(phrase) ? '\\b' : ''
  const right = /\w$/.test(phrase) ? '\\b' : ''
  return new RegExp(`${left}${p}${right}`, 'i').test(text)
}
