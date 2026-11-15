import { checkCopy } from '@/features/copy-qa/check'
import {
  copyDraftOf,
  hiddenChars,
  type Draft
} from '@/features/assembly/assemble'
import type { FallbackEntry } from '@/features/fallback/entry'
import { footerProblems, preflight } from '@/features/klaviyo-push/html'
import { emailLinks } from '@/features/release-qa/checks'
import type { BuiltEmail, SectionsOutput } from '../build'
import type { Store } from '../ports'
import { goldenCodes, type GoldenBrief } from './briefs'

/**
 * REL-EVL: what every golden email must be, as plain problems (empty
 * means it passed). The checks judge the email as drawn (the HTML and the
 * words a reader sees), not only the fields stored with it, and fit any
 * model's emails, so a later run on a live model (with the owner's OK)
 * can be scored the same way.
 */

export type GoldenRun = {
  result:
    { ok: true; email: BuiltEmail; draft: Draft } | { ok: false; code: string }
  store: Store
  /** The offer rules and send time the first step saved. */
  sections: Pick<SectionsOutput, 'rules' | 'sendAt'> | null
  fallbacks: readonly FallbackEntry[]
}

/** Text a broken template or a model's filler would leave behind. */
const junk = [
  /\bundefined\b/i,
  /\bNaN\b/,
  /\[object Object\]/,
  /synthetic provider/i,
  /lorem ipsum/i,
  /\bnull\b/
]
const markup = /[<>]|\{\{|\{%|%\}|\}\}/
/** Klaviyo's own footer tags: the only template tags an email may carry. */
const klaviyoTag = /\{\{\s*organization\.\w+\s*\}\}|\{%[^%]*%\}/g

const named: Record<string, string> = {
  amp: '&',
  nbsp: ' ',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  rarr: '→',
  middot: '·',
  zwnj: ''
}

/** What a reader sees: the visible text, entities read, one space. */
export function visibleText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16))
    )
    .replace(/&([a-z]+);/gi, (m, name: string) => named[name] ?? m)
    .replace(new RegExp(hiddenChars.source, 'g'), '')
    .replace(/͏/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}
const pathOf = (url: string) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/'
  } catch {
    return null
  }
}
/** The store's own host, with or without "www." (as release QA allows). */
const sameHost = (url: string, site: string) => {
  const host = hostOf(url)?.replace(/^www\./, '')
  return !!host && host === hostOf(site)?.replace(/^www\./, '')
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** `phrase` as whole words, any case. */
const says = (text: string, phrase: string) =>
  new RegExp(`(?<![\\p{L}\\d])${escapeRe(phrase)}(?![\\p{L}\\d])`, 'iu').test(
    text
  )

/** Problems with one line of the email the reader sees first. */
function lineProblems(name: string, value: string, max: number) {
  const out: string[] = []
  if (!value.trim()) out.push(`The ${name} is empty.`)
  if (value.length > max) out.push(`The ${name} is over ${max} characters.`)
  if (value !== value.trim()) out.push(`The ${name} has spaces at its ends.`)
  if (markup.test(value)) out.push(`The ${name} has markup or a template tag.`)
  if (hiddenChars.test(value)) out.push(`The ${name} has hidden characters.`)
  for (const j of junk)
    if (j.test(value)) out.push(`The ${name} has "${j.source}" in it.`)
  return out
}

export function goldenProblems(brief: GoldenBrief, run: GoldenRun): string[] {
  const { expect } = brief
  const problems: string[] = []
  // Every code the owner ever had, working or not, and the run's own.
  const codes = [
    ...new Set(
      [...goldenCodes, ...(run.sections?.rules.codes ?? []).map((c) => c.code)]
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean)
    )
  ]
  // Never a discount code in the admins' log (REL-OFF), built or not.
  const logged = JSON.stringify(run.fallbacks).toUpperCase()
  for (const c of codes)
    if (logged.includes(c))
      problems.push(`The fallback log names the code ${c}.`)
  if (!run.result.ok) {
    problems.push(`The build stopped as ${run.result.code}.`)
    return problems
  }
  const { email, draft } = run.result
  const { store } = run
  const html = email.html
  const drawn = visibleText(html)
  const words = drawn.replace(klaviyoTag, ' ')
  const seen = `${email.subject}\n${email.preheader}\n${words}`
  const featured = email.productIds.flatMap((id) => {
    const p = store.products.find((x) => x.id === id)
    return p ? [p] : []
  })
  // Store text the email may print as it is: names, prices, approved claims.
  const storeText = [
    ...store.products.map((p) => p.title),
    ...featured.map((p) => p.price),
    ...store.facts.approvedClaims,
    store.brand.name
  ]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const own = storeText.reduce(
    (t, s) => t.replace(new RegExp(escapeRe(s), 'gi'), ' '),
    seen
  )

  // The lines in the inbox.
  problems.push(...lineProblems('subject', email.subject, 80))
  problems.push(...lineProblems('preview text', email.preheader, 140))
  if (email.subject !== draft.subject || email.preheader !== draft.preheader)
    problems.push('The stored subject or preview is not the checked one.')
  for (const j of junk)
    if (j.test(words)) problems.push(`The email has "${j.source}" in it.`)
  if (markup.test(words))
    problems.push('The email shows markup or a template tag.')

  // What it says, as drafted and as drawn: the facts, banned words, codes.
  const rules = run.sections?.rules
  const qa = (text: Parameters<typeof checkCopy>[0]['draft'], where: string) =>
    checkCopy({
      draft: text,
      facts: store.facts,
      maxDiscountPercent: rules?.maxDiscountPercent ?? 0,
      codes: [...(rules?.codes ?? [])],
      productNames: store.products.map((p) => p.title),
      sendAt: email.plannedSendAt
    }).failures.map(
      (f) => `Copy check (${f.rule}) on ${where}${f.field}: ${f.reason}`
    )
  problems.push(...qa(copyDraftOf(draft), ''))
  problems.push(
    ...qa(
      { subject: '', preview: '', blocks: [{ id: 'all', text: own }] },
      'the drawn email, '
    )
  )
  for (const word of [
    ...store.facts.bannedPhrases,
    ...(expect.notInEmail ?? [])
  ])
    if (word.trim().length >= 2 && says(seen, word.trim()))
      problems.push(`The email says "${word.trim()}".`)

  // The offer: exactly the expected code at its percent; every percent
  // and price the email prints is that offer's or a featured product's.
  const percents = [...own.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((m) =>
    Number(m[1].replace(',', '.'))
  )
  if (/[$€£]\s?\d[\d.,]*\s*off(?![-\w])/i.test(own))
    problems.push('It promises money off.')
  if (expect.code === null) {
    if (email.code !== null) problems.push(`It carries ${email.code}.`)
    if (percents.length) problems.push(`It shows ${percents[0]}%.`)
  } else {
    const { code, percent, ends } = expect.code
    if (email.code?.toUpperCase() !== code.toUpperCase())
      problems.push(`It carries ${email.code}, not ${code}.`)
    if (email.offer?.percent !== percent)
      problems.push(`Its stored offer is not ${percent}% off.`)
    if (!html.toUpperCase().includes(code.toUpperCase()))
      problems.push(`The code ${code} is not shown.`)
    if (!new RegExp(`(?<!\\d)${percent}\\s*% off`, 'i').test(own))
      problems.push(`It does not show ${percent}% off.`)
    for (const p of new Set(percents))
      if (p !== percent) problems.push(`It shows ${p}%, not ${percent}%.`)
    if (ends && !drawn.includes(ends))
      problems.push(`It does not say "${ends}".`)
  }
  const shown = `${html}\n${seen}`
  for (const c of codes)
    if (c !== email.code?.toUpperCase() && says(shown, c))
      problems.push(`It shows ${c}, a code it does not carry.`)
  for (const m of own.matchAll(/[$€£]\s?\d[\d,]*(?:\.\d+)?/g))
    problems.push(`It prints ${m[0]}, not a featured product's price.`)

  // The products.
  const byId = new Map(store.products.map((p) => [p.id, p]))
  const links = emailLinks(html)
  if (new Set(email.productIds).size !== email.productIds.length)
    problems.push('A product is featured twice.')
  for (const id of email.productIds) {
    const p = byId.get(id)
    if (!p) problems.push(`It features ${id}, which is not in the store.`)
    else if (!p.featurable) problems.push(`It features ${p.title}, sold out.`)
    else if (
      !links.some((l) => sameHost(l, p.url) && pathOf(l) === pathOf(p.url))
    )
      problems.push(`${p.title} is featured but not linked.`)
  }
  if (expect.lead && email.productIds[0] !== expect.lead)
    problems.push(`It leads with ${email.productIds[0]}, not ${expect.lead}.`)
  for (const id of expect.features ?? [])
    if (!email.productIds.includes(id)) problems.push(`It leaves out ${id}.`)
  for (const id of expect.never ?? []) {
    const p = byId.get(id)
    if (
      email.productIds.includes(id) ||
      [id, p?.url, p?.image].some((s) => !!s && html.includes(s)) ||
      (p && says(seen, p.title))
    )
      problems.push(`It features ${id}.`)
  }
  const changes = [...email.changes].sort().join(', ')
  if (changes !== [...(expect.changes ?? [])].sort().join(', '))
    problems.push(`Its changes are: ${changes || 'none'}.`)

  // The email itself, as the push checks it (the five footer tags, size,
  // pictures it can import), linked only to the store, safe to draw.
  problems.push(...footerProblems(html))
  const stop = preflight([html], 'GoldenList1')
  if (stop) problems.push(`The push would refuse it: ${stop.reason}.`)
  if (!links.length) problems.push('It has no link to the store.')
  for (const href of links)
    if (!/^https:\/\//i.test(href) || !sameHost(href, store.brand.site))
      problems.push(`It links to ${href}, not the store.`)
  for (const img of html.match(/<img\b[^>]*>/gi) ?? []) {
    const alt = /\salt\s*=\s*"([^"]*)"/i.exec(img)
    if (!alt || !alt[1].trim()) problems.push('An image has no alt text.')
  }
  if (/<script\b/i.test(html) || /<[^>]*\son[a-z]+\s*=/i.test(html))
    problems.push('It has a script or an event handler.')
  // Names drawn as text: "&" escaped, never a raw tag from a name.
  if (/&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/i.test(html))
    problems.push('It has an unescaped "&".')

  // What the screen says about it, and where it goes.
  if (email.sample !== store.sample)
    problems.push('It does not say whether it used the sample store.')
  if (email.plannedSendAt !== expect.sendAt)
    problems.push(`It sends at ${email.plannedSendAt}, not ${expect.sendAt}.`)
  if (email.audienceId !== brief.planned.audience.id)
    problems.push('It goes to another audience.')
  if (email.copy === 'written' && !email.ai)
    problems.push('Its words are written but it does not say the AI wrote it.')
  return problems
}
