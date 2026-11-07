/**
 * Copy QA (VISION hard rules 6 and 7, Step 3). Pure and deterministic: the
 * same email, facts and codes always give the same verdict. Every failure has
 * a plain-English reason the owner and the regenerating model can act on.
 */

export type DiscountCode = {
  code: string
  percent: number
  /** ISO timestamp; null means it doesn't expire. */
  expiresAt: string | null
}

/** What the brand has confirmed. `null` means unknown: claims are refused. */
export type BrandFacts = {
  /** 'always', 'never', a money threshold in the store currency, or unknown. */
  freeShipping: 'always' | 'never' | { over: number } | null
  /** Confirmed delivery window in days, e.g. { min: 14, max: 28 }. */
  deliveryDays: { min: number; max: number } | null
  /** Days a customer has to return; 0 means no returns. */
  returnDays: number | null
  /** Money-back guarantee length in days; 0 means none. */
  guaranteeDays: number | null
  /** Exact claims the brand stands behind, e.g. "100% vegan". */
  approvedClaims: string[]
  /** Brand-specific words and claims that must never appear. */
  bannedPhrases: string[]
  /** True only when the brand has a verified review source. */
  reviewsVerified: boolean
}

export type CopyDraft = {
  subject: string
  preview: string
  /** Visible text or HTML per block; HTML is reduced to visible text. */
  blocks: { id: string; text: string }[]
}

export type QaRule =
  | 'discount_over_max'
  | 'discount_not_allowed'
  | 'discount_no_code'
  | 'money_off'
  | 'unknown_code'
  | 'expired_code'
  | 'code_over_max'
  | 'unsupported_percent'
  | 'shipping_claim'
  | 'delivery_promise'
  | 'returns_claim'
  | 'guarantee_claim'
  | 'banned_phrase'
  | 'unsupported_claim'
  | 'unverified_review'

export type QaFailure = {
  rule: QaRule
  field: string
  excerpt: string
  reason: string
}

export type QaResult = { pass: boolean; failures: QaFailure[] }

/** Claims no small store can back up from a facts sheet. */
export const defaultBannedClaims = [
  'clinically proven',
  'clinically tested',
  'dermatologist recommended',
  'doctor recommended',
  'fda approved',
  'cures',
  'cure',
  'miracle',
  'guaranteed results',
  'instant results',
  'permanent results',
  'no side effects',
  '#1',
  'number one'
]

const discountBefore =
  /\b(save|saving|savings|up to|extra|take|get|enjoy|unlock)\s+$/i
const discountAfter = /^\s*(off|discount|sale|savings|saving)\b/i

/** Reduces HTML to the text a reader sees: no tags, styles, scripts or attributes. */
export function visibleText(input: string) {
  return input
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&rarr;/gi, '→')
    .replace(/&middot;/gi, '·')
    .replace(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Removes text QA must not read as claims: product names ("PDRN Balm 5%")
 * and approved claims ("100% vegan"), longest first.
 */
function maskKnown(text: string, phrases: string[]) {
  let out = text
  for (const phrase of [...phrases]
    .filter((p) => p.trim().length > 1)
    .sort((a, b) => b.length - a.length))
    out = out.replace(new RegExp(escapeRegex(phrase.trim()), 'gi'), ' ')
  return out
}

function excerpt(text: string, index: number, length: number) {
  const start = Math.max(0, index - 25)
  const end = Math.min(text.length, index + length + 25)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

function phraseRegex(phrase: string) {
  const p = escapeRegex(phrase.trim())
  const left = /^\w/.test(phrase.trim()) ? '\\b' : ''
  const right = /\w$/.test(phrase.trim()) ? '\\b' : ''
  return new RegExp(`${left}${p}${right}`, 'i')
}

const codeLike =
  /\b(?:code|coupon|promo)\s*[:\-]?\s*["“']?([A-Za-z0-9][A-Za-z0-9_-]{2,29})\b/gi
const shoutCode = /\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{4,20}\b/g

export function checkCopy(input: {
  draft: CopyDraft
  facts: BrandFacts
  /** Highest discount the owner allows, in percent. 0 or null: no discounts. */
  maxDiscountPercent: number | null
  codes: DiscountCode[]
  /** Featured product titles; numbers inside them are not claims. */
  productNames: string[]
  /** When the email sends; codes must be valid then. */
  sendAt: string
}): QaResult {
  const failures: QaFailure[] = []
  const max = input.maxDiscountPercent ?? 0
  const facts = input.facts
  const known = new Map(input.codes.map((c) => [c.code.toUpperCase(), c]))
  // A discount must be exactly what a usable code gives (rule 7).
  const usable = input.codes.filter(
    (c) =>
      c.percent <= max &&
      (!c.expiresAt || Date.parse(c.expiresAt) > Date.parse(input.sendAt))
  )
  const usablePercents = new Set(usable.map((c) => c.percent))
  const fields: [string, string][] = [
    ['subject', input.draft.subject],
    ['preview', input.draft.preview],
    ...input.draft.blocks.map(
      (b) => [`block:${b.id}`, b.text] as [string, string]
    )
  ]
  const fail = (
    rule: QaRule,
    field: string,
    text: string,
    index: number,
    length: number,
    reason: string
  ) =>
    failures.push({
      rule,
      field,
      excerpt: excerpt(text, index, length),
      reason
    })

  for (const [field, raw] of fields) {
    const text = visibleText(raw)
    const scan = maskKnown(text, [
      ...input.productNames,
      ...facts.approvedClaims
    ])

    // Rule 6: every percentage. Discounts must not exceed the max; any
    // other percentage is a claim the facts sheet has to approve.
    for (const m of scan.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) {
      const value = Number(m[1].replace(',', '.'))
      const before = scan.slice(Math.max(0, m.index - 12), m.index)
      const after = scan.slice(
        m.index + m[0].length,
        m.index + m[0].length + 14
      )
      const isDiscount =
        discountBefore.test(before) || discountAfter.test(after)
      if (isDiscount && max <= 0)
        fail(
          'discount_not_allowed',
          field,
          scan,
          m.index,
          m[0].length,
          `It offers ${m[0]} off, but this brand has no discount allowed. Remove the discount.`
        )
      else if (isDiscount && value > max)
        fail(
          'discount_over_max',
          field,
          scan,
          m.index,
          m[0].length,
          `It offers ${m[0]} off, but the most this brand allows is ${max}%.`
        )
      else if (isDiscount && !usablePercents.has(value))
        fail(
          'discount_no_code',
          field,
          scan,
          m.index,
          m[0].length,
          usable.length
            ? `It offers ${m[0]} off, but no usable code gives that. Use exactly: ${usable.map((c) => `${c.code} (${c.percent}%)`).join(', ')}.`
            : `It offers ${m[0]} off, but the brand has no usable discount code. Remove the discount.`
        )
      else if (!isDiscount)
        fail(
          'unsupported_percent',
          field,
          scan,
          m.index,
          m[0].length,
          `"${m[0]}" is a claim the facts sheet doesn't confirm. Remove it, or add the exact claim to the facts sheet.`
        )
    }

    // Rule 6: money. Prices are fine; money off is not (codes are % only).
    for (const m of scan.matchAll(
      /(?:\b(save|saving|savings|extra|take|get)\s+)?([$€£]\s?\d+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?\s?(?:USD|EUR|GBP|AUD|CAD|NPR))(\s+off\b)?/gi
    ))
      if (m[1] || m[3])
        fail(
          'money_off',
          field,
          scan,
          m.index,
          m[0].length,
          `"${m[0].trim()}" is a money-off discount. Discounts must be a % code from the brand's list.`
        )

    // Rule 7: codes come only from the client's list.
    const seen = new Set<string>()
    for (const m of text.matchAll(codeLike)) {
      const word = m[1]
      // "use code below" is not a code; real codes are shouted or have digits.
      if (
        known.has(word.toUpperCase()) ||
        /\d/.test(word) ||
        word === word.toUpperCase()
      )
        seen.add(word.toUpperCase())
    }
    for (const m of scan.matchAll(shoutCode))
      if (known.has(m[0]) || /\bcode\b/i.test(scan)) seen.add(m[0])
    for (const code of seen) {
      const index = Math.max(0, text.toUpperCase().indexOf(code))
      const entry = known.get(code)
      if (!entry) {
        // A shouted word next to "code" might just be a product SKU.
        if (!/\b(code|coupon|promo)\b/i.test(text)) continue
        fail(
          'unknown_code',
          field,
          text,
          index,
          code.length,
          `"${code}" is not one of the brand's discount codes. Use only codes from the list.`
        )
      } else if (
        entry.expiresAt &&
        Date.parse(entry.expiresAt) <= Date.parse(input.sendAt)
      )
        fail(
          'expired_code',
          field,
          text,
          index,
          code.length,
          `"${code}" expires before this email sends.`
        )
      else if (entry.percent > max)
        fail(
          'code_over_max',
          field,
          text,
          index,
          code.length,
          `"${code}" gives ${entry.percent}% off, more than the ${max}% this brand allows.`
        )
    }

    // Facts sheet: shipping.
    const freeShip = scan.match(/\bfree\s+(shipping|delivery|postage)\b/i)
    if (freeShip) {
      const over = scan.match(
        /\bfree\s+(?:shipping|delivery|postage)\s+(?:on\s+orders\s+)?(?:over|above|on orders over)\s+[$€£]?\s?(\d+(?:[.,]\d{1,2})?)/i
      )
      const fs = facts.freeShipping
      const ok =
        fs === 'always' ||
        (fs !== null &&
          typeof fs === 'object' &&
          !!over &&
          Number(over[1].replace(',', '.')) >= fs.over)
      if (!ok)
        fail(
          'shipping_claim',
          field,
          scan,
          freeShip.index!,
          freeShip[0].length,
          fs === null
            ? 'The facts sheet doesn\'t say shipping is free. Remove "free shipping" or confirm it in the facts sheet.'
            : typeof fs === 'object'
              ? `Shipping is only free over ${fs.over}. Say that, or remove the claim.`
              : "This brand doesn't offer free shipping."
        )
    }

    // Facts sheet: delivery promises. Never promise a date or a speed the
    // sheet doesn't confirm (slow shipping is common for small stores).
    const promise = scan.match(
      /\b(arrives?|delivered|get it|ships?)\s+(by|before|in time for)\b|\bin time for (christmas|the holidays|valentine'?s|mother'?s day|father'?s day|black friday)\b|\b(next|same|one|two|2|1)[-\s]day (shipping|delivery)\b|\bexpress (shipping|delivery)\b/i
    )
    if (promise)
      fail(
        'delivery_promise',
        field,
        scan,
        promise.index!,
        promise[0].length,
        facts.deliveryDays
          ? `Delivery takes ${facts.deliveryDays.min}–${facts.deliveryDays.max} days, so don't promise a date or speed. Say "order early" instead.`
          : "The facts sheet has no confirmed delivery time, so don't promise a date or speed."
      )

    // Facts sheet: delivery and dispatch times. Never state a time the sheet
    // doesn't confirm, and never one faster than the slowest confirmed case.
    const time = scan.match(
      /\b(?:ships?|shipped|shipping|dispatch(?:es|ed)?|arrives?|arrival|delivered|delivery)\s+(?:with)?in\s+(?:(\d+)(?:\s*[-–]\s*(\d+))?|an?|one)\s*(?:business\s+|working\s+)?(hours?|days?|weeks?)\b|\b(?:ships?|arrives?)\s+(?:the\s+)?(?:same|next)\s+day\b/i
    )
    if (time) {
      const unit = (time[3] ?? 'day').toLowerCase()
      const stated =
        Number(time[2] ?? time[1] ?? 1) *
        (unit.startsWith('week') ? 7 : unit.startsWith('hour') ? 1 / 24 : 1)
      const d = facts.deliveryDays
      if (!d || stated < d.max)
        fail(
          'delivery_promise',
          field,
          scan,
          time.index!,
          time[0].length,
          d
            ? `Delivery takes ${d.min}–${d.max} days, so don't state a faster time. Say "order early" instead.`
            : "The facts sheet has no confirmed delivery time, so don't state one."
        )
    }

    // Facts sheet: returns.
    for (const m of scan.matchAll(
      /\b(free returns|easy returns|hassle[-\s]free returns|(\d+)[-\s]day returns?|returns? (?:it |them |anything |any item )?within (\d+) days|full refund)\b/gi
    )) {
      const days = m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : null
      const r = facts.returnDays
      if (r === null || r === 0 || (days !== null && days !== r))
        fail(
          'returns_claim',
          field,
          scan,
          m.index,
          m[0].length,
          r === null
            ? "The facts sheet doesn't confirm the returns policy. Remove the returns claim."
            : r === 0
              ? "This brand doesn't accept returns."
              : `Returns are ${r} days, not what this says.`
        )
    }

    // Facts sheet: guarantees.
    for (const m of scan.matchAll(
      /\b(?:(\d+)[-\s]day\s+)?(money[-\s]back|satisfaction)\s+guarantee(?:d)?\b|\brisk[-\s]free\b|\b(\d+)[-\s]day\s+guarantee\b/gi
    )) {
      const days = m[1] ? Number(m[1]) : m[3] ? Number(m[3]) : null
      const g = facts.guaranteeDays
      if (g === null || g === 0 || (days !== null && days !== g))
        fail(
          'guarantee_claim',
          field,
          scan,
          m.index,
          m[0].length,
          g === null
            ? "The facts sheet doesn't confirm a guarantee. Remove it, or ask the owner which guarantee is true."
            : g === 0
              ? 'This brand has no money-back guarantee.'
              : `The guarantee is ${g} days, not what this says.`
        )
    }

    // Banned words: the brand's own list and claims no facts sheet backs.
    for (const phrase of facts.bannedPhrases) {
      const m = scan.match(phraseRegex(phrase))
      if (m)
        fail(
          'banned_phrase',
          field,
          scan,
          m.index!,
          m[0].length,
          `"${m[0]}" is on this brand's banned list.`
        )
    }
    for (const phrase of defaultBannedClaims) {
      if (facts.approvedClaims.some((c) => c.toLowerCase().includes(phrase)))
        continue
      const m = scan.match(phraseRegex(phrase))
      if (m)
        fail(
          'unsupported_claim',
          field,
          scan,
          m.index!,
          m[0].length,
          `"${m[0]}" is a claim the brand can't back up. Remove it.`
        )
    }

    // Results within a time ("results in 7 days") are efficacy claims.
    const results = scan.match(
      /\b(?:results?|see (?:a |the )?(?:difference|change)|visibl[ey]|noticeabl[ey])\b[^.!?]{0,30}?\b(?:in|within|after)\s+(?:just\s+)?\d+\s+(?:days?|weeks?|hours?|uses?)\b/i
    )
    if (results)
      fail(
        'unsupported_claim',
        field,
        scan,
        results.index!,
        results[0].length,
        `"${results[0]}" promises results by a time. Remove it, or add the exact claim to the facts sheet.`
      )

    // Reviews, ratings and customer counts need a verified source.
    if (!facts.reviewsVerified) {
      const proof = scan.match(
        /\b(?:loved|trusted|used|chosen|adored|backed)\s+by\s+(?:over\s+|more than\s+)?[\d,.]+k?\+?|\b[\d,.]+k?\+?\s+(?:happy\s+|satisfied\s+|loyal\s+)?(?:customers|fans|users|women|men|people)\b/i
      )
      if (proof)
        fail(
          'unverified_review',
          field,
          scan,
          proof.index!,
          proof[0].length,
          'Customer counts need a verified source. Remove them for now.'
        )
      const review = scan.match(
        /★{3,}|\b[45](?:\.\d)?\s*(?:\/\s*5|stars?|out of 5)\b|\brated\s+[45](?:\.\d)?\b|\b\d[\d,]*\+?\s+(?:five[-\s]star\s+)?reviews\b/i
      )
      if (review)
        fail(
          'unverified_review',
          field,
          scan,
          review.index!,
          review[0].length,
          'Ratings and review counts need a verified review source. Remove them for now.'
        )
    }
  }

  // One failure per rule and field is enough to act on.
  const unique = failures.filter(
    (f, i) =>
      failures.findIndex(
        (g) =>
          g.rule === f.rule && g.field === f.field && g.excerpt === f.excerpt
      ) === i
  )
  return { pass: unique.length === 0, failures: unique }
}

/**
 * Regenerate until clean (VISION Step 3): up to `maxAttempts` tries, each
 * told what failed last time. If none passes, the email goes to a human.
 */
export async function withCopyQa<T extends CopyDraft>(input: {
  generate: (feedback: QaFailure[]) => Promise<T>
  check: (draft: T) => QaResult
  maxAttempts?: number
}): Promise<
  | { status: 'passed'; draft: T; attempts: QaResult[]; errors: unknown[] }
  | {
      status: 'needs_human'
      /** The last draft that was generated, or null if every try threw. */
      draft: T | null
      attempts: QaResult[]
      errors: unknown[]
    }
> {
  const max = input.maxAttempts ?? 3
  const attempts: QaResult[] = []
  const errors: unknown[] = []
  let feedback: QaFailure[] = []
  let draft: T | null = null
  for (let i = 0; i < max; i++) {
    let next: T
    try {
      next = await input.generate(feedback)
    } catch (error) {
      // A failed try counts, and keeps the last feedback for the next one.
      errors.push(error)
      continue
    }
    draft = next
    const result = input.check(draft)
    attempts.push(result)
    if (result.pass) return { status: 'passed', draft, attempts, errors }
    feedback = result.failures
  }
  return { status: 'needs_human', draft, attempts, errors }
}
