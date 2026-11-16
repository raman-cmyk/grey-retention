import { hiddenChars } from '@/features/assembly/assemble'

/**
 * What a reader sees in an email's HTML (REL-EVL's golden set, DST-005's
 * hard checks): shared so the build's checks and the golden set read it
 * the same way.
 */
const named: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  rarr: '→',
  middot: '·',
  zwnj: '',
  percnt: '%',
  euro: '€',
  pound: '£'
}

/**
 * What a reader sees: the visible text (no comments, styles or tags),
 * entities read, tabs and line breaks as spaces before hidden characters
 * go (so two words never join), one space, compatible forms (a fullwidth
 * "％" is "%").
 */
export function drawnText(html: string) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name] ?? m)
    .replace(/\s+/g, ' ')
    .replace(new RegExp(hiddenChars.source, 'g'), '')
    .replace(/\u034f/g, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}
