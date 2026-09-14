const MICRO_USD_PER_USD = 1_000_000

export function usdToMicroUsd(value: number): number {
  if (!Number.isFinite(value)) throw new TypeError('USD value must be finite')
  return Math.round(value * MICRO_USD_PER_USD)
}

export function microUsdToUsd(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new TypeError('micro-USD value must be a safe integer')
  return value / MICRO_USD_PER_USD
}

export function formatMicroUsd(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value < MICRO_USD_PER_USD ? 4 : 2,
    maximumFractionDigits: 4
  }).format(microUsdToUsd(value))
}
