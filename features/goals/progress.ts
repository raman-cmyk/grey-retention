import { localDate } from '@/features/holidays/entries'
import type { ResultLine } from '@/features/results/read-model'

/**
 * PLN-033b (owner pick #33, D27): how far along the owner's revenue goal
 * is, worked backwards to emails. It compares a month's goal (PLN-033a)
 * with the brand's Results lines (`resultsReadModel`): the emails GROS put
 * into Klaviyo. Flows and campaigns made by hand are not in those lines,
 * so "so far" is GROS emails' revenue (follow-up PLN-033c adds the rest).
 * The plan step (lane A) reads `emailsNeeded` and `needsStrongerEmails`;
 * GROS and the owner read `sentence`.
 */
export type GoalTarget = {
  /** The first day of the month, YYYY-MM-01 (the store's calendar). */
  month: string
  amount: number
  currency: string
}

/** How far back "what a recent email earns" looks (days before today, today included). */
export const perEmailDays = 90

export type GoalProgress = {
  month: string
  goal: number
  currency: string
  /** Revenue from GROS emails sent in the month; null when it cannot be compared. */
  soFar: number | null
  /** False while any email sent in the month has numbers still to come. */
  soFarFinal: boolean
  remaining: number | null
  /** Days left in the month, today included (0 once it is over). */
  daysLeft: number
  /** What a recent sent, final, whole email earned on average; null without any. */
  perEmail: number | null
  perEmailFrom: number
  /** Emails sent this month whose results are not read yet (counted at `perEmail` each). */
  awaiting: number
  /** More emails needed to reach the goal; null when it cannot be estimated. */
  emailsNeeded: number | null
  /** Emails that fit in the days left at `sendsPerWeek` (at least 1 while a day is left). */
  emailsPossible: number
  /** More emails are needed than fit (or emails earn nothing): the plan needs stronger emails. */
  needsStrongerEmails: boolean
  pace: 'met' | 'on_track' | 'behind' | 'missed' | 'unknown'
  sentence: string
}

const dayMs = 86_400_000
/** A real calendar day, YYYY-MM-DD. */
const realDay = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const at = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value
}
const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`)
const shift = (day: string, days: number) =>
  new Date(toTime(day) + days * dayMs).toISOString().slice(0, 10)
const toCents = (n: number) => Math.round(n * 100)

function wholeOnly(currency: string) {
  try {
    return (
      new Intl.NumberFormat('en', {
        style: 'currency',
        currency
      }).resolvedOptions().maximumFractionDigits === 0
    )
  } catch {
    return false
  }
}
function money(amount: number, currency: string, round = false) {
  const value = round || wholeOnly(currency) ? Math.round(amount) : amount
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
const dayName = (day: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long'
  }).format(new Date(toTime(day)))
const monthName = (month: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric'
  }).format(new Date(toTime(month)))

/**
 * The goal's progress, or null when an input cannot be used (a bad day,
 * month, amount, timezone or pace). `today` is the store's today.
 * `storeCurrency` is the currency Klaviyo reports in (null until known).
 * `coversFrom`: the earliest send day the lines are known to cover; when it
 * is after the month's first day, some emails may be missing and "so far"
 * is not final. Pass lines for the whole month and the last 90 days.
 */
export function goalProgress(input: {
  goal: GoalTarget
  lines: readonly ResultLine[]
  today: string
  timezone: string
  storeCurrency: string | null
  sendsPerWeek: number
  coversFrom?: string
}): GoalProgress | null {
  const { goal, today, timezone, sendsPerWeek } = input
  if (
    !realDay(today) ||
    !realDay(goal.month) ||
    !goal.month.endsWith('-01') ||
    !Number.isFinite(goal.amount) ||
    !(goal.amount > 0) ||
    goal.amount > 1_000_000_000 ||
    !/^[A-Z]{3}$/.test(goal.currency) ||
    !Number.isInteger(sendsPerWeek) ||
    sendsPerWeek < 1 ||
    sendsPerWeek > 14 ||
    (input.coversFrom !== undefined && !realDay(input.coversFrom))
  )
    return null
  try {
    localDate(timezone, new Date())
  } catch {
    return null
  }
  const storeCurrency =
    input.storeCurrency && /^[A-Z]{3}$/.test(input.storeCurrency)
      ? input.storeCurrency
      : null
  const [y, m] = goal.month.split('-').map(Number) as [number, number]
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const daysLeft =
    today > monthEnd
      ? 0
      : Math.round(
          (toTime(monthEnd) - toTime(today < goal.month ? goal.month : today)) /
            dayMs
        ) + 1
  const emailsPossible =
    daysLeft > 0 ? Math.max(1, Math.floor((daysLeft * sendsPerWeek) / 7)) : 0
  const base = {
    month: goal.month,
    goal: goal.amount,
    currency: goal.currency,
    daysLeft,
    emailsPossible
  }
  if (storeCurrency !== goal.currency)
    return {
      ...base,
      soFar: null,
      soFarFinal: false,
      remaining: null,
      perEmail: null,
      perEmailFrom: 0,
      awaiting: 0,
      emailsNeeded: null,
      needsStrongerEmails: false,
      pace: 'unknown',
      sentence: storeCurrency
        ? `The goal is in ${goal.currency} but the store reports ${storeCurrency}, so progress cannot be measured.`
        : 'The store’s currency is not known yet, so progress cannot be measured.'
    }

  // Emails that went out: sent or sending, and deleted ones that had been sent.
  const out = input.lines.flatMap((l) => {
    const at = l.sentAt ? Date.parse(l.sentAt) : NaN
    if (
      l.sample ||
      Number.isNaN(at) ||
      !(l.status === 'sent' || l.status === 'sending' || l.status === 'deleted')
    )
      return []
    return [{ line: l, day: localDate(timezone, new Date(at)) }]
  })
  const inMonth = out.filter(
    (o) => o.day.slice(0, 7) === goal.month.slice(0, 7)
  )
  const soFarCents = inMonth.reduce(
    (sum, o) => sum + toCents(o.line.totals?.revenue ?? 0),
    0
  )
  const awaiting = inMonth.filter((o) => !o.line.totals).length
  const soFarFinal =
    inMonth.every(
      (o) =>
        o.line.status === 'sent' &&
        o.line.final &&
        o.line.complete &&
        o.line.totals?.revenue != null
    ) &&
    (input.coversFrom === undefined || input.coversFrom <= goal.month)
  const from = shift(today, -(perEmailDays - 1))
  const recent = out.filter(
    (o) =>
      o.line.status === 'sent' &&
      o.line.final &&
      o.line.complete &&
      o.line.totals?.revenue != null &&
      o.line.totals.recipients > 0 &&
      o.day >= from &&
      o.day <= today
  )
  const perEmailCents = recent.length
    ? Math.round(
        recent.reduce((sum, o) => sum + toCents(o.line.totals!.revenue!), 0) /
          recent.length
      )
    : null
  const remainingCents = Math.max(0, toCents(goal.amount) - soFarCents)
  // Emails already out but not read yet will likely earn about `perEmail` each.
  const stillCents = Math.max(
    0,
    remainingCents - awaiting * (perEmailCents ?? 0)
  )
  const over = daysLeft === 0
  const emailsNeeded =
    remainingCents === 0
      ? 0
      : over || perEmailCents === null || perEmailCents === 0
        ? null
        : Math.ceil(stillCents / perEmailCents)
  const earnsNothing = perEmailCents === 0 && remainingCents > 0
  const needsStrongerEmails =
    !over &&
    (earnsNothing || (emailsNeeded !== null && emailsNeeded > emailsPossible))
  const pace: GoalProgress['pace'] =
    remainingCents === 0
      ? 'met'
      : over
        ? 'missed'
        : perEmailCents === null
          ? 'unknown'
          : needsStrongerEmails
            ? 'behind'
            : 'on_track'

  const soFar = soFarCents / 100
  const remaining = remainingCents / 100
  const cur = goal.currency
  const pending = !soFarFinal
    ? over || remainingCents === 0
      ? ' (some numbers are still to come, so this may change)'
      : ' (some of this month’s numbers are still to come)'
    : ''
  const fit = (n: number) => `${n} ${n === 1 ? 'fits' : 'fit'}`
  const each =
    perEmailCents === null
      ? ''
      : recent.length === 1
        ? `The one recent email earned ${money(perEmailCents / 100, cur, true)}`
        : `Recent emails earned about ${money(perEmailCents / 100, cur, true)} each`
  const sentence =
    pace === 'met'
      ? `The ${money(goal.amount, cur)} goal for ${monthName(goal.month)} is met: ${money(soFar, cur)} from GROS emails${pending}.`
      : pace === 'missed'
        ? `${monthName(goal.month)} is over: ${money(soFar, cur)} from GROS emails of the ${money(goal.amount, cur)} goal${pending}.`
        : pace === 'unknown'
          ? `${money(remaining, cur)} still needed by ${dayName(monthEnd)}${pending}; there are no final email results yet to estimate how many emails that takes.`
          : earnsNothing
            ? `${money(remaining, cur)} still needed by ${dayName(monthEnd)}${pending}. Recent emails earned nothing, so more emails alone will not reach it; the plan needs stronger emails, such as offers.`
            : `${money(remaining, cur)} still needed by ${dayName(monthEnd)}${pending}. ${each}, so about ${emailsNeeded} more ${emailsNeeded === 1 ? 'email' : 'emails'}${awaiting ? ` after the ${awaiting} still being read` : ''}; ${
                needsStrongerEmails
                  ? `only ${fit(emailsPossible)} at ${sendsPerWeek} a week, so the plan needs stronger emails, such as offers.`
                  : `${fit(emailsPossible)} at ${sendsPerWeek} a week.`
              }`
  return {
    ...base,
    soFar,
    soFarFinal,
    remaining,
    perEmail: perEmailCents === null ? null : perEmailCents / 100,
    perEmailFrom: recent.length,
    awaiting,
    emailsNeeded,
    needsStrongerEmails,
    pace,
    sentence
  }
}
