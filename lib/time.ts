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
