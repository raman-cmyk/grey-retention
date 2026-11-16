import { z } from 'zod'
import { runAgent, type AgentDefinition } from '@/features/agents/runtime'
import {
  amount,
  factLines,
  customerWordsRules,
  oneLine,
  storeLink,
  writerData,
  writerRules,
  type CopyFeedback
} from '@/features/assembly/assemble'
import { eligibleProducts } from '@/features/assembly/inputs'
import { checkCopy, type QaRule } from '@/features/copy-qa/check'
import type { LockedContent } from '@/features/email-build/content'
import { rewriteRounds, strayPrices } from '@/features/email-build/inspect'
import { previewRepeat } from '@/features/email-build/preview-pair'
import {
  letterReading,
  readingRule
} from '@/features/email-build/reading-level'
import { keyPart, ruleWords } from '@/features/fallback/entry'
import type { FallbackLog } from '@/features/fallback/log'
import type { AgentCtx } from '@/features/strategy/retry'
import { letterProblems, type LetterProblem } from './checks'
import type { FounderVoice } from './voice/profile'
import {
  founderParagraphs,
  kindOf,
  kindProblems,
  kindRules,
  kindSpecs,
  placedNote,
  writerBody,
  type LetterKind
} from './kinds'
import {
  letterSchema,
  letterText,
  letterWords,
  offerLine,
  seenText,
  type Letter
} from './letter'

/**
 * TXT-001 part 2 (D26, AGENT_MAP §4 "Text emails"): the Letter writer
 * (AI, Flash) writes a text email as one short letter from the store: one
 * idea, a greeting, a few short paragraphs with one or two links on its
 * words, a sign-off and a P.S. Code gives it everything it may not
 * invent: the store's links (numbered), the name that signs (the
 * confirmed founder's, else the store's team), and the offer's line with
 * its code and end. Every answer is checked by code (the text checks and
 * copy QA's facts and discount rules), and its problems go back with the
 * exact reasons: the first letter and 3 rewrites (D21), then a shorter,
 * plainer letter that code writes from the store's name and product only,
 * logged (D16). Nothing waits for a person.
 */
export const letterWriterVersion = '2026-11-16.5'

export type LetterBrief = {
  /** The locked content: its products, offer, facts and founder. */
  locked: Pick<LockedContent, 'input' | 'offer'>
  brandName: string
  /** The store's home page (`BlockBrand.site`). */
  site: string
  /** DST-PIC #24: its kind (`letterKinds`), when the plan gives one. */
  kind?: LetterKind
  /** PIC-23 part 3b: how the founder writes, from their own sent emails. */
  voice?: FounderVoice
}

/**
 * PIC-23 part 3b: the founder's voice in the writer's data, in plain
 * words, and the rule that goes with it (none without a voice).
 */
const voiceData = (voice: FounderVoice) => ({
  ...(voice.greeting ? { greeting: voice.greeting } : {}),
  ...(voice.signoff ? { signoff: voice.signoff } : {}),
  ...(voice.writesAs ? { writesAs: voice.writesAs } : {}),
  wordsPerSentence: voice.sentenceWords,
  exclamationMarks: voice.exclamations,
  ...(voice.contractions ? { contractions: voice.contractions } : {}),
  examples: voice.examples
})
const voiceRules = (brief: LetterBrief) =>
  brief.voice
    ? [
        'Write the way the founder writes ("founderVoice", from their own emails): their greeting and sign-off when they fit the other rules, "I" or "we" as they write, sentences of about their length, exclamation marks and contractions as often as they use them. Its examples show how they sound: never copy one, and never take a fact from one.'
      ]
    : []

/** Store text as a letter shows it: one line, no hidden characters. */
const clean = (text: string, max: number) => oneLine(text, max)
/** "the Cedar candle", never "the The Cedar candle". */
export const theTitle = (title: string) =>
  /^the\s/i.test(title) ? title : `the ${title}`

/**
 * The letter's links, numbered from 1: the lead product's page, then the
 * store's home page (a valid site, else none: `storeLink`, as the designed
 * email's), each once.
 */
export function letterLinks(brief: LetterBrief) {
  const input = brief.locked.input
  const lead = eligibleProducts(input)[0]
  const home = storeLink(input, { site: brief.site })
  return [
    ...(lead
      ? [{ url: lead.url, about: `the page for ${clean(lead.title, 90)}` }]
      : []),
    ...(home && home !== lead?.url
      ? [{ url: home, about: 'the store’s home page' }]
      : [])
  ]
}

/** Who signs: the confirmed founder, else the store's team. */
export function letterSigner(brief: LetterBrief) {
  const founder = brief.locked.input.confirmed?.founder
  const name = clean(founder?.name ?? '', 80)
  const role = clean(founder?.role ?? '', 80)
  return name
    ? { signature: name, ...(role ? { role } : {}) }
    : { signature: clean(`The ${brief.brandName} team`, 80) }
}

const offerOf = (brief: LetterBrief): Letter['offer'] =>
  brief.locked.offer
    ? {
        code: brief.locked.offer.code,
        percent: brief.locked.offer.percent,
        ...(brief.locked.offer.ends ? { ends: brief.locked.offer.ends } : {})
      }
    : undefined

/** The shared writer rules a letter keeps (the rest are about blocks). */
const sharedRules = writerRules.filter((r) =>
  /^(The only percent|Never mention shipping|Never claim|No countdown|Never use a word|Everything under)/.test(
    r
  )
)

export const letterInstructions = [
  'You write one short personal email from a small store: a letter, as its founder or its team would write to a customer they know. Plain sentences: no headings, no lists, no banners, no marketing shouting.',
  `One idea, ${letterWords.min} to ${letterWords.max} words in the paragraphs and the P.S. together, in 2 to 5 short paragraphs.`,
  'Put one or two links on a few words inside a sentence of the paragraphs or the P.S., as [the words](1) for link 1 or [the words](2) for link 2 from "links": square brackets around the words, then the number in round brackets, nothing between. The subject, preview line, greeting and sign-off have no links. Never write a web or email address.',
  'Never write a price, a discount code or its end date: when there is an offer, the system adds its line after the letter. You may mention it in words.',
  'Name a product only by its title as given.',
  'A greeting such as "Hi there," (never a name), a sign-off such as "Warmly,", and a P.S. that adds one small thing. Leave greeting or ps empty only when they do not fit. The name that signs is added by the system: never sign.',
  'For the inbox: a subject of at most 60 characters with no word in capitals and at most one exclamation mark; a preview line of 20 to 140 characters that says what the subject does not and never repeats it (the brand’s name may be in both; name a product in one of them only). Never a spam word such as "act now", "click here", "risk-free" or "winner".',
  'Invite a reply when it fits: replies reach a person.',
  'Never write { or }.',
  ...sharedRules
]

const str = (max: number) => ({ type: 'string', maxLength: max })
export const letterAnswerSchema = {
  name: 'letter',
  definition: {
    type: 'object',
    additionalProperties: false,
    required: ['subject', 'preheader', 'greeting', 'body', 'signoff', 'ps'],
    properties: {
      subject: str(120),
      preheader: str(200),
      greeting: str(80),
      body: { type: 'array', minItems: 1, maxItems: 8, items: str(1500) },
      signoff: str(60),
      ps: str(400)
    }
  }
}
const answerShape = z.strictObject({
  subject: z.string(),
  preheader: z.string(),
  greeting: z.string(),
  body: z.array(z.string()).min(1).max(8),
  signoff: z.string(),
  ps: z.string()
})
export type LetterAnswer = z.infer<typeof answerShape>

type LetterTask = { brief: LetterBrief; feedback: CopyFeedback[] }

/** The Letter writer for one brief (the customers' own words when it has them, ONB-061). */
export const letterWriter = (
  brief: LetterBrief,
  /** The store's industry: its reading level (DST-PIC #28). */
  industry: string | null = null
): AgentDefinition<LetterTask, LetterAnswer> => ({
  name: 'letter-writer',
  version: letterWriterVersion,
  purpose: 'copy',
  instructions: [
    ...letterInstructions,
    ...customerWordsRules(brief.locked.input),
    // DST-PIC #24: the kind's own rules, with their numbers, when it fits.
    ...kindRules(brief),
    // PIC-23 part 3b: the founder's own voice, when their emails show it.
    ...voiceRules(brief),
    // DST-PIC #28: the industry’s reading level.
    readingRule(industry)
  ].join('\n'),
  task: ({ brief, feedback }) =>
    writerData(
      brief.locked.input,
      {
        // The letter's own: the links by number, and the offer in words.
        links: letterLinks(brief).map((l, i) => `${i + 1}: ${l.about}`),
        offer: brief.locked.offer
          ? `${brief.locked.offer.percent}% off, with a code the system adds after the letter`
          : null,
        signedBy: letterSigner(brief).signature,
        ...(kindOf(brief) ? { kind: kindSpecs[kindOf(brief)!].name } : {}),
        // The founder's own words, placed by the system (never the writer's).
        ...(placedNote(brief) ? { founderNote: placedNote(brief) } : {}),
        ...(brief.voice ? { founderVoice: voiceData(brief.voice) } : {})
      },
      feedback
    ),
  schema: letterAnswerSchema,
  output: answerShape,
  maxOutputTokens: 2_000,
  temperature: 0.7,
  reasoningEffort: 'low',
  usesBrandBook: true
})

/** The writer's answer as a letter, with what code gives it. */
export function letterFrom(answer: LetterAnswer, brief: LetterBrief) {
  const opt = (s: string) => (s.trim() ? s : undefined)
  const offer = offerOf(brief)
  // A founder note: the founder's own note after the first paragraph.
  const note = placedNote(brief)
  return letterSchema.safeParse({
    subject: answer.subject,
    preheader: answer.preheader,
    greeting: opt(answer.greeting),
    body: note
      ? [...answer.body.slice(0, 1), ...note, ...answer.body.slice(1)]
      : answer.body,
    signoff: answer.signoff,
    ...letterSigner(brief),
    ps: opt(answer.ps),
    ...(offer ? { offer } : {}),
    links: letterLinks(brief).map((l) => ({ url: l.url }))
  })
}

/** Everything code finds wrong with a letter, by rule. */
export function letterFindings(
  letter: Letter,
  brief: LetterBrief
): LetterProblem[] {
  const input = brief.locked.input
  // The founder's placed note is the founder's own words, checked on its
  // own before it is placed (`founderNote`), never the writer's.
  const note = placedNote(brief) ?? []
  const parts = [
    letter.greeting ?? '',
    ...writerBody(letter, brief),
    letter.offer ? offerLine(letter.offer) : '',
    letter.signoff,
    letter.ps ?? ''
  ]
  const qa = checkCopy({
    draft: {
      subject: letter.subject,
      preview: letter.preheader,
      blocks: parts
        .map((text, i) => ({ id: `part-${i + 1}`, text: seenText(text) }))
        .filter((b) => b.text)
    },
    facts: input.facts,
    maxDiscountPercent: input.maxDiscountPercent,
    codes: [...input.codes],
    productNames: [...input.products.map((p) => p.title), brief.brandName],
    sendAt: input.sendAt
  })
  // The store's own words are never the writer's to change: its name, its
  // titles and the name that signs, as stored and as the letter shows them.
  const signer = letterSigner(brief)
  const own = [
    brief.brandName,
    ...input.products.map((p) => p.title),
    signer.signature,
    ...(signer.role ? [signer.role] : []),
    ...note
  ].flatMap((t) => [t, clean(t, 2_000)])
  // Prices are the system's (ASM-001): one the writer writes must be a
  // locked product's own.
  const prices = new Set(
    input.products
      .map((p) => amount(p.price))
      .filter((n): n is number => n !== null)
  )
  const stray = [
    ...new Set(
      [letter.subject, letter.preheader, ...parts]
        .map((t) => seenText(t))
        .flatMap((t) => strayPrices(maskOwn(t, own), prices))
    )
  ]
  // DST-PIC #27: the preview pairs with the subject, never repeats it.
  const repeat = previewRepeat(
    letter.subject,
    letter.preheader,
    brief.brandName
  )
  return [
    ...letterProblems(letter, own),
    ...(repeat ? [{ rule: 'preview_repeats_subject', reason: repeat }] : []),
    ...qa.failures.map((f) => ({ rule: f.rule, reason: f.reason })),
    ...(stray.length
      ? [
          {
            rule: 'wrong_price',
            reason: `${stray
              .slice(0, 3)
              .map((p) => `“${p}”`)
              .join(', ')} is not a product's price: never write a price.`
          }
        ]
      : [])
  ]
}

/** `text` with the store's own words blanked out. */
function maskOwn(text: string, own: readonly string[]) {
  let out = text
  for (const t of [...own].sort((a, b) => b.length - a.length))
    if (t.trim().length >= 2) out = out.split(t).join(' ')
  return out
}

/**
 * The plain letter (no AI): from the store's name, its lead product's
 * title and the locked offer only, never the brief, the angle or a claim.
 * Its links are on fixed words, so no store text ever sits in a mark, and
 * store text with markup stays out of the subject and preview.
 */
export function plainLetter(brief: LetterBrief): Letter {
  const lead = eligibleProducts(brief.locked.input)[0]
  const links = letterLinks(brief)
  const brand = clean(brief.brandName, 80)
  const safe = (t: string) => (t && !/[{}<>]/.test(t) ? t : null)
  const inbox = safe(brand)
  const title = lead ? clean(lead.title, 90) : ''
  const subject = [
    ...(lead && safe(title) ? [`A short note about ${theTitle(title)}`] : []),
    ...(inbox ? [`A short note from ${inbox}`] : []),
    'A short note from us'
  ].find((t) => t.length <= 60)!
  const offer = offerOf(brief)
  const look = links.length
    ? lead
      ? 'When you have a quiet minute, [take a look](1) and see whether it suits you.'
      : 'When you have a quiet minute, [take a look at the shop](1) and see whether something suits you.'
    : 'When you have a quiet minute, have a look at the shop and see whether something suits you.'
  return letterSchema.parse({
    subject,
    preheader: inbox
      ? `Written to you directly, from all of us at ${inbox}.`.slice(0, 140)
      : 'Written to you directly, from all of us.',
    greeting: 'Hi there,',
    body: [
      `This is a short note from all of us at ${brand}, sent as a plain letter rather than our usual email.`,
      lead ? `We wanted to share ${theTitle(title)} with you. ${look}` : look,
      'If you have a question about it, or about anything else, just reply to this email. Your reply comes straight to our inbox, and a person reads it.',
      `Thank you for being part of ${brand}. It means a lot to us.`
    ],
    signoff: 'Warmly,',
    ...letterSigner(brief),
    ps:
      links.length > 1
        ? 'Everything else we make is [in the shop](2).'
        : 'You can always reply to this email with a question.',
    ...(offer ? { offer } : {}),
    links: links.map((l) => ({ url: l.url }))
  })
}

export type LetterResult =
  | { status: 'written'; letter: Letter; tries: number; runId?: string }
  | { status: 'plain'; letter: Letter; tries: number; runId?: string }
  | { status: 'failed'; tries: number; runId?: string }

/** AI failures a later try could fix (as the copy rounds have them). */
const busy = new Set([
  'rate_limited',
  'unavailable',
  'timeout',
  'ledger_unavailable'
])

/**
 * Why the letter fell back, by reason code (REL-084b: the owner's log
 * says the AI's own failures plainly, by `letter_` + `tryAgent`'s codes;
 * the rest are fixed words, never the letter's).
 */
const causes = {
  check_failed: 'The letter still failed the checks after every rewrite.',
  answer_invalid: 'The Letter writer kept answering in the wrong shape.',
  agent_failed:
    'The Letter writer could not answer (AI unavailable or the allowance is used up).',
  ai_busy: 'The AI was busy or could not be reached.',
  out_of_time: 'There was no time for another try in this step.'
} as const
type Cause = keyof typeof causes

/** The letter's own rules in fixed words, for the owner's log. */
const letterRuleWords: Record<string, string> = {
  letter_too_short: 'a letter too short',
  letter_too_long: 'a letter too long',
  reading_level: 'words too hard to read',
  too_many_links: 'too many links',
  unknown_link: 'a link the letter does not have',
  empty_link: 'a link on no words',
  broken_link: 'a broken link',
  link_outside_letter: 'a link outside the paragraphs',
  empty_ps: 'an empty P.S.',
  hidden_characters: 'hidden characters',
  address_in_text: 'a web or email address in the words',
  template_marks: 'Klaviyo’s { } marks',
  spam_words: 'spam words',
  subject_too_long: 'a subject too long',
  subject_markup: 'markup in the subject',
  subject_shouting: 'a shouting subject',
  preview_length: 'a preview line of the wrong length',
  preview_markup: 'markup in the preview line',
  preview_repeats_subject: 'a preview line that repeats the subject',
  kind_length: 'a length its kind does not have',
  kind_links: 'more links than its kind has',
  kind_offer: 'an offer its kind never has',
  kind_first_person: 'a founder note not in the first person',
  kind_note_quoted: 'the founder’s note repeated',
  kind_paragraphs: 'too many paragraphs around the founder’s note',
  kind_question: 'a quick question with no question',
  kind_questions: 'more than one question',
  kind_guilt: 'words that make the reader feel guilty',
  kind_thanks: 'a thank-you that does not thank',
  kind_first_link: 'a link before the thanks',
  wrong_price: 'a price that is not the product’s',
  subject_taken: 'a subject another email of the plan has'
}
const wordsFor = (rules: readonly string[]) =>
  rules
    .map(
      (r) =>
        letterRuleWords[r] ??
        (Object.hasOwn(ruleWords, r) ? ruleWords[r as QaRule] : 'a check')
    )
    .filter((w, i, all) => all.indexOf(w) === i)
    .join(', ')

/** A zod issue on the letter in words the writer can act on. */
function partReason(issue: z.core.$ZodIssue) {
  if (issue.code === 'too_big' && typeof issue.maximum === 'number')
    return issue.origin === 'array'
      ? `Keep it to ${issue.maximum} paragraphs or fewer.`
      : `Keep it to ${issue.maximum} characters or fewer.`
  if (issue.code === 'too_small') return 'Never leave it empty.'
  return 'Write it as plain words.'
}

/**
 * Writes the letter: the first try and up to 3 rewrites, each told the
 * exact problems with the last two (so a fix for one never undoes
 * another); then the plain letter, logged once.
 */
export async function writeLetter(
  brief: LetterBrief,
  ctx: AgentCtx & { fallbacks: FallbackLog; campaignId?: string | null },
  /** More code checks of a written letter (REL-AI: the plan's other subjects). */
  checks: (letter: Letter) => LetterProblem[] = () => []
): Promise<LetterResult> {
  const rounds: { rules: string[]; feedback: CopyFeedback[] }[] = []
  let cause: Cause = 'check_failed'
  let tries = 0
  let runId: string | undefined
  const writer = letterWriter(brief, ctx.industry)
  // A code in a reason (copy QA's "Use exactly: …") is never given back.
  const codes = brief.locked.input.codes.map((c) => c.code).filter(Boolean)
  const noCodes = (text: string) =>
    codes.reduce((t, c) => t.split(c).join('the code'), text)
  for (let round = 0; round <= rewriteRounds; round++) {
    if (round > 0 && ctx.fits && !ctx.fits()) {
      cause = 'out_of_time'
      break
    }
    tries++
    const feedback = rounds
      .slice(-2)
      .flatMap((r) => r.feedback)
      .slice(0, 20)
    const result = await runAgent(writer, { brief, feedback }, ctx)
    runId = result.runId
    if (!result.ok) {
      if (result.code !== 'invalid_output') {
        cause = busy.has(result.code) ? 'ai_busy' : 'agent_failed'
        break
      }
      cause = 'answer_invalid'
      rounds.push({
        rules: ['answer_shape'],
        feedback: [
          {
            field: 'letter',
            reason: 'The answer did not match the required JSON shape.'
          }
        ]
      })
      continue
    }
    // A founder note: the writer's own paragraphs go around the note.
    if (placedNote(brief) && result.output.body.length > founderParagraphs) {
      cause = 'check_failed'
      rounds.push({
        rules: ['kind_paragraphs'],
        feedback: [
          {
            field: 'body',
            reason: `Write at most ${founderParagraphs} paragraphs of your own: the founder’s note goes between them.`
          }
        ]
      })
      continue
    }
    const letter = letterFrom(result.output, brief)
    if (!letter.success) {
      cause = 'check_failed'
      rounds.push({
        rules: ['part_invalid'],
        feedback: letter.error.issues.slice(0, 5).map((i) => ({
          field: i.path.join(' ') || 'letter',
          reason: partReason(i)
        }))
      })
      continue
    }
    const found = [
      ...checks(letter.data),
      ...letterFindings(letter.data, brief),
      // DST-PIC #24: its kind's rules (the plain letter has no kind).
      ...kindProblems(letter.data, brief),
      // DST-PIC #28: the industry's reading level (the writer's words).
      ...letterReading(
        // The writer's words only: never the founder's placed note.
        [
          ...writerBody(letter.data, brief),
          ...letterText(letter.data).slice(letter.data.body.length)
        ].map(seenText),
        ctx.industry,
        [
          brief.brandName,
          ...brief.locked.input.products.map((p) => p.title),
          ...factLines(brief.locked.input.facts).map((f) =>
            f.replace(/[.!?]$/, '')
          )
        ].flatMap((t) => [t, clean(t, 2_000)])
      )
    ]
    if (!found.length)
      return { status: 'written', letter: letter.data, tries, runId }
    cause = 'check_failed'
    rounds.push({
      rules: [...new Set(found.map((f) => f.rule))],
      feedback: found.map((f) => ({ field: f.rule, reason: noCodes(f.reason) }))
    })
  }
  const plain = plainLetter(brief)
  const plainRules = [
    ...new Set(letterFindings(plain, brief).map((f) => f.rule))
  ]
  const usable = !plainRules.length
  const last = rounds.at(-1)?.rules ?? []
  await ctx.fallbacks.record({
    tenantId: ctx.tenantId,
    campaignId: ctx.campaignId ?? null,
    agent: 'letter-writer',
    reasonCode: usable ? `letter_${cause}` : 'letter_failed',
    reason: usable
      ? cause === 'check_failed' && last.length
        ? `${causes.check_failed.slice(0, -1)}: ${wordsFor(last)}.`
        : causes[cause]
      : `The plain letter failed the checks too: ${wordsFor(plainRules)}.`,
    fallback: usable
      ? 'Used the plain letter: the store’s name, its product and its offer only.'
      : 'No email was built; the owner can create it again.',
    attempts: Math.min(tries, 10),
    detail: {
      cause,
      rules: last.slice(0, 20),
      ...(usable ? {} : { plainRules: plainRules.slice(0, 20) }),
      ...(runId ? { runId } : {})
    },
    dedupeKey: `letter-writer:${keyPart(ctx.callerKey)}`
  })
  return usable
    ? { status: 'plain', letter: plain, tries, runId }
    : { status: 'failed', tries, runId }
}
