import { z } from 'zod'

/**
 * SEG-STRATEGY-001 (PROJECT_TODOS, VISION §1 rule 3 and Step 6): the rules a
 * strategic segment may use. A segment is a name, 1 to 5 rules a person
 * must all match, and up to 5 rules that leave people out. Provider-neutral:
 * SEG-STRATEGY-001b turns it into Klaviyo's segment definition.
 *
 * Proposal until 001b checks it against Klaviyo: not every store has every
 * metric (Placed Order and Clicked Email can be missing, order history can
 * be short; `missingMetrics` says so first), a profile's country is free
 * text that can be blank or guessed from an IP (an include drops unknowns,
 * an exclude keeps them), and the sign-up date used by `joined` is not yet
 * verified. Klaviyo segments refresh by themselves, and Klaviyo never sends
 * to unsubscribed or suppressed people, so neither needs a rule here.
 */
const days = (max: number) => z.number().int().min(1).max(max)

/** Codes that name a region or a group, not a country (and "UK": use GB). */
const notCountries = new Set(['UK', 'EU', 'EZ', 'UN', 'ZZ', 'QO', 'XK'])
let regionNames: Intl.DisplayNames | null = null
function isCountry(code: string) {
  if (notCountries.has(code) || /^(AA|Q[M-Z]|X[A-Z])$/.test(code)) return false
  try {
    regionNames ??= new Intl.DisplayNames(['en'], {
      type: 'region',
      fallback: 'none'
    })
    return regionNames.of(code) !== undefined
  } catch {
    return false
  }
}

export const segmentRule = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('engaged'),
    action: z.enum(['opened', 'clicked', 'opened_or_clicked']),
    withinDays: days(365)
  }),
  z.object({
    kind: z.literal('purchased'),
    atLeast: z.number().int().min(1).max(100),
    /** null: ever. */
    withinDays: days(730).nullable()
  }),
  z.object({
    kind: z.literal('not_purchased'),
    /** null: never ordered. */
    withinDays: days(730).nullable()
  }),
  z.object({
    kind: z.literal('spent'),
    /** In the store's currency, whole cents. */
    atLeast: z
      .number()
      .min(1)
      .max(10_000_000)
      .refine((v) => Math.round(v * 100) === v * 100, 'whole cents'),
    withinDays: days(730).nullable()
  }),
  z.object({ kind: z.literal('joined'), withinDays: days(365) }),
  z.object({
    kind: z.literal('country'),
    countries: z
      .array(
        z
          .string()
          .regex(/^[A-Z]{2}$/)
          .refine(isCountry, 'a country code (ISO 3166, for example GB)')
      )
      .min(1)
      .max(20)
  })
])
export type SegmentRule = z.infer<typeof segmentRule>

export const segmentDefinition = z.object({
  name: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .refine(
      (v) => !/[\u0000-\u001f\u007f\u2028\u2029]/.test(v),
      'one line of text'
    ),
  include: z.array(segmentRule).min(1).max(5),
  exclude: z.array(segmentRule).max(5)
})
export type SegmentDefinition = z.infer<typeof segmentDefinition>

/** The Klaviyo data a rule reads, so a store missing it is told first. */
export type SegmentData =
  | { metric: 'Opened Email' | 'Clicked Email' | 'Placed Order' }
  | { profile: 'subscribed_at' | 'country' }

const same = (a: SegmentRule, b: SegmentRule) =>
  JSON.stringify(a) === JSON.stringify(b)

const ever = (n: number | null) => n ?? Infinity

/** Rules that cannot both hold for one person. */
function clash(a: SegmentRule, b: SegmentRule) {
  if (
    (a.kind === 'purchased' || a.kind === 'spent') &&
    b.kind === 'not_purchased'
  )
    return ever(a.withinDays) <= ever(b.withinDays)
  return false
}

/** An excluded rule that every included person matches: nobody is left. */
function emptiedBy(included: SegmentRule, excluded: SegmentRule) {
  if (same(included, excluded)) return true
  if (included.kind === 'engaged' && excluded.kind === 'engaged')
    return (
      (excluded.action === 'opened_or_clicked' ||
        excluded.action === included.action) &&
      excluded.withinDays >= included.withinDays
    )
  if (included.kind === 'purchased' && excluded.kind === 'purchased')
    return (
      excluded.atLeast <= included.atLeast &&
      ever(excluded.withinDays) >= ever(included.withinDays)
    )
  if (included.kind === 'country' && excluded.kind === 'country')
    return included.countries.every((c) => excluded.countries.includes(c))
  if (included.kind === 'spent' && excluded.kind === 'spent')
    return (
      excluded.atLeast <= included.atLeast &&
      ever(excluded.withinDays) >= ever(included.withinDays)
    )
  // Anyone who spent money placed an order.
  if (included.kind === 'spent' && excluded.kind === 'purchased')
    return (
      excluded.atLeast === 1 &&
      ever(excluded.withinDays) >= ever(included.withinDays)
    )
  if (included.kind === 'joined' && excluded.kind === 'joined')
    return excluded.withinDays >= included.withinDays
  if (included.kind === 'not_purchased' && excluded.kind === 'not_purchased')
    return ever(excluded.withinDays) <= ever(included.withinDays)
  return false
}

/** Two exclusions that together leave out everyone (ordered in N days, and did not). */
function coverEveryone(a: SegmentRule, b: SegmentRule) {
  return (
    a.kind === 'purchased' &&
    a.atLeast === 1 &&
    b.kind === 'not_purchased' &&
    ever(a.withinDays) >= ever(b.withinDays)
  )
}

/** The countries a person can be in, or null when no country rule applies. */
function countriesLeft(segment: SegmentDefinition) {
  const included = segment.include.filter((r) => r.kind === 'country')
  if (!included.length) return null
  const excluded = new Set(
    segment.exclude.flatMap((r) => (r.kind === 'country' ? r.countries : []))
  )
  return included
    .map((r) => r.countries)
    .reduce((left, list) => left.filter((c) => list.includes(c)))
    .filter((c) => !excluded.has(c))
}

const zodWords = (issue: z.core.$ZodIssue) => {
  const where = issue.path.join(' ')
  return where ? `${where}: ${issue.message}` : issue.message
}

/**
 * A segment that can be made, or why not. `warnings` are allowed but
 * worth saying: a segment with no engagement or purchase rule is close to
 * "everyone", and VISION says never to widen to all subscribers silently.
 */
export function checkSegment(
  input: unknown
):
  | { ok: true; segment: SegmentDefinition; warnings: string[] }
  | { ok: false; problems: string[] } {
  const parsed = segmentDefinition.safeParse(input)
  if (!parsed.success)
    return { ok: false, problems: parsed.error.issues.map(zodWords) }
  const segment = parsed.data
  const problems: string[] = []
  const { include, exclude } = segment
  const quote = (r: SegmentRule) => `“people who ${ruleWords(r)}”`
  include.forEach((a, i) =>
    include.forEach((b, j) => {
      if (i !== j && clash(a, b))
        problems.push(
          `${quote(a)} and ${quote(b)} cannot both be true, so nobody matches.`
        )
    })
  )
  for (const inc of include)
    for (const exc of exclude)
      if (emptiedBy(inc, exc))
        problems.push(
          `Leaving out ${quote(exc)} leaves out all ${quote(inc)}, so nobody matches.`
        )
  exclude.forEach((a, i) =>
    exclude.forEach((b, j) => {
      if (i !== j && coverEveryone(a, b))
        problems.push(
          `Leaving out ${quote(a)} and ${quote(b)} leaves out everyone.`
        )
    })
  )
  const left = countriesLeft(segment)
  if (left !== null && left.length === 0)
    problems.push(
      'No country is left after these country rules, so nobody matches.'
    )
  if (problems.length) return { ok: false, problems: [...new Set(problems)] }
  // VISION: engaged 90 or 180 days is the safe default; never widen silently.
  const warnings = include.some(
    (r) => r.kind === 'engaged' && r.withinDays <= 180
  )
    ? []
    : [
        'This segment has no rule for opening or clicking in the last 180 days, so it may reach people who have not read an email in a long time.'
      ]
  return { ok: true, segment, warnings }
}

const span = (n: number | null) =>
  n === null ? 'ever' : n === 1 ? 'in the last day' : `in the last ${n} days`
const actionWords = {
  opened: 'opened an email',
  clicked: 'clicked an email',
  opened_or_clicked: 'opened or clicked an email'
} as const
/** Country names that read with "the" ("the United States"). */
const withThe =
  /^(United |Netherlands$|Philippines$|Bahamas$|Gambia$|Maldives$|Comoros$|Seychelles$|Dominican Republic$|Central African Republic$|Czech Republic$)|Islands$/
const countryName = (code: string) => {
  let name = code
  try {
    name = new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
  } catch {
    // The code itself.
  }
  return withThe.test(name) ? `the ${name}` : name
}
const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`

const amount = (value: number, currency?: string) => {
  if (!currency) return String(value)
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2
    }).format(value)
  } catch {
    return `${value} ${currency}`
  }
}

/**
 * One rule in plain words ("placed at least 2 orders in the last 180
 * days"); `currency` is the store's, for "spent at least $500".
 */
export function ruleWords(rule: SegmentRule, currency?: string): string {
  switch (rule.kind) {
    case 'engaged':
      return `${actionWords[rule.action]} ${span(rule.withinDays)}`
    case 'purchased':
      return rule.withinDays === null
        ? `have ever placed ${rule.atLeast === 1 ? 'an order' : `at least ${rule.atLeast} orders`}`
        : `placed ${rule.atLeast === 1 ? 'an order' : `at least ${rule.atLeast} orders`} ${span(rule.withinDays)}`
    case 'not_purchased':
      return rule.withinDays === null
        ? 'have never ordered'
        : `have not ordered ${span(rule.withinDays)}`
    case 'spent':
      return rule.withinDays === null
        ? `have spent at least ${amount(rule.atLeast, currency)} in all`
        : `spent at least ${amount(rule.atLeast, currency)} ${span(rule.withinDays)}`
    case 'joined':
      return `joined ${span(rule.withinDays)}`
    case 'country':
      return `live in ${list(rule.countries.map(countryName))}`
  }
}

/** The whole segment in one sentence. */
export function describeSegment(
  segment: SegmentDefinition,
  currency?: string
): string {
  const words = (rules: SegmentRule[], last: string) => {
    const parts = rules.map((r) => ruleWords(r, currency))
    return parts.length <= 1
      ? (parts[0] ?? '')
      : `${parts.slice(0, -1).join(', ')} ${last} ${parts.at(-1)}`
  }
  return `People who ${words(segment.include, 'and')}${
    segment.exclude.length
      ? `, but not people who ${words(segment.exclude, 'or')}`
      : ''
  }.`
}

/** The Klaviyo data the segment reads, each once. */
export function segmentNeeds(segment: SegmentDefinition): SegmentData[] {
  const found = new Map<string, SegmentData>()
  const add = (d: SegmentData) => found.set(JSON.stringify(d), d)
  for (const rule of [...segment.include, ...segment.exclude]) {
    if (rule.kind === 'engaged') {
      if (rule.action !== 'clicked') add({ metric: 'Opened Email' })
      if (rule.action !== 'opened') add({ metric: 'Clicked Email' })
    } else if (
      rule.kind === 'purchased' ||
      rule.kind === 'not_purchased' ||
      rule.kind === 'spent'
    )
      add({ metric: 'Placed Order' })
    else if (rule.kind === 'joined') add({ profile: 'subscribed_at' })
    else add({ profile: 'country' })
  }
  return [...found.values()]
}

/**
 * Metrics the segment needs that the store's Klaviyo account does not have.
 * Pass Klaviyo's own metrics (`findStoreMetrics`), not ones another app
 * sends under the same name. "Opened or clicked" works with either one.
 */
export function missingMetrics(
  segment: SegmentDefinition,
  accountMetrics: readonly string[]
): string[] {
  const have = new Set(accountMetrics)
  const missing = new Set<string>()
  for (const rule of [...segment.include, ...segment.exclude]) {
    if (rule.kind === 'engaged') {
      const opened = have.has('Opened Email')
      const clicked = have.has('Clicked Email')
      if (rule.action === 'opened' && !opened) missing.add('Opened Email')
      if (rule.action === 'clicked' && !clicked) missing.add('Clicked Email')
      if (rule.action === 'opened_or_clicked' && !opened && !clicked) {
        missing.add('Opened Email')
        missing.add('Clicked Email')
      }
    } else if (
      (rule.kind === 'purchased' ||
        rule.kind === 'not_purchased' ||
        rule.kind === 'spent') &&
      !have.has('Placed Order')
    )
      missing.add('Placed Order')
  }
  return [...missing]
}

/**
 * VISION's safe default audience: engaged in the last 90 days, or 180
 * when the 90-day group is under 1,000 people or under 20% of the list.
 * Unknown sizes keep 90.
 */
export function defaultEngagedSegment(sizes: {
  engaged90: number | null
  list: number | null
}): SegmentDefinition {
  const small =
    sizes.engaged90 !== null &&
    (sizes.engaged90 < 1000 ||
      (sizes.list !== null &&
        sizes.list > 0 &&
        sizes.engaged90 < 0.2 * sizes.list))
  const withinDays = small ? 180 : 90
  return {
    name: `Engaged ${withinDays} days`,
    include: [{ kind: 'engaged', action: 'opened_or_clicked', withinDays }],
    exclude: []
  }
}
