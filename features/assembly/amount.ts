/**
 * A price string as a number, or null ("$24.00", "€1.234,50", "Rs 900").
 * A leaf module (no other import), so code that runs outside the app
 * (the design engine's browser jobs, under Node's own type stripping) can
 * read prices too; `assemble.ts` re-exports it.
 */
export function amount(price: string): number | null {
  const digits = price.replace(/[^\d.,]/g, '')
  const normal = /^\d{1,3}(\.\d{3})+(,\d+)?$|^\d+,\d{1,2}$/.test(digits)
    ? digits.replace(/\./g, '').replace(',', '.')
    : digits.replace(/,/g, '')
  const n = Number(normal)
  return digits && Number.isFinite(n) && n > 0 ? n : null
}
