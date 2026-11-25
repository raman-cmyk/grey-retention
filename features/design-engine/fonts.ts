/**
 * DES-ENGINE-001: font stacks that hold up in every inbox. Inboxes rarely
 * load web fonts (Gmail never does), so after the email's own fonts comes
 * the closest font every computer has: a serif for a serif, a monospace for
 * a monospace, otherwise Helvetica or Arial. A list that already ends in a
 * generic family (`sans-serif`) is kept exactly, so an email drawn back is
 * drawn in the same font as the original.
 */

const generic = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace'
])

const serifName =
  /serif|georgia|times|garamond|baskerville|bodoni|didot|playfair|merriweather|lora|libre caslon|caslon|cormorant|crimson|spectral|prata|dm serif|noto serif|source serif|pt serif|cambria|palatino|book antiqua|freight|canela|tiempos|recoleta/i
const monoName = /mono|courier|consolas|menlo|monaco|\bcode\b/i

export const safeStacks = {
  serif: ['Georgia', 'Times New Roman', 'Times', 'serif'],
  sans: ['Helvetica', 'Arial', 'sans-serif'],
  mono: ['Courier New', 'Courier', 'monospace']
} as const

/** A name as CSS writes it: quoted when it has a space in it. */
const cssName = (name: string) => (/\s/.test(name) ? `'${name}'` : name)

/** Which safe stack a family list falls back to. */
export function fontCategory(family: string): keyof typeof safeStacks {
  const first = family.split(',')[0] ?? ''
  if (monoName.test(first)) return 'mono'
  if (/sans/i.test(first)) return 'sans'
  if (serifName.test(first)) return 'serif'
  return 'sans'
}

/**
 * The email-safe stack for a cleaned family list (names only, comma
 * separated, as the blueprint keeps them): the list itself, then the
 * closest safe fonts it does not name yet, names with a space quoted. An
 * empty list gets the safe sans stack.
 */
export function safeFontStack(family: string): string {
  const names = family
    .split(',')
    .map((f) => f.trim())
    .filter((f) => /^[A-Za-z0-9 -]+$/.test(f))
  if (!names.length) return safeStacks.sans.map(cssName).join(', ')
  if (generic.has(names.at(-1)!.toLowerCase()))
    return names.map(cssName).join(', ')
  const have = new Set(names.map((n) => n.toLowerCase()))
  const extra = safeStacks[fontCategory(family)].filter(
    (f) => !have.has(f.toLowerCase())
  )
  return [...names, ...extra].map(cssName).join(', ')
}
