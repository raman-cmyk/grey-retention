import {
  holidayCountries,
  platformHolidays
} from '@/features/holidays/platform'

/**
 * PIC-23 part 2a (owner pick #23, the founder's voice): people's names out
 * of a line of the owner's words, before the words are kept or given to an
 * AI (`excerpt.ts`). Word by word: a line's words split at every common
 * word (a greeting, a thanks, a heading's words, a sentence's first verb),
 * at punctuation and at abbreviations; what is left becomes "[name]" when
 * it is two capitalised words or more, a name and an initial, or a title
 * and a name. The store's own words (`ownWordsOf`: its name and product
 * titles) and the occasions emails are sent for are kept. Every step is a
 * loop or a bounded pattern: a hostile line is read at once.
 */

/**
 * One spelling for the store's words and a line's: NFKC, lower case, one
 * apostrophe, no punctuation at a word's ends ("Co." is "co").
 */
const normWord = (word: string) =>
  trimEnds(word.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'"), (c) =>
    /[\p{L}\p{N}]/u.test(c)
  )

/**
 * A word without the characters at its ends that `keep` refuses, by a
 * loop from each end (a pattern anchored at the end tries every start:
 * slow on a long run of commas).
 */
function trimEnds(word: string, keep: (char: string) => boolean) {
  const chars = Array.from(word)
  let from = 0
  let to = chars.length
  while (from < to && !keep(chars[from]!)) from++
  while (to > from && !keep(chars[to - 1]!)) to--
  return chars.slice(from, to).join('')
}

/** The store's own words, by their runs of one to three words (`ownWordsOf`). */
export type OwnWords = { readonly runs: ReadonlySet<string> }
const maxOwnPhrases = 50_000
const maxOwnWordsEach = 12
const maxOwnRuns = 200_000

/**
 * The store's own words (its name, its product titles) as the name check
 * reads them. Build it once and pass it to every `voiceExcerpt` of a run:
 * at most 50,000 phrases, 12 words each, 200,000 runs in all.
 */
export function ownWordsOf(own: readonly string[]): OwnWords {
  const runs = new Set<string>()
  addRuns(runs, own.slice(0, maxOwnPhrases), maxOwnRuns)
  return { runs }
}

function addRuns(runs: Set<string>, phrases: readonly unknown[], max: number) {
  for (const phrase of phrases) {
    if (typeof phrase !== 'string') continue
    const words = phrase
      .split(/\s+/)
      .slice(0, maxOwnWordsEach)
      .map((w) => (w.length > maxTokenChars ? '' : normWord(w)))
      .filter(Boolean)
    for (let i = 0; i < words.length; i++)
      for (let n = 1; n <= 3 && i + n <= words.length; n++) {
        if (runs.size >= max) return
        runs.add(words.slice(i, i + n).join(' '))
      }
  }
}

/**
 * The occasions emails are sent for (the planner's holidays, every
 * country's, and the days stores sell on): no one's name, whatever the
 * store passes. Built once.
 */
const extraOccasions = [
  'Earth Day',
  'International Cat Day',
  'International Coffee Day',
  'International Day of Yoga',
  'International Dog Day',
  'International Tea Day',
  'International Women’s Day',
  'National Pet Day',
  'World Chocolate Day',
  'World Environment Day',
  'World Health Day',
  'World Mental Health Day',
  'Cinco de Mayo',
  'Mardi Gras',
  'Eid Mubarak',
  'Eid al-Fitr',
  'Eid al-Adha',
  'Ramadan Kareem',
  'Chinese New Year',
  'Rosh Hashanah',
  'Yom Kippur',
  'Prime Day',
  'Green Monday',
  'Small Business Saturday',
  'Singles Day',
  'Super Bowl Sunday',
  'Black History Month',
  'Pride Month',
  'Back To School',
  'Boxing Week',
  'Cyber Week',
  'Fourth Of July',
  'Bastille Day',
  'Burns Night',
  'Pancake Day',
  'Shrove Tuesday',
  'Ash Wednesday',
  'Palm Sunday',
  'Easter Sunday',
  'St. Andrew’s Day',
  'St. David’s Day',
  'St. George’s Day',
  'Guy Fawkes Night'
]
let occasions: ReadonlySet<string> | null = null
function occasionRuns(): ReadonlySet<string> {
  if (occasions) return occasions
  const names = holidayCountries.flatMap((c) =>
    platformHolidays({ country: c.code, from: '2026-01-01', days: 366 }).map(
      (h) => h.name.replace(/\s*\(.*\)\s*$/, '')
    )
  )
  const runs = new Set<string>()
  addRuns(runs, [...new Set([...names, ...extraOccasions])], 10_000)
  occasions = runs
  return runs
}
const ownHas = (own: OwnWords, run: string) =>
  own.runs.has(run) || occasionRuns().has(run)

/** Words of the calendar: they may start a name (April, Summer), never make one alone. */
const calendar = new Set(
  "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december black cyber small business christmas easter new year eve day mother's father's valentine's thanksgiving halloween boxing labor labour memorial independence spring summer autumn fall winter".split(
    ' '
  )
)
/**
 * Common words a heading, a greeting or a sentence's start is made of
 * (and the verbs an email's sentences start with): never part of a name,
 * so "Meet Jordan Sample" keeps "Meet" and loses the name, and "Happy
 * Thanksgiving" or "Our Story" stay.
 */
const common = new Set(
  'a an the this that these those next last first our your my his her their its all every each any some no not happy merry thank thanks dear hi hello hey welcome congrats congratulations good great best top big little new free pro fun quick early final special limited meet shop sale sold out coming soon sneak peek studio diary field notes gift gifts tip tips fact facts story stories news note update updates team love from with without and or but so if then when while after before also just only still yet please for of to in on at by into about over under up down off is are was were be been will can do does did have has had here there now today tonight tomorrow back thoughts morning evening night weekend week month year season holiday holidays edition collection deal deals offer offers order orders shipping stock open closed inside behind scenes look birthday anniversary winner winners customer customers member members spotlight shoutout photo photos giveaway take get try make keep find see join come bring give grab save enjoy discover explore read watch learn start let check pick choose wear treat send call visit tell ask go you yours us we i me it they he she who what why how where which one two three'.split(
    ' '
  )
)
const titleWords = new Set(['mr', 'mrs', 'ms', 'mx', 'dr', 'miss', 'prof'])
/** Common words that are also surnames: they end a name after its part. */
const surnameLike = new Set(['little', 'best', 'field', 'winner'])
/**
 * Words a letter or a size follows ("Vitamin C", "Size M", "Plan B",
 * "USB Type C"): that letter is no initial, and the word no name.
 */
const beforeLetter = new Set(
  'vitamin vitamins size sizes plan type model grade hall room apartment unit block gate option version class level part section phase zone cup step tier row seat floor suite wing bay door series category formula batch lot'.split(
    ' '
  )
)
const particleWords = new Set(
  'de da di du la le van von der den del dos das al'.split(' ')
)
/** Abbreviations written like initials: never a name. */
const abbreviations = new Set(
  'p.s. p.p.s. n.b. u.s. u.s.a. u.k. e.u. a.m. p.m. d.c. l.a. n.y. n.y.c. u.a.e. e.g. i.e.'.split(
    ' '
  )
)
/** A capitalised word: McDonald, O'Brien, Mary-Kate, JORDAN, Иван. */
const capitalised = /^\p{Lu}[\p{L}'’-]{1,24}$/u
/** Initials: J., A.J., J.R.R. */
const initials = /^(?:\p{Lu}\.){1,3}$/u
const openingChars = new Set(Array.from('("“«‘\'['))
const closingChars = new Set(Array.from(',;:!?.)"”»’\']'))
/** A token longer than this is no word of a name (a part is at most 25 letters). */
const maxTokenChars = 40

type Kind =
  'part' | 'initial' | 'calendar' | 'title' | 'particle' | 'surname' | 'stop'
type Token = {
  kind: Kind
  /** Where its word starts and ends in the line (punctuation outside). */
  start: number
  end: number
  norm: string
  /** Punctuation before it: a name starts here. */
  opens: boolean
  /** Punctuation after it: a name ends here. */
  closes: boolean
  /** It starts with a capital letter. */
  upper: boolean
}

function tokensOf(line: string): Token[] {
  const out: Token[] = []
  for (const m of line.matchAll(/\S+/g)) {
    const raw = m[0]
    const at = m.index ?? 0
    if (raw.length > maxTokenChars) {
      out.push({
        kind: 'stop',
        start: at,
        end: at + raw.length,
        norm: '',
        opens: false,
        closes: true,
        upper: false
      })
      continue
    }
    let lead = 0
    while (lead < raw.length && openingChars.has(raw[lead]!)) lead++
    let cut = raw.length
    while (cut > lead && closingChars.has(raw[cut - 1]!)) cut--
    let word = raw.slice(lead, cut)
    let tail = raw.slice(cut)
    // An initial's own full stop is its own ("A.J.", "P.S.").
    if (tail.startsWith('.') && initials.test(`${word}.`)) {
      word += '.'
      tail = tail.slice(1)
    }
    const norm = normWord(word)
    let kind: Kind = 'stop'
    if (abbreviations.has(word.toLowerCase())) kind = 'stop'
    else if (initials.test(word)) kind = 'initial'
    else if (capitalised.test(word)) {
      if (titleWords.has(norm)) {
        kind = 'title'
        // "Mrs." : the title's full stop does not end the name.
        if (tail.startsWith('.')) tail = tail.slice(1)
      } else if (surnameLike.has(norm)) kind = 'surname'
      else if (common.has(norm) || beforeLetter.has(norm)) kind = 'stop'
      else if (calendar.has(norm) || calendar.has(norm.replace(/'s$/, '')))
        kind = 'calendar'
      else kind = 'part'
    } else if (
      /^\p{Lu}$/u.test(word) &&
      word !== 'I' &&
      word !== 'A' &&
      !beforeLetter.has(out.at(-1)?.norm ?? '')
    )
      // "Jordan S": one capital next to a name part is an initial; never
      // the letter of a vitamin, a size or a plan.
      kind = 'initial'
    else if (particleWords.has(word)) kind = 'particle'
    const start = at + lead
    out.push({
      kind,
      start,
      end: start + word.length,
      norm,
      opens: lead > 0,
      closes: tail !== '',
      upper: /^\p{Lu}/u.test(word)
    })
  }
  return out
}

/** The tokens that may make a name together, split at anything else. */
function groupsOf(tokens: readonly Token[]) {
  const groups: { tokens: Token[]; next: Token | undefined }[] = []
  let current: Token[] = []
  const close = (next: Token | undefined) => {
    if (current.length) groups.push({ tokens: current, next })
    current = []
  }
  tokens.forEach((t, i) => {
    // "Jordan Little": a common word that is also a surname ends a name
    // right after a name's part; anywhere else it is a common word.
    if (t.kind === 'surname') {
      if (t.opens || current.at(-1)?.kind !== 'part') return close(t)
      current.push({ ...t, kind: 'part' })
      return close(tokens[i + 1])
    }
    if (t.kind === 'stop') return close(t)
    if (t.opens || t.kind === 'title') close(t)
    current.push(t)
    if (t.closes) close(tokens[i + 1])
  })
  close(undefined)
  return groups
}

const runOf = (tokens: readonly Token[]) => tokens.map((t) => t.norm).join(' ')
const counted = (t: Token) =>
  t.kind === 'part' || t.kind === 'initial' || t.kind === 'calendar'

/** The part of a group that is a person's name, or null. */
function nameIn(
  group: { tokens: Token[]; next: Token | undefined },
  own: OwnWords
): Token[] | null {
  const all = group.tokens
  let lo = 0
  let hi = all.length
  const trim = () => {
    while (lo < hi && all[lo]!.kind === 'particle') lo++
    while (hi > lo && all[hi - 1]!.kind === 'particle') hi--
  }
  trim()
  // "Vitamin D. Then": one capital that ends a sentence is no initial
  // ("Jordan S.:" or "Jordan S.," is one).
  const end = all[hi - 1]
  if (
    end?.kind === 'initial' &&
    end.norm.length === 1 &&
    !end.closes &&
    hi === all.length &&
    group.next?.upper
  ) {
    hi--
    trim()
  }
  if (lo >= hi) return null
  const run = (a: number, b: number) => runOf(all.slice(a, b))
  // The store's own words: the whole group, or a run of two or three at
  // either end ("Cedar Goods Co.", a product title).
  if (hi - lo <= 3 && ownHas(own, run(lo, hi))) return null
  for (let moved = true; moved && lo < hi;) {
    moved = false
    for (const n of [3, 2]) {
      if (hi - lo < n) continue
      if (ownHas(own, run(lo, lo + n))) {
        lo += n
        moved = true
        break
      }
      if (ownHas(own, run(hi - n, hi))) {
        hi -= n
        moved = true
        break
      }
    }
    trim()
  }
  if (lo >= hi) return null
  const title = all[lo]!.kind === 'title'
  let others = 0
  for (let i = lo; i < hi; i++)
    if (all[i]!.kind === 'part' || all[i]!.kind === 'initial') others++
  // Calendar words at the ends go while two other parts are left
  // ("Happy Mother's Day Jordan Sample" keeps the day).
  if (!title)
    while (lo < hi && all[lo]!.kind === 'calendar' && others >= 2) lo++
  while (hi > lo && all[hi - 1]!.kind === 'calendar' && others >= 2) hi--
  const name = all.slice(lo, hi)
  const parts = name.filter(counted)
  if (title) return parts.length >= 1 ? name : null
  if (parts.length < 2 || parts.every((x) => x.kind === 'calendar')) return null
  return name
}

/** Whether a line names someone (two name parts, a title and a name). */
export const hasName = (line: string, own: OwnWords) =>
  groupsOf(tokensOf(line)).some((g) => nameIn(g, own) !== null)

/** People's names out; the store's own words, the calendar and headings kept. */
export function withoutNames(line: string, own: OwnWords) {
  let out = ''
  let at = 0
  for (const g of groupsOf(tokensOf(line))) {
    const name = nameIn(g, own)
    if (!name) continue
    out += `${line.slice(at, name[0]!.start)}[name]`
    at = name.at(-1)!.end
  }
  return out + line.slice(at)
}
