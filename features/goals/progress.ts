import { localDate } from '@/features/holidays/entries'
import type { ResultLine } from '@/features/results/read-model'

/**
 * PLN-033b (owner pick #33, D27): how far along the owner's revenue goal
 * is, worked backwards to emails. The goal (PLN-033a) is the email revenue
 * Klaviyo reports for a month in the store's currency; this compares it
 * with the brand's Results lines (`resultsReadModel`). The plan step
 * (lane A) reads `emailsNeeded` and `needsStrongerEmails`; GROS and the
 * owner read `sentence`.
 */
export type GoalTarget = {
  /** The first day of the month, YYYY-MM-01 (the store's calendar). */
  month: string
  amount: number
  currency: string
}

/** How far back "what a recent email earns" looks. */
export const perEmailDays = 90

export type GoalProgress = {
  month: string
  goal: number
  currency: string
  /** Email revenue from real emails sent in the goal's month. */
  soFar: number
  /** False when some of those emails' numbers are not final, or orders were not read. */
  soFarFinal: boolean
  remaining: number
  /** Days left in the month, today included (0 once it is over). */
  daysLeft: number
  /** What a recent real, sent, final email earned on average; null without any. */
  perEmail: number | null
  perEmailFrom: number
  /** More emails needed to reach the goal; null when it cannot be estimated. */
  emailsNeeded: number | null
  /** Emails that fit in the days left at `sendsPerWeek`. */
  emailsPossible: number
  /** More emails are needed than fit: the plan needs stronger emails (offers). */
  needsStrongerEmails: boolean
  pace: 'met' | 'on_track' | 'behind' | 'unknown'
  sentence: string
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/
const dayMs = 86_400_000
const toTime = (day: string) => Date.parse(`${day}T00:00:00Z`)
const cents = (n: number) => Math.round(n * 100) / 100

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
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
 */
export function goalProgress(input: {
  goal: GoalTarget
  lines: readonly ResultLine[]
  today: string
  timezone: string
  storeCurrency: string
  sendsPerWeek: number
}): GoalProgress | null {
  const { goal, today, timezone, storeCurrency, sendsPerWeek } = input
  if (
    !isoDay.test(today) ||
    !/^\d{4}-\d{2}-01$/.test(goal.month) ||
    !(goal.amount > 0) ||
    !/^[A-Z]{3}$/.test(goal.currency) ||
    !Number.isInteger(sendsPerWeek) ||
    sendsPerWeek < 1 ||
    sendsPerWeek > 14
  )
    return null
  let sentDay: (at: string) => string
  try {
    localDate(timezone, new Date())
    sentDay = (at) => localDate(timezone, new Date(at))
  } catch {
    return null
  }
  const [y, m] = goal.month.split('-').map(Number) as [number, number]
  const monthEnd = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  const real = input.lines.filter(
    (l) => l.status === 'sent' && !l.sample && l.sentAt && l.totals
  )
  const inMonth = real.filter((l) =>
    sentDay(l.sentAt!).startsWith(goal.month.slice(0, 8))
  )
  const soFar = cents(
    inMonth.reduce((sum, l) => sum + (l.totals!.revenue ?? 0), 0)
  )
  const soFarFinal = inMonth.every(
    (l) => l.final && l.complete && l.totals!.revenue !== null
  )
  const from = new Date(toTime(today) - perEmailDays * dayMs)
    .toISOString()
    .slice(0, 10)
  const recent = real.filter((l) => {
    const day = sentDay(l.sentAt!)
    return (
      l.final &&
      l.totals!.revenue !== null &&
      l.totals!.recipients > 0 &&
      day >= from &&
      day <= today
    )
  })
  const perEmail = recent.length
    ? cents(
        recent.reduce((sum, l) => sum + l.totals!.revenue!, 0) / recent.length
      )
    : null
  const daysLeft =
    today > monthEnd
      ? 0
      : Math.round(
          (toTime(monthEnd) - toTime(today < goal.month ? goal.month : today)) /
            dayMs
        ) + 1
  const emailsPossible = Math.floor((daysLeft * sendsPerWeek) / 7)
  const remaining = cents(Math.max(0, goal.amount - soFar))
  const sameCurrency = goal.currency === storeCurrency
  const emailsNeeded = !sameCurrency
    ? null
    : remaining === 0
      ? 0
      : perEmail && perEmail > 0
        ? Math.ceil(remaining / perEmail)
        : null
  const needsStrongerEmails =
    emailsNeeded !== null && emailsNeeded > emailsPossible
  const pace: GoalProgress['pace'] = !sameCurrency
    ? 'unknown'
    : remaining === 0
      ? 'met'
      : daysLeft === 0
        ? 'behind'
        : emailsNeeded === null
          ? 'unknown'
          : needsStrongerEmails
            ? 'behind'
            : 'on_track'

  const goalText = money(goal.amount, goal.currency)
  const notFinal =
    inMonth.length > 0 && !soFarFinal
      ? ' (some of this month’s numbers are not final yet)'
      : ''
  const sentence = !sameCurrency
    ? `The goal is in ${goal.currency} but the store reports ${storeCurrency}, so progress cannot be measured.`
    : pace === 'met'
      ? `The ${goalText} goal for ${monthName(goal.month)} is met: ${money(soFar, goal.currency)} so far${notFinal}.`
      : daysLeft === 0
        ? `${monthName(goal.month)} is over: ${money(soFar, goal.currency)} of the ${goalText} goal${notFinal}.`
        : emailsNeeded === null
          ? `${money(remaining, goal.currency)} still needed by ${dayName(monthEnd)}${notFinal}; there are no final email results yet to estimate how many emails that takes.`
          : `${money(remaining, goal.currency)} still needed by ${dayName(monthEnd)}${notFinal}. Recent emails earned about ${money(perEmail!, goal.currency)} each, so about ${emailsNeeded} more ${emailsNeeded === 1 ? 'email' : 'emails'}; ${
              needsStrongerEmails
                ? `only ${emailsPossible} fit at ${sendsPerWeek} a week, so the plan needs stronger emails, such as offers.`
                : `${emailsPossible} fit at ${sendsPerWeek} a week.`
            }`
  return {
    month: goal.month,
    goal: goal.amount,
    currency: goal.currency,
    soFar,
    soFarFinal,
    remaining,
    daysLeft,
    perEmail: sameCurrency ? perEmail : null,
    perEmailFrom: sameCurrency ? recent.length : 0,
    emailsNeeded,
    emailsPossible,
    needsStrongerEmails,
    pace,
    sentence
  }
}
