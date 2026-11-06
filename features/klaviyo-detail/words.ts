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

/** "Waits 45 minutes · any day" instead of raw delay JSON. */
export function waitWords(seconds: number) {
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  const parts = [
    days && plural(days, 'day'),
    hours && plural(hours, 'hour'),
    minutes && plural(minutes, 'minute')
  ].filter(Boolean)
  return `Waits ${parts.length ? parts.join(' ') : 'no time'} · any day`
}

export type FlowStep =
  | { kind: 'wait'; key: string; seconds: number; text: string }
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
            text: waitWords(message.delaySeconds)
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
        line: 'Starts when someone does this (for example, placing an order).'
      }
}

export function percent(part: number, whole: number) {
  if (!whole) return '—'
  return `${((part / whole) * 100).toFixed(1)}%`
}
