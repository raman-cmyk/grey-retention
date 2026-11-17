import {
  klaviyoFooterTags,
  previewFooterTags
} from '@/features/blocks/klaviyo-tags'
import { previewHtml } from '@/features/email-generation/html'
import { plainFooterTags } from '@/features/letter/render'
import { builtEmail, type BuiltEmail } from './build'
import { changeWords, type ChangeKey } from './content'
import { allSteps } from './step-names'

/**
 * UI-EMAIL-a (the owner's request of 16 November: a basic working UI on
 * docs/design/BRAND.md): what an email's own page shows, for a designed
 * email and a text email alike: its previews (desktop, phone and dark), its
 * run log in plain words (the steps it went through, and every change the
 * team made on the way), and Open in Klaviyo. Pure, and run on the server
 * (it reads the whole build): the page gets the screen object and draws it
 * with the GROS components. Its HTML and text are preview-safe: Klaviyo's
 * tags as placeholders, active content and outside loads removed.
 */
export type EmailRow = {
  id: string
  state: 'build_queued' | 'push_queued' | 'drafted' | 'failed' | string
  step: string | null
  email: unknown
  /** The planned slot's format, for an email not built yet. */
  format: 'designed' | 'text'
  klaviyoCampaignId: string | null
  sampleDraft: boolean
  /** Why it failed, already in the owner's words (REL-084). */
  reason: string | null
  /**
   * DST-002b: the inbox email it follows (Copy) or remixes, and why, in the
   * owner's words (saved by the sections step). Missing: from scratch, or
   * built before it.
   */
  referenceReason?: string | null
}

/**
 * A fallback line of this build, already in the owner's words
 * (`ownerLine`); `agent` and `code` are the line's own.
 */
export type EmailLogLine = {
  agent: string
  code: string
  reason: string
  instead: string
}

export type RunStep = {
  label: string
  state: 'done' | 'now' | 'next' | 'failed'
}

/** What the email says and looks like, as the previews show it. */
export type EmailView = {
  title: string
  format: 'designed' | 'text'
  subject: string
  /** PIC-26: the subject half the audience gets, when Klaviyo holds the test. */
  subjectB: string | null
  preview: string
  /** The sample store's email: the page says its products are examples. */
  sample: boolean
  /** The designs to preview: one, or A and B of a design test Klaviyo holds. */
  designs: { name: string; html: string }[]
  /** A text email's own plain-text part. */
  text: string | null
}

/** Open in Klaviyo: Klaviyo's campaigns list, where the draft is by its name. */
/** `name` is the draft's name in Klaviyo, when this app can read it. */
export type KlaviyoLink = {
  campaignId: string
  href: string
  name: string | null
}

export type EmailScreen =
  /** Not made yet: what the team is doing, step by step. */
  | {
      kind: 'working'
      format: 'designed' | 'text'
      steps: RunStep[]
      notes: string[]
    }
  /** It stopped: why, the step that failed; the email when it was made. */
  | {
      kind: 'failed'
      format: 'designed' | 'text'
      reason: string
      steps: RunStep[]
      notes: string[]
      email: EmailView | null
    }
  /** In Klaviyo as a draft, but stored the way an older version of the app stored it. */
  | {
      kind: 'unreadable'
      message: string
      klaviyo: KlaviyoLink | null
      steps: RunStep[]
      notes: string[]
    }
  | (EmailView & {
      kind: 'email'
      /**
       * In Klaviyo as a draft; a sample draft (Klaviyo not connected:
       * nothing was sent to it); or still being put there.
       */
      status: 'in_klaviyo' | 'sample_draft' | 'working'
      /** Open in Klaviyo: only for a real draft in Klaviyo. */
      klaviyo: KlaviyoLink | null
      steps: RunStep[]
      notes: string[]
    })

/** Each build step in the owner's words: done, and still to do (now, next, failed). */
const stepWords: Record<
  (typeof allSteps)[number],
  { done: string; doing: string; text?: { done: string; doing: string } }
> = {
  sections: { done: 'Planned the sections', doing: 'Planning the sections' },
  content: {
    done: 'Chose the products and the offer',
    doing: 'Choosing the products and the offer'
  },
  copy: { done: 'Wrote the words', doing: 'Writing the words' },
  design: {
    done: 'Designed the email',
    doing: 'Designing the email',
    text: { done: 'Laid out the letter', doing: 'Laying out the letter' }
  },
  push: {
    done: 'Put it in Klaviyo as a draft',
    doing: 'Putting it in Klaviyo as a draft'
  }
}

/**
 * Open in Klaviyo goes to Klaviyo's campaigns list, where the draft is by
 * its name: no deep link to one campaign is documented (to confirm on the
 * first live draft, ledger UI-EMAIL-a).
 */
export const klaviyoCampaignsUrl = 'https://www.klaviyo.com/campaigns'

/** A sample draft's last step: it never reached Klaviyo. */
const sampleSave = {
  done: 'Kept it as a sample draft (Klaviyo is not connected)',
  doing: 'Keeping it as a sample draft'
}

/** The run's steps, as far as the build got. */
export function runSteps(
  row: Pick<EmailRow, 'state' | 'step'> & { sampleDraft?: boolean },
  format: 'designed' | 'text'
): RunStep[] {
  const at = allSteps.indexOf(
    (allSteps as readonly string[]).includes(row.step ?? '')
      ? (row.step as (typeof allSteps)[number])
      : 'sections'
  )
  const drafted = row.state === 'drafted'
  const failed = row.state === 'failed'
  return allSteps.map((step, i) => {
    const words =
      step === 'push' && row.sampleDraft
        ? sampleSave
        : format === 'text' && stepWords[step].text
          ? stepWords[step].text!
          : stepWords[step]
    const state: RunStep['state'] = drafted
      ? 'done'
      : i < at
        ? 'done'
        : i === at
          ? failed
            ? 'failed'
            : 'now'
          : 'next'
    return { label: state === 'done' ? words.done : words.doing, state }
  })
}

/** The A/B test Klaviyo could not hold (the push's own log lines). */
const oneSubject = 'ab_one_subject'
const oneDesign = 'ab_one_design'
/** The steps whose log line already says the words are plain. */
const copyAgents = new Set(['copywriter', 'copy-inspectors', 'letter-writer'])

/** What the team changed on the way, in the owner's words, each once. */
function notesOf(
  email: BuiltEmail | null,
  view: EmailView | null,
  log: readonly EmailLogLine[],
  referenceReason?: string | null
) {
  // DST-002b: which inspiration email it follows comes first.
  const notes: string[] = referenceReason ? [referenceReason] : []
  if (email?.copy === 'plain')
    if (!email.ai)
      notes.push(
        'The AI was not used for this email: its words are plain words built from your store’s facts.'
      )
    // The copy step's own line says why, when there is one.
    else if (!log.some((l) => copyAgents.has(l.agent)))
      notes.push(
        'Its words are plain words built from your store’s facts: the AI writer could not be used.'
      )
  const changes = (email?.changes ?? []).filter((c): c is ChangeKey =>
    Object.hasOwn(changeWords, c)
  )
  if (changes.length)
    notes.push(
      `Some planned content could not be used, so safer choices were made: ${[
        ...new Set(changes.map((c) => changeWords[c]))
      ].join('; ')}.`
    )
  if (view && view.designs.length > 1)
    notes.push(
      'A test of two designs: half the audience gets each, and Results shows which got more clicks once there are enough results.'
    )
  if (view?.subjectB)
    notes.push(
      'A test of two subjects: half the audience gets each, and Results shows which got more clicks once there are enough results.'
    )
  for (const line of log)
    // The Content locker's line says what the email's changes say above.
    if (!(changes.length && line.code === 'content_replaced'))
      notes.push(`${line.reason} ${line.instead}`.replace(/\s+/g, ' ').trim())
  return [...new Set(notes.filter(Boolean))].slice(0, 20)
}

/** A text part as the page shows it: Klaviyo's tags as plain words. */
export function previewText(text: string) {
  return text
    .split(plainFooterTags.unsubscribe)
    .join('Unsubscribe link')
    .split(plainFooterTags.preferences)
    .join('Preferences link')
    .split(klaviyoFooterTags.organization)
    .join('Your brand')
    .split(klaviyoFooterTags.address)
    .join('Your store address (Klaviyo adds it when it sends)')
    .replace(/\{\{\s*first_name[^{}]{0,200}\}\}/g, '[first name]')
    .replace(/\{\{[^{}]{0,500}\}\}|\{%[^{}]{0,500}%\}/g, '')
}

const safeHtml = (html: string) =>
  previewHtml(previewFooterTags(html, null)).html

/** The email as the previews show it, without a test Klaviyo does not hold. */
function viewOf(
  email: BuiltEmail,
  log: readonly EmailLogLine[],
  sampleDraft: boolean
): EmailView {
  const format = email.format === 'text' ? 'text' : 'designed'
  // A sample draft was never sent: no test runs (Results has only A).
  const designTest =
    !sampleDraft && !!email.designA && !log.some((l) => l.code === oneDesign)
  const subjectTest =
    !sampleDraft &&
    !email.designA &&
    !!email.subjectB &&
    !log.some((l) => l.code === oneSubject)
  return {
    title: email.name,
    format,
    subject: email.subject,
    subjectB: subjectTest ? email.subjectB! : null,
    preview: email.preheader,
    sample: email.sample,
    // One design only: the draft holds the coded one (design A).
    designs: designTest
      ? [
          { name: 'Design A', html: safeHtml(email.designA!) },
          { name: 'Design B', html: safeHtml(email.html) }
        ]
      : [
          {
            name: format === 'text' ? 'The letter' : 'The email',
            html: safeHtml(email.designA ?? email.html)
          }
        ],
    text: email.text ? previewText(email.text) : null
  }
}

/** The email's page from its build row and its log lines (see above). */
export function emailScreen(
  row: EmailRow,
  log: readonly EmailLogLine[] = []
): EmailScreen {
  const parsed = builtEmail.safeParse(row.email)
  const email = parsed.success ? parsed.data : null
  const view = email ? viewOf(email, log, row.sampleDraft) : null
  const format = view?.format ?? row.format
  const steps = runSteps(row, format)
  const notes = notesOf(email, view, log, row.referenceReason)
  const drafted = row.state === 'drafted'
  const klaviyo =
    drafted && !row.sampleDraft && row.klaviyoCampaignId
      ? {
          campaignId: row.klaviyoCampaignId,
          href: klaviyoCampaignsUrl,
          name: email?.name ?? null
        }
      : null
  if (row.state === 'failed')
    return {
      kind: 'failed',
      format,
      reason: row.reason ?? 'We could not create this email. Try again.',
      steps,
      notes,
      email: view
    }
  // Made, but stored the way this app no longer reads: never "working".
  if (!view && drafted)
    return {
      kind: 'unreadable',
      message: row.sampleDraft
        ? 'This sample draft was made by an older version of the app, so it cannot be shown here.'
        : `This email is in Klaviyo as a draft, but it was made by an older version of the app, so it cannot be shown here.${klaviyo ? ' Open it in Klaviyo to see it.' : ''}`,
      klaviyo,
      steps,
      notes
    }
  if (!view) return { kind: 'working', format, steps, notes }
  return {
    kind: 'email',
    ...view,
    status: drafted
      ? row.sampleDraft
        ? 'sample_draft'
        : 'in_klaviyo'
      : 'working',
    klaviyo,
    steps,
    notes
  }
}
