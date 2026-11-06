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

/** Form field carrying the owner's choice for a time that occurs twice. */
export function occurrenceField(name: string) {
  return `${name}Occurrence`
}

const localPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/**
 * Server-side conversion for date-and-time pickers. Owners pick a wall time in
 * the workspace timezone (`YYYY-MM-DDTHH:mm`, the `datetime-local` format);
 * this turns each named field into an exact UTC ISO time before the action's
 * schema runs. The timezone must come from the authorized request context,
 * never from the browser. Missing or empty fields are left for the schema to
 * reject. Occurrence choices are consumed and removed.
 */
export function resolveLocalTimeFields(
  values: Record<string, unknown>,
  fields: readonly string[],
  timezone: string
):
  { ok: true; values: Record<string, unknown> } | { ok: false; error: string } {
  const out = { ...values }
  for (const field of fields) {
    const raw = out[field]
    const occurrence = out[occurrenceField(field)]
    delete out[occurrenceField(field)]
    if (raw === undefined || raw === '') continue
    if (typeof raw !== 'string' || !localPattern.test(raw))
      return { ok: false, error: 'Choose a date and time.' }
    try {
      out[field] = resolveLocalTime(
        raw,
        timezone,
        typeof occurrence === 'string' ? occurrence : undefined
      )
    } catch (error) {
      return { ok: false, error: (error as Error).message }
    }
  }
  return { ok: true, values: out }
}
