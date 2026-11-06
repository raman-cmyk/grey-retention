/** Round-trip local wall times rather than relying on the machine's timezone. */
export function localDateTime(value: Date | string, timezone: string) {
  const date = typeof value === 'string' ? new Date(value) : value
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)
  const part = (type: string) => parts.find((p) => p.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}

export function localTimeCandidates(value: string, timezone: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return []
  const nominal = Date.parse(`${value}:00Z`)
  if (
    !Number.isFinite(nominal) ||
    new Date(nominal).toISOString().slice(0, 16) !== value
  )
    return []
  const offsets = new Set<number>()
  // Sample both sides of any nearby timezone transition, including half-hour DST.
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = new Date(nominal + hours * 3600000)
    offsets.add(
      Date.parse(`${localDateTime(sample, timezone)}:00Z`) - sample.getTime()
    )
  }
  return [...offsets]
    .map((offset) => new Date(nominal - offset))
    .filter((candidate) => localDateTime(candidate, timezone) === value)
    .map((candidate) => candidate.toISOString())
    .sort()
}

export function resolveLocalTime(
  value: string,
  timezone: string,
  occurrence?: string
) {
  const candidates = localTimeCandidates(value, timezone)
  if (!candidates.length)
    throw new Error(
      'That time does not exist in your workspace timezone. Choose another date or time.'
    )
  if (candidates.length > 1 && !['earlier', 'later'].includes(occurrence ?? ''))
    throw new Error(
      'That time occurs twice when clocks change. Choose the first or second occurrence.'
    )
  return occurrence === 'later'
    ? candidates[candidates.length - 1]
    : candidates[0]
}
