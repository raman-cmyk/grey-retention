import type {
  FlowMessage,
  KlaviyoFlow,
  KlaviyoList
} from '@/lib/providers/klaviyo-read'

/** Plain-English sign-up method (no raw `single_opt_in`, OWNER_JOURNEYS §4). */
export function optInWords(optIn: KlaviyoList['optIn']) {
  return optIn === 'double'
    ? {
        label: 'Double opt-in',
        line: 'People confirm by email before they are added. Slower growth, but a cleaner list.'
      }
    : {
        label: 'Single opt-in',
        line: 'Subscribers are added immediately after signing up. Faster growth, but riskier.'
      }
}

const dayNames: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday'
}

/** "Waits 45 minutes · any day" instead of raw delay JSON. */
export function waitWords(seconds: number, daysOfWeek: string[] | null = null) {
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`
  const total = Math.max(0, Math.round(seconds / 60))
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const minutes = total % 60
  const parts = [
    days && plural(days, 'day'),
    hours && plural(hours, 'hour'),
    minutes && plural(minutes, 'minute')
  ].filter(Boolean)
  const length =
    parts.length > 0
      ? parts.join(' ')
      : seconds > 0
        ? 'less than a minute'
        : 'no time'
  const when =
    daysOfWeek && daysOfWeek.length > 0 && daysOfWeek.length < 7
      ? `only on ${daysOfWeek.map((d) => dayNames[d.toLowerCase()] ?? d).join(', ')}`
      : 'any day'
  return `${length} · ${when}`
}

export type FlowStep =
  | {
      kind: 'wait'
      key: string
      seconds: number
      daysOfWeek: string[] | null
      text: string
    }
  | { kind: 'email'; key: string; message: FlowMessage }

/** The flow as Klaviyo runs it: a wait before every delayed email. */
export function flowSteps(flow: KlaviyoFlow): FlowStep[] {
  return flow.messages.flatMap((message): FlowStep[] => [
    ...(message.delaySeconds > 0
      ? [
          {
            kind: 'wait' as const,
            key: `${message.id}-wait`,
            seconds: message.delaySeconds,
            daysOfWeek: message.daysOfWeek,
            text: waitWords(message.delaySeconds, message.daysOfWeek)
          }
        ]
      : []),
    { kind: 'email' as const, key: message.id, message }
  ])
}

/**
 * A LIVE flow can still hold emails that are off; say so, because owners
 * read LIVE as "everything is on" (OWNER_JOURNEYS §4 fix).
 */
export function liveEmailsLine(flow: KlaviyoFlow) {
  const off = flow.messages.filter((m) => m.status !== 'live').length
  if (flow.status !== 'live' || off === 0) return null
  return `${off} of ${flow.messages.length} emails ${off === 1 ? 'is' : 'are'} not live.`
}

export function triggerWords(flow: KlaviyoFlow) {
  return flow.trigger.kind === 'list'
    ? {
        label: `Added to list: ${flow.trigger.name}`,
        line: 'Starts when someone joins this list.'
      }
    : {
        label: `Metric: ${flow.trigger.name}`,
        line: `Starts when someone does “${flow.trigger.name}” in your store or emails.`
      }
}

export function percent(part: number, whole: number) {
  if (!whole) return '—'
  return `${((part / whole) * 100).toFixed(1)}%`
}

/**
 * Words that match what really happened to a Klaviyo campaign, so a draft or
 * a cancelled campaign never reads "was sent" (UIR-004 review).
 */
export function campaignWords(
  status: 'sent' | 'scheduled' | 'draft' | 'cancelled',
  hasTime: boolean
) {
  switch (status) {
    case 'sent':
      return {
        what: 'What was sent',
        who: 'Who received this',
        whoLine: 'The lists and segments this campaign was sent to.',
        how: 'How it was sent',
        timeLabel: 'Sent at'
      }
    case 'scheduled':
      return {
        what: 'What will be sent',
        who: 'Who will get this',
        whoLine: 'The lists and segments this campaign will be sent to.',
        how: 'How it will be sent',
        timeLabel: 'Sends at'
      }
    case 'cancelled':
      return {
        what: 'What it would have sent',
        who: 'Who it was set to go to',
        whoLine: 'Cancelled before it was sent. It was set to go to:',
        how: 'How it was planned',
        timeLabel: 'Was scheduled for'
      }
    default:
      return {
        what: 'What it will send',
        who: 'Who it is set to go to',
        whoLine: 'Not sent yet. It is set to go to:',
        how: 'How it will be sent',
        timeLabel: hasTime ? 'Planned for' : null
      }
  }
}

export const strategyWords: Record<
  'static' | 'smart' | 'throttled',
  { label: string; line: string }
> = {
  static: { label: 'Static', line: 'At a fixed date and time.' },
  smart: {
    label: 'Smart Send Time',
    line: 'Klaviyo picks the best hour for each person.'
  },
  throttled: {
    label: 'Throttled',
    line: 'Sent in batches over a period of time.'
  }
}
