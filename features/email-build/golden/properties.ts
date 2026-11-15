import { checkCopy } from '@/features/copy-qa/check'
import {
  copyDraftOf,
  hiddenChars,
  type Draft
} from '@/features/assembly/assemble'
import type { FallbackEntry } from '@/features/fallback/entry'
import { emailLinks, gmailClipBytes } from '@/features/release-qa/checks'
import { localTimeCandidates } from '@/lib/local-time'
import type { BuiltEmail, SectionsOutput } from '../build'
import type { Store } from '../ports'
import type { GoldenBrief } from './briefs'

/**
 * REL-EVL: what every golden email must be, as plain problems (empty
 * means it passed). The same checks fit any model's emails, so a later
 * run on a live model (with the owner's OK) can score its emails the
 * same way.
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
const textOf = (html: string) =>
  html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

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
  const codes = run.sections?.rules.codes ?? []
  // Never a discount code in the admins' log (REL-OFF), built or not.
  const logged = JSON.stringify(run.fallbacks).toUpperCase()
  for (const c of codes)
    if (logged.includes(c.code.toUpperCase()))
      problems.push(`The fallback log names the code ${c.code}.`)
  if (!run.result.ok) {
    problems.push(`The build stopped as ${run.result.code}.`)
    return problems
  }
  const { email, draft } = run.result
  const { store } = run
  const html = email.html
  const text = textOf(html)
  const seen = `${email.subject}\n${email.preheader}\n${text}`.toLowerCase()

  // The lines in the inbox.
  problems.push(...lineProblems('subject', email.subject, 80))
  problems.push(...lineProblems('preview text', email.preheader, 140))
  if (email.subject !== draft.subject || email.preheader !== draft.preheader)
    problems.push('The stored subject or preview is not the checked one.')
  for (const j of junk)
    if (j.test(text)) problems.push(`The email has "${j.source}" in it.`)

  // What it says: the brand's facts, its banned words, its codes.
  const copy = checkCopy({
    draft: copyDraftOf(draft),
    facts: store.facts,
    maxDiscountPercent: run.sections?.rules.maxDiscountPercent ?? 0,
    codes: [...codes],
    productNames: store.products.map((p) => p.title),
    sendAt: email.plannedSendAt
  })
  for (const f of copy.failures)
    problems.push(`Copy check (${f.rule}) on ${f.field}: ${f.reason}`)
  for (const word of expect.notInEmail ?? [])
    if (seen.includes(word.toLowerCase()))
      problems.push(`The email says "${word}".`)

  // The offer.
  if (expect.code === null) {
    if (email.code !== null) problems.push(`It carries ${email.code}.`)
    if (/\d+\s*%\s*off/i.test(seen)) problems.push('It promises a % off.')
  } else {
    if (email.code !== expect.code.code)
      problems.push(`It carries ${email.code}, not ${expect.code.code}.`)
    if (email.offer?.percent !== expect.code.percent)
      problems.push(`Its offer is not ${expect.code.percent}% off.`)
    if (!html.includes(expect.code.code))
      problems.push(`The code ${expect.code.code} is not shown.`)
  }
  for (const c of codes)
    if (c.code !== email.code && html.toUpperCase().includes(c.code))
      problems.push(`It shows ${c.code}, a code it does not carry.`)

  // The products.
  const byId = new Map(store.products.map((p) => [p.id, p]))
  if (new Set(email.productIds).size !== email.productIds.length)
    problems.push('A product is featured twice.')
  for (const id of email.productIds) {
    const p = byId.get(id)
    if (!p) problems.push(`It features ${id}, which is not in the store.`)
    else if (!p.featurable) problems.push(`It features ${p.title}, sold out.`)
    else if (!emailLinks(html).includes(p.url))
      problems.push(`${p.title} is featured but not linked.`)
  }
  if (expect.lead && email.productIds[0] !== expect.lead)
    problems.push(`It leads with ${email.productIds[0]}, not ${expect.lead}.`)
  for (const id of expect.features ?? [])
    if (!email.productIds.includes(id)) problems.push(`It leaves out ${id}.`)
  for (const id of expect.never ?? [])
    if (email.productIds.includes(id) || html.includes(id))
      problems.push(`It features ${id}.`)

  // The email itself: small enough, linked to the store, the footer tags.
  if (Buffer.byteLength(html, 'utf8') >= gmailClipBytes)
    problems.push('It is too big for Gmail.')
  const site = hostOf(store.brand.site)
  const links = emailLinks(html)
  if (!links.length) problems.push('It has no link to the store.')
  for (const href of links)
    if (!/^https:\/\//i.test(href) || hostOf(href) !== site)
      problems.push(`It links to ${href}, not the store.`)
  if (!/\{%\s*unsubscribe\b/.test(html))
    problems.push('The unsubscribe link is missing.')
  if (!/\{\{\s*organization\.full_address\s*\}\}/.test(html))
    problems.push('The store address is missing.')
  for (const img of html.match(/<img\b[^>]*>/gi) ?? [])
    if (!/\salt\s*=\s*(["'])[^"']*\S[^"']*\1/i.test(img))
      problems.push('An image has no alt text.')
  if (/<script\b|\son[a-z]+\s*=/i.test(html))
    problems.push('It has a script or an event handler.')
  // Names drawn as text: "&" escaped, never a raw tag from a name.
  if (/&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/i.test(html))
    problems.push('It has an unescaped "&".')

  // What the screen says about it.
  if (email.sample !== store.sample)
    problems.push('It does not say whether it used the sample store.')
  const sendAt = localTimeCandidates(
    `${brief.planned.date}T${brief.planned.time}`,
    store.timezone
  )[0]
  if (email.plannedSendAt !== sendAt)
    problems.push(`It sends at ${email.plannedSendAt}, not ${sendAt}.`)
  if (email.audienceId !== brief.planned.audience.id)
    problems.push('It goes to another audience.')
  if (email.copy === 'written' && !email.ai)
    problems.push('Its words are written but it does not say the AI wrote it.')
  return problems
}
