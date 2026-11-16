import { z } from 'zod'
import { runAgent, type AgentDefinition } from '@/features/agents/runtime'
import {
  customerWordsRules,
  writerData,
  writerRules,
  type CopyFeedback
} from '@/features/assembly/assemble'
import { eligibleProducts } from '@/features/assembly/inputs'
import { checkCopy } from '@/features/copy-qa/check'
import type { LockedContent } from '@/features/email-build/content'
import { rewriteRounds } from '@/features/email-build/inspect'
import { keyPart } from '@/features/fallback/entry'
import type { FallbackLog } from '@/features/fallback/log'
import type { AgentCtx } from '@/features/strategy/retry'
import { letterProblems, type LetterProblem } from './checks'
import {
  letterSchema,
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
export const letterWriterVersion = '2026-11-16.1'

export type LetterBrief = {
  /** The locked content: its products, offer, facts and founder. */
  locked: Pick<LockedContent, 'input' | 'offer'>
  brandName: string
  /** The store's home page (`BlockBrand.site`). */
  site: string
}

/** The letter's links, numbered from 1: the lead product's page, then the store. */
export function letterLinks(brief: LetterBrief) {
  const lead = eligibleProducts(brief.locked.input)[0]
  return [
    ...(lead ? [{ url: lead.url, about: `the ${lead.title} page` }] : []),
    { url: brief.site, about: 'the store’s home page' }
  ]
}

/** Who signs: the confirmed founder, else the store's team. */
export function letterSigner(brief: LetterBrief) {
  const founder = brief.locked.input.confirmed?.founder
  return founder?.name.trim()
    ? {
        signature: founder.name.trim().slice(0, 80),
        ...(founder.role?.trim()
          ? { role: founder.role.trim().slice(0, 80) }
          : {})
      }
    : { signature: `The ${brief.brandName} team`.slice(0, 80) }
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
  'A greeting such as "Hi there," (never a name), a sign-off such as "Warmly,", and a P.S. that adds one small thing. Leave greeting or ps empty only when they do not fit. The name that signs is added by the system: never sign.',
  'For the inbox: a subject of at most 60 characters with no word in capitals and at most one exclamation mark; a preview line of 20 to 140 characters that adds to the subject. Never a spam word such as "act now", "click here", "risk-free" or "winner".',
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
  brief: LetterBrief
): AgentDefinition<LetterTask, LetterAnswer> => ({
  name: 'letter-writer',
  version: letterWriterVersion,
  purpose: 'copy',
  instructions: [
    ...letterInstructions,
    ...customerWordsRules(brief.locked.input)
  ].join('\n'),
  task: ({ brief, feedback }) =>
    writerData(
      brief.locked.input,
      {
        // The letter's own: the links by number, and the offer in words.
        links: letterLinks(brief).map((l, i) => `${i + 1}: ${l.about}`),
        offer: brief.locked.offer
          ? `${brief.locked.offer.percent}% off with the client's code`
          : null,
        signedBy: letterSigner(brief).signature
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
  return letterSchema.safeParse({
    subject: answer.subject,
    preheader: answer.preheader,
    greeting: opt(answer.greeting),
    body: answer.body,
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
  const parts = [
    letter.greeting ?? '',
    ...letter.body,
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
  return [
    // The store's own words are never the writer's to change.
    ...letterProblems(letter, [
      brief.brandName,
      ...input.products.map((p) => p.title)
    ]),
    ...qa.failures.map((f) => ({ rule: f.rule, reason: f.reason }))
  ]
}

/**
 * The plain letter (no AI): from the store's name, its lead product's
 * title and the locked offer only, never the brief, the angle or a claim.
 */
export function plainLetter(brief: LetterBrief): Letter {
  const lead = eligibleProducts(brief.locked.input)[0]
  const brand = brief.brandName
  const subject = lead
    ? `A short note about the ${lead.title}`
    : `A short note from ${brand}`
  const offer = offerOf(brief)
  return letterSchema.parse({
    subject: subject.length <= 60 ? subject : 'A short note from us',
    preheader: `Written to you directly, from all of us at ${brand}.`.slice(
      0,
      140
    ),
    greeting: 'Hi there,',
    body: [
      `This is a short note from all of us at ${brand}, sent as a plain letter rather than one of our usual emails.`,
      lead
        ? `I wanted to share the [${lead.title}](1) with you. Take a look when you have a quiet minute, and see whether it suits you.`
        : 'When you have a quiet minute, take a look at [what is in the shop](1) at the moment, and see whether something suits you.',
      'If you have a question about it, or about anything else at all, just reply to this email. Your reply comes straight to our inbox, and a person reads it.',
      `Thank you for being part of ${brand}. It means a lot to a small shop like ours, and we do not take it for granted.`
    ],
    signoff: 'Warmly,',
    ...letterSigner(brief),
    ps: lead
      ? 'Everything else we make is [in the shop](2), whenever you want a look.'
      : 'You can always reply to this email with a question.',
    ...(offer ? { offer } : {}),
    links: letterLinks(brief).map((l) => ({ url: l.url }))
  })
}

export type LetterResult =
  | { status: 'written'; letter: Letter; tries: number }
  | { status: 'plain'; letter: Letter; tries: number }
  | { status: 'failed'; tries: number }

/** Fixed words for why the letter fell back (never the letter's words). */
const causeWords = {
  agent_failed:
    'The Letter writer could not answer (AI unavailable or the allowance is used up).',
  out_of_time: 'There was no time for another try in this step.',
  check_failed: 'The letter still failed the checks after every rewrite'
} as const

/**
 * Writes the letter: the first try and up to 3 rewrites, each told the
 * exact problems with the last; then the plain letter, logged once.
 */
export async function writeLetter(
  brief: LetterBrief,
  ctx: AgentCtx & { fallbacks: FallbackLog; campaignId?: string | null }
): Promise<LetterResult> {
  let feedback: CopyFeedback[] = []
  const rules = new Set<string>()
  let cause: keyof typeof causeWords = 'check_failed'
  let tries = 0
  const writer = letterWriter(brief)
  for (let round = 0; round <= rewriteRounds; round++) {
    if (round > 0 && ctx.fits && !ctx.fits()) {
      cause = 'out_of_time'
      break
    }
    tries++
    const result = await runAgent(writer, { brief, feedback }, ctx)
    if (!result.ok) {
      if (result.code !== 'invalid_output') {
        cause = 'agent_failed'
        break
      }
      rules.add('answer_shape')
      feedback = [
        {
          field: 'letter',
          reason: 'The answer did not match the required JSON shape.'
        }
      ]
      continue
    }
    const letter = letterFrom(result.output, brief)
    if (!letter.success) {
      rules.add('part_too_long')
      feedback = letter.error.issues.slice(0, 5).map((i) => ({
        field: i.path.join(' ') || 'letter',
        reason: 'Keep it within its limit, and never empty.'
      }))
      continue
    }
    const found = letterFindings(letter.data, brief)
    if (!found.length) return { status: 'written', letter: letter.data, tries }
    for (const f of found) rules.add(f.rule)
    feedback = found.map((f) => ({ field: f.rule, reason: f.reason }))
  }
  const plain = plainLetter(brief)
  const plainRules = letterFindings(plain, brief).map((f) => f.rule)
  const usable = !plainRules.length
  await ctx.fallbacks.record({
    tenantId: ctx.tenantId,
    campaignId: ctx.campaignId ?? null,
    agent: 'letter-writer',
    reasonCode: usable ? 'letter_plain_fallback' : 'letter_failed',
    reason:
      cause === 'check_failed'
        ? `${causeWords.check_failed}: ${[...rules].join(', ').replace(/_/g, ' ') || 'no answer'}.`
        : causeWords[cause],
    fallback: usable
      ? 'Used the plain letter: the store’s name, its product and its offer only.'
      : 'The plain letter failed the checks too: no email was built.',
    attempts: Math.min(tries, 10),
    detail: {
      cause,
      rules: [...rules].slice(0, 20),
      ...(usable ? {} : { plainRules: [...new Set(plainRules)].slice(0, 20) })
    },
    dedupeKey: `letter-writer:${keyPart(ctx.callerKey)}`
  })
  return usable
    ? { status: 'plain', letter: plain, tries }
    : { status: 'failed', tries }
}
