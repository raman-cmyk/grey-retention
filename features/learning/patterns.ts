/**
 * LRN-002 part a (D22, AGENT_MAP §5, owner picks #74 and #76): the
 * Performance analyst and the Memory writer, in code. From a brand's own
 * sent emails whose results are final, the analyst finds what repeats:
 * which kinds of email get more or fewer clicks than the rest, which kinds
 * make more people unsubscribe or mark them as spam (a "don't" even when
 * they get clicks, #76), and which kind of section gets the most clicks.
 * A pattern needs at least
 * `minSends` sends on each side (D22: 3+). The writer turns patterns into
 * do's and don'ts with their evidence, raises or lowers a rule's
 * confidence as evidence grows, and retires a rule once enough later sends
 * no longer show it. Pure: the database side is `./run`.
 */

export const minSends = 3
/** Fewer people than this per email say too little (as the A/B test's). */
export const minPeople = 100
/** Only sends this recent are read (a season's habits change). */
export const windowDays = 120
/** A rule is checked again within this time, or it expires. */
export const ruleDays = 90
/** More (or fewer) clicks than the rest by this factor is a pattern. */
export const clickLift = 1.25
export const clickDrop = 0.8
/** This many times the rest's unsubscribe rate, with `minUnsubscribes`. */
export const unsubscribeLift = 2
export const minUnsubscribes = 5
/**
 * #76: spam complaints at or over this share of the people a kind of email
 * reached (1 in 1,000, the rate inbox providers start to warn at), and at
 * least `minSpamComplaints` of them, teach a "don't" on their own.
 */
export const spamComplaintRate = 0.001
export const minSpamComplaints = 3
/** Sends of a kind after which a pattern that faded is retired. */
export const retireAfter = 2 * minSends

/** One sent email, as the analyst reads it. */
export type SentEmail = {
  buildId: string
  /** The planned email type (`emailTypes` in features/strategy/plan.ts). */
  emailType: string | null
  sentAt: string
  recipients: number
  clicks: number
  /** Null when Klaviyo gave no count (never a made-up 0). */
  unsubscribes: number | null
  /** #76: people who marked it as spam; null when Klaviyo gave no count. */
  spamComplaints: number | null
  /** The section block with the most clicks, when known. */
  topBlock: string | null
  /**
   * PICK-99: the owner changed it in Klaviyo before it went out (its words
   * or its design): its results are not GROS's own words alone, and every
   * rule that counts it says so.
   */
  edited?: boolean
}

export type Dimension =
  'email_type' | 'unsubscribes' | 'spam_complaints' | 'top_section'

export type Pattern = {
  dimension: Dimension
  value: string
  kind: 'do' | 'dont'
  rule: string
  why: string
  /** The agents the rule is for. */
  appliesTo: string[]
  evidence: { buildId: string }[]
  confidence: number
}

const planners = ['brief-writer', 'calendar-planner', 'strategy-critic']
const designers = ['section-planner', 'art-director']

const per100 = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : 0
const per1000 = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 10_000) / 10 : 0
const words = (s: string) => s.replace(/[_-]+/g, ' ').trim()
/** Surer with more sends: 0.55 at the minimum, at most 0.9. */
export const confidenceFor = (sends: number) =>
  Math.min(0.9, Math.round((0.55 + 0.05 * (sends - minSends)) * 100) / 100)

/**
 * The emails the analyst may learn from, in the window. PICK-99: never one
 * the owner edited in Klaviyo before it went out: its results are his
 * rewrite's, so it is neither evidence nor counted toward the three sends
 * of any rule (nor toward retiring one).
 */
export function usable(emails: readonly SentEmail[], now: number) {
  const since = now - windowDays * 86_400_000
  return emails.filter(
    (e) =>
      !e.edited &&
      e.recipients >= minPeople &&
      e.clicks >= 0 &&
      Date.parse(e.sentAt) >= since &&
      Date.parse(e.sentAt) <= now
  )
}

type Pool = { emails: SentEmail[]; people: number; clicks: number }
const pool = (emails: SentEmail[]): Pool => ({
  emails,
  people: emails.reduce((n, e) => n + e.recipients, 0),
  clicks: emails.reduce((n, e) => n + e.clicks, 0)
})

/** What repeats in a brand's own sends (see the file's note). */
export function findPatterns(
  all: readonly SentEmail[],
  now: number
): Pattern[] {
  const emails = usable(all, now)
  const out: Pattern[] = []
  const types = [
    ...new Set(emails.flatMap((e) => (e.emailType ? [e.emailType] : [])))
  ].sort()
  const unsubscribed = new Set<string>()
  // #76 first: a kind people mark as spam is a don't, even when it gets
  // clicks. Unlike unsubscribes it is judged on its own rate, not against
  // the rest: complaints over the threshold hurt every email's delivery.
  for (const type of types) {
    const mine = emails.filter(
      (e) => e.emailType === type && e.spamComplaints !== null
    )
    if (mine.length < minSends) continue
    const complaints = mine.reduce((n, e) => n + e.spamComplaints!, 0)
    const people = mine.reduce((n, e) => n + e.recipients, 0)
    if (
      complaints < minSpamComplaints ||
      complaints < people * spamComplaintRate
    )
      continue
    unsubscribed.add(type)
    out.push({
      dimension: 'spam_complaints',
      value: type,
      kind: 'dont',
      rule: `Send fewer ${words(type)} emails: people mark them as spam, which hurts how all of this brand's emails reach the inbox.`,
      why: `${words(type)} emails: ${per1000(complaints, people)} spam complaints per 1,000 people over ${mine.length} sends; inbox providers start to warn at ${spamComplaintRate * 1000} per 1,000.`,
      appliesTo: planners,
      evidence: mine.map((e) => ({ buildId: e.buildId })),
      confidence: confidenceFor(mine.length)
    })
  }
  // #76: a kind that makes people unsubscribe is a don't, even when it
  // gets clicks.
  for (const type of types) {
    const counted = emails.filter((e) => e.unsubscribes !== null)
    const mine = counted.filter((e) => e.emailType === type)
    const rest = counted.filter((e) => e.emailType !== type)
    if (mine.length < minSends || rest.length < minSends) continue
    const lost = mine.reduce((n, e) => n + e.unsubscribes!, 0)
    const lostRest = rest.reduce((n, e) => n + e.unsubscribes!, 0)
    const people = mine.reduce((n, e) => n + e.recipients, 0)
    const peopleRest = rest.reduce((n, e) => n + e.recipients, 0)
    const rate = lost / people
    const rateRest = lostRest / peopleRest
    if (
      lost >= minUnsubscribes &&
      (rateRest === 0 ? rate > 0 : rate / rateRest >= unsubscribeLift)
    ) {
      unsubscribed.add(type)
      out.push({
        dimension: 'unsubscribes',
        value: type,
        kind: 'dont',
        rule: `Send fewer ${words(type)} emails: they make more people unsubscribe than this brand's other emails.`,
        why: `${words(type)} emails: ${per100(lost, people)} unsubscribes per 100 people over ${mine.length} sends, against ${per100(lostRest, peopleRest)} for the other ${rest.length}.`,
        appliesTo: planners,
        evidence: mine.map((e) => ({ buildId: e.buildId })),
        confidence: confidenceFor(mine.length)
      })
    }
  }
  for (const type of types) {
    const mine = pool(emails.filter((e) => e.emailType === type))
    const rest = pool(emails.filter((e) => e.emailType !== type))
    if (mine.emails.length < minSends || rest.emails.length < minSends) continue
    if (!mine.people || !rest.people || !rest.clicks) continue
    const ratio = mine.clicks / mine.people / (rest.clicks / rest.people)
    const kind = ratio >= clickLift ? 'do' : ratio <= clickDrop ? 'dont' : null
    // A kind people unsubscribe from or mark as spam is never a "do" (#76).
    if (!kind || (kind === 'do' && unsubscribed.has(type))) continue
    out.push({
      dimension: 'email_type',
      value: type,
      kind,
      rule:
        kind === 'do'
          ? `Plan more ${words(type)} emails: they get more clicks than this brand's other emails.`
          : `Plan fewer ${words(type)} emails: they get fewer clicks than this brand's other emails.`,
      why: `${words(type)} emails: ${per100(mine.clicks, mine.people)} clicks per 100 people over ${mine.emails.length} sends, against ${per100(rest.clicks, rest.people)} for the other ${rest.emails.length}.`,
      appliesTo: planners,
      evidence: mine.emails.map((e) => ({ buildId: e.buildId })),
      confidence: confidenceFor(mine.emails.length)
    })
  }
  // The section that gets the most clicks, in most of the brand's emails.
  const withTop = emails.filter((e) => e.topBlock)
  const tops = new Map<string, SentEmail[]>()
  for (const e of withTop)
    tops.set(e.topBlock!, [...(tops.get(e.topBlock!) ?? []), e])
  for (const [block, list] of [...tops].sort(([a], [b]) => a.localeCompare(b)))
    if (list.length >= minSends && list.length * 2 > withTop.length)
      out.push({
        dimension: 'top_section',
        value: block,
        kind: 'do',
        rule: `Give ${words(block)} sections a clear place: they get the most clicks in this brand's emails.`,
        why: `The ${words(block)} section got the most clicks in ${list.length} of ${withTop.length} emails.`,
        appliesTo: designers,
        evidence: list.map((e) => ({ buildId: e.buildId })),
        confidence: confidenceFor(list.length)
      })
  return out
}

/** A rule the writer wrote before, as stored. */
export type StoredRule = {
  id: string
  revision: number
  key: string
  status: 'active' | 'expired' | 'retired'
  confidence: number
  /** The owner removed it on Learned (`retired_by`): never brought back. */
  removedByOwner?: boolean
}

/**
 * #76: the "don'ts" about how people take a kind of email (spam, then
 * unsubscribes). One of these that faded comes back when the pattern does,
 * as a new rule (a stored rule never comes back to life), and while one is
 * found a "do" for the same kind of email is retired.
 */
const deliverability = new Set<Dimension>(['spam_complaints', 'unsubscribes'])

/** A rule's key without its return count (`…:dont#2`). */
const baseKey = (key: string) => key.replace(/#\d+$/, '')

export type RuleWrite =
  | {
      op: 'add'
      key: string
      pattern: Pattern
      expiresAt: string
    }
  | {
      op: 'update'
      id: string
      revision: number
      status: 'active' | 'retired'
      confidence: number
      reason: 'stronger' | 'weaker' | 'faded' | 'turned'
    }

/** The stable key of a pattern's rule, per workspace. */
export const ruleKey = (
  tenantId: string,
  p: Pick<Pattern, 'dimension' | 'value' | 'kind'>
) => `results:${tenantId}:${p.dimension}:${p.value}:${p.kind}`.slice(0, 200)

/**
 * The Memory writer's plan (D22): a new pattern is added once (its key);
 * a pattern still there has its confidence moved to the evidence; a rule
 * whose pattern turned the other way is retired at once; one whose pattern
 * faded is retired once `retireAfter` sends of that kind were read since,
 * and otherwise left to expire. #76: a spam or unsubscribe "don't" found
 * for a kind of email retires an active "do" for that kind (`turned`); one
 * that faded or expired is added again under its key with a return count
 * (`…:dont#2`) when the pattern returns, unless the owner removed it.
 */
export function planWrites(input: {
  tenantId: string
  patterns: readonly Pattern[]
  stored: readonly StoredRule[]
  emails: readonly SentEmail[]
  now: number
}): RuleWrite[] {
  const writes: RuleWrite[] = []
  const found = new Map(
    input.patterns.map((p) => [ruleKey(input.tenantId, p), p])
  )
  const active = input.stored.filter((r) => r.status === 'active')
  const expiresAt = new Date(input.now + ruleDays * 86_400_000).toISOString()
  for (const [key, pattern] of found) {
    const before = input.stored.filter((r) => baseKey(r.key) === key)
    if (!before.length) {
      writes.push({ op: 'add', key, pattern, expiresAt })
      continue
    }
    // #76: a deliverability "don't" that faded comes back as a new rule.
    if (
      deliverability.has(pattern.dimension) &&
      !before.some((r) => r.status === 'active' || r.removedByOwner)
    )
      writes.push({
        op: 'add',
        key: `${key}#${before.length + 1}`.slice(0, 200),
        pattern,
        expiresAt
      })
  }
  const emails = usable(input.emails, input.now)
  for (const rule of active) {
    const pattern = found.get(baseKey(rule.key))
    if (pattern) {
      if (Math.abs(pattern.confidence - rule.confidence) >= 0.05)
        writes.push({
          op: 'update',
          id: rule.id,
          revision: rule.revision,
          status: 'active',
          confidence: pattern.confidence,
          reason: pattern.confidence > rule.confidence ? 'stronger' : 'weaker'
        })
      continue
    }
    const parts = baseKey(rule.key).split(':')
    // results:<tenant>:<dimension>:<value>:<kind>
    const [dimension, kind] = [parts[2], parts[parts.length - 1]]
    const value = parts.slice(3, -1).join(':')
    const opposite = ruleKey(input.tenantId, {
      dimension: dimension as Dimension,
      value,
      kind: kind === 'do' ? 'dont' : 'do'
    })
    // #76: people marking a kind as spam, or leaving over it, turns its "do".
    const deliveryDont =
      dimension === 'email_type' &&
      kind === 'do' &&
      [...deliverability].some((d) =>
        found.has(
          ruleKey(input.tenantId, { dimension: d, value, kind: 'dont' })
        )
      )
    if (found.has(opposite) || deliveryDont) {
      writes.push({
        op: 'update',
        id: rule.id,
        revision: rule.revision,
        status: 'retired',
        confidence: rule.confidence,
        reason: 'turned'
      })
      continue
    }
    const sends = emails.filter((e) =>
      dimension === 'top_section' ? e.topBlock !== null : e.emailType === value
    ).length
    if (sends >= retireAfter)
      writes.push({
        op: 'update',
        id: rule.id,
        revision: rule.revision,
        status: 'retired',
        confidence: rule.confidence,
        reason: 'faded'
      })
  }
  return writes
}

/** A rule as the weekly learning report reads it (#74). */
export type LearnedRow = {
  kind: 'do' | 'dont'
  rule: string
  status: 'active' | 'expired' | 'retired'
  createdAt: string
  updatedAt: string
  /** The owner removed it on Learned: not something GROS retired. */
  removedByOwner?: boolean
}

/**
 * Owner pick #74: what the agents learned this week, in plain words ("3
 * new do's, 1 retired"): the rules added in the seven days before `now`,
 * and those retired or expired in them.
 */
export function weeklyLearning(rows: readonly LearnedRow[], now: number) {
  const since = now - 7 * 86_400_000
  const inWeek = (at: string) => {
    const t = Date.parse(at)
    return t >= since && t <= now
  }
  const added = rows.filter((r) => inWeek(r.createdAt))
  const dos = added.filter((r) => r.kind === 'do').map((r) => r.rule)
  const donts = added.filter((r) => r.kind === 'dont').map((r) => r.rule)
  const retired = rows
    .filter(
      (r) =>
        r.status !== 'active' &&
        !r.removedByOwner &&
        inWeek(r.updatedAt) &&
        !inWeek(r.createdAt)
    )
    .map((r) => r.rule)
  const count = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`
  const parts = [
    dos.length ? count(dos.length, 'new do', "new do's") : '',
    donts.length ? count(donts.length, "new don't", "new don'ts") : '',
    retired.length ? `${retired.length} retired` : ''
  ].filter(Boolean)
  return {
    dos,
    donts,
    retired,
    summary: parts.length ? parts.join(', ') : 'Nothing new learned this week'
  }
}
