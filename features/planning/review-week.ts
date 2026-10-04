import { z } from 'zod'
import { localWeek } from './guards'

export function reviewWeek(
  value: unknown,
  timezone: string,
  now = new Date().toISOString()
) {
  const date = z.iso
    .date()
    .refine((v) => v >= '0001-01-01')
    .safeParse(value)
  if (!date.success) return localWeek(now, timezone)
  const chosen = new Date(`${date.data}T12:00:00Z`)
  chosen.setUTCDate(chosen.getUTCDate() - ((chosen.getUTCDay() + 6) % 7))
  return chosen.toISOString().slice(0, 10)
}
