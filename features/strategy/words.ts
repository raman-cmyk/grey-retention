/**
 * Agents point at facts by id; their own words must not state facts. This
 * check refuses digits, money and percent signs, number words ("twenty",
 * "half"), offer words that make a promise ("free shipping", "percent"),
 * weekday and month names, and the store's own codes as whole words.
 * Shared by every strategy and email-build agent.
 */

const numberWords = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'thousand',
  'half',
  'quarter',
  'third',
  'dozen',
  'double',
  'triple',
  'twice',
  'percent',
  'per cent',
  'bogo',
  'free shipping',
  'free delivery'
]
const dateWords = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'january',
  'february',
  'march',
  'april',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'tomorrow',
  'tonight',
  'today'
]
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const words = new RegExp(
  `(^|[^\\p{L}])(${[...numberWords, ...dateWords].map(escape).join('|')})(?=$|[^\\p{L}])`,
  'iu'
)

/**
 * What in `text` states a fact the agent should only point at, or null.
 * `codes` are the store's discount codes (matched as whole words).
 */
export function statedFact(text: string, codes: readonly string[] = []) {
  if (/[\d%$€£¥₹]/u.test(text)) return 'a number or a money sign'
  const word = words.exec(text)
  if (word) return `"${word[2].toLowerCase()}"`
  for (const code of codes) {
    if (!code) continue
    if (
      new RegExp(
        `(^|[^\\p{L}\\p{N}])${escape(code)}(?=$|[^\\p{L}\\p{N}])`,
        'iu'
      ).test(text)
    )
      return 'a discount code'
  }
  return null
}
