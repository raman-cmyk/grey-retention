import { builtEmail, type BuiltEmail } from './build'
import { changeWords, type ChangeKey } from './content'
import { allSteps } from './step-names'

/**
 * UI-EMAIL-a (the owner's request of 16 November: a basic working UI on
 * docs/design/BRAND.md): what an email's own page shows, for a designed
 * email and a text email alike: its previews (desktop, phone and dark), its
 * run log in plain words (the steps it went through, and every change the
 * team made on the way), and Open in Klaviyo. Pure: the page reads the
 * build and its log lines and draws this with the GROS components.
 */
export type EmailRow = {
  id: string
  state: 'build_queued' | 'push_queued' | 'drafted' | 'failed' | string
  step: string | null
  email: unknown
  klaviyoCampaignId: string | null
  sampleDraft: boolean
  /** Why it failed, already in the owner's words (REL-084). */
  reason: string | null
}

/**
 * A fallback line of this build, already in the owner's words
 * (`ownerLine`); `code` is the line's reason code.
 */
export type EmailLogLine = { code: string; reason: string; instead: string }

export type RunStep = {
  label: string
  state: 'done' | 'now' | 'next' | 'failed'
}

export type EmailScreen =
  /** Not made yet: what the team is doing, step by step. */
  | { kind: 'working'; steps: RunStep[]; notes: string[] }
  /** It stopped: the step that failed says why; finished steps stay done. */
  | { kind: 'failed'; reason: string; steps: RunStep[]; notes: string[] }
  | {
      kind: 'email'
      title: string
      format: 'designed' | 'text'
      subject: string
      /** PIC-26: the subject half the audience gets in a subject test. */
      subjectB: string | null
      preview: string
      /** In Klaviyo, or still being put there. */
      status: 'in_klaviyo' | 'working'
      /** The sample store's email, or a sample draft: the page says so. */
      sample: boolean
      sampleDraft: boolean
      /** Open in Klaviyo: only for a real draft in Klaviyo, found by its name. */
      klaviyo: { campaignId: string; href: string; name: string } | null
      /** The designs to preview: one, or A and B of a design test. */
      designs: { name: string; html: string }[]
      /** A text email's own plain-text part. */
      text: string | null
      steps: RunStep[]
      notes: string[]
    }

/** Each build step in the owner's words: done, and running now. */
const stepWords: Record<
  (typeof allSteps)[number],
  { done: string; now: string; text?: { done: string; now: string } }
> = {
  sections: { done: 'Planned the sections', now: 'Planning the sections' },
  content: {
    done: 'Chose the products and the offer',
    now: 'Choosing the products and the offer'
  },
  copy: { done: 'Wrote the words', now: 'Writing the words' },
  design: {
    done: 'Designed the email',
    now: 'Designing the email',
    text: { done: 'Laid out the letter', now: 'Laying out the letter' }
  },
  push: {
    done: 'Put it in Klaviyo as a draft',
    now: 'Putting it in Klaviyo as a draft'
  }
}

/**
 * Open in Klaviyo goes to Klaviyo's campaigns list, where the draft is by
 * its name: no deep link to one campaign is documented (to confirm on the
 * first live draft, ledger UI-EMAIL-a).
 */
export const klaviyoCampaignsUrl = 'https://www.klaviyo.com/campaigns'

/** The run's steps, as far as the build got. */
export function runSteps(
  row: Pick<EmailRow, 'state' | 'step'>,
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
      format === 'text' && stepWords[step].text
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
    return { label: state === 'now' ? words.now : words.done, state }
  })
}

/** What the team changed on the way, in the owner's words, each once. */
function notesOf(email: BuiltEmail | null, log: readonly EmailLogLine[]) {
  const notes: string[] = []
  if (email?.copy === 'plain')
    notes.push(
      email.ai
        ? 'Its words are plain words built from your store’s facts: the AI writer could not be used.'
        : 'The AI was not used for this email: its words are plain words built from your store’s facts.'
    )
  const changes = (email?.changes ?? []).filter(
    (c): c is ChangeKey => c in changeWords
  )
  if (changes.length)
    notes.push(
      `Some planned content could not be used, so safer choices were made: ${[
        ...new Set(changes.map((c) => changeWords[c]))
      ].join('; ')}.`
    )
  if (email?.designA)
    notes.push(
      'A test of two designs: half the audience gets each, no winner picked.'
    )
  if (email?.subjectB && !email.designA)
    notes.push(
      'A test of two subjects: half the audience gets each, no winner picked.'
    )
  for (const line of log)
    // The Content locker's line says what the email's changes say above.
    if (!(changes.length && line.code === 'content_replaced'))
      notes.push(`${line.reason} ${line.instead}`.replace(/\s+/g, ' ').trim())
  return [...new Set(notes.filter(Boolean))].slice(0, 20)
}

/** The email's page from its build row and its log lines (see above). */
export function emailScreen(
  row: EmailRow,
  log: readonly EmailLogLine[] = []
): EmailScreen {
  const parsed = builtEmail.safeParse(row.email)
  const email = parsed.success ? parsed.data : null
  const format = email?.format === 'text' ? 'text' : 'designed'
  const steps = runSteps(row, format)
  const notes = notesOf(email, log)
  if (row.state === 'failed')
    return {
      kind: 'failed',
      reason: row.reason ?? 'We could not create this email. Try again.',
      steps,
      notes
    }
  const drafted = row.state === 'drafted'
  // Made, but not readable by this version of the app: say so, never "working".
  if (!email)
    return drafted
      ? {
          kind: 'failed',
          reason: 'This email could not be read. Make it again from the plan.',
          steps,
          notes
        }
      : { kind: 'working', steps, notes }
  return {
    kind: 'email',
    title: email.name,
    format,
    subject: email.subject,
    subjectB: email.designA ? null : (email.subjectB ?? null),
    preview: email.preheader,
    status: drafted ? 'in_klaviyo' : 'working',
    sample: email.sample,
    sampleDraft: row.sampleDraft,
    klaviyo:
      drafted && !row.sampleDraft && row.klaviyoCampaignId
        ? {
            campaignId: row.klaviyoCampaignId,
            href: klaviyoCampaignsUrl,
            name: email.name
          }
        : null,
    designs: email.designA
      ? [
          { name: 'Design A', html: email.designA },
          { name: 'Design B', html: email.html }
        ]
      : [
          {
            name: format === 'text' ? 'The letter' : 'The email',
            html: email.html
          }
        ],
    text: email.text ?? null,
    steps,
    notes
  }
}
