export function formatInTimeZone(
  value: Date | string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  const date = typeof value === 'string' ? new Date(value) : value

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeZone,
    ...options
  }).format(date)
}

/** Server-rendered form defaults; persisted schedules always carry a timezone snapshot. */
export function futureIso(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString()
}
