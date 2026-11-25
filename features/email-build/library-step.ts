import type { BuiltEmail } from './build'
import {
  copyInput,
  copyWords,
  photosFor,
  type CopiedSection,
  type LibraryCopyPort
} from './library-copy'
import type { Store } from './ports'
import type { Draft } from '@/features/assembly/assemble'

/**
 * DES-ENGINE-002b2: the design step of an email the owner asked to copy
 * ("Use this design", Copy) with the library copy on. It reads the chosen
 * email's stored blueprint, asks the browser job for the brand copy and
 * waits for it like the design studio's pictures (DST-006b); a done copy
 * with no leak that passes the email's hard checks is the email, with
 * each section's outcome kept for the email's page. Anything else draws
 * the coded blocks, and the owner's log says why in plain words (D16:
 * never silently, never stuck).
 */

/** At most this many waits for the blueprint and the copy (each 30 minutes). */
export const libraryWaits = 3
export const libraryWaitSeconds = 1_800

export type LibraryStepOutcome =
  | { kind: 'waiting'; work: { library: { waits: number } }; seconds: number }
  | { kind: 'email'; email: BuiltEmail }
  | { kind: 'coded'; reasonCode: string; reason: string }

export async function libraryStep(input: {
  port: LibraryCopyPort
  mode: 'preview' | 'klaviyo'
  emailId: string
  store: Pick<Store, 'brand' | 'products' | 'facts'>
  draft: Draft
  rules: {
    maxDiscountPercent: number
    codes: { code: string; percent: number }[]
  }
  /** The coded email as the design step drew it (subject, products, code…). */
  coded: BuiltEmail
  /** The design step's saved work (`progress.work.design`). */
  saved: unknown
  /** The email's hard checks (`checksFor`), on the copy's HTML. */
  checks: (html: string, email: BuiltEmail) => { check: string; problem: string }[]
}): Promise<LibraryStepOutcome> {
  const waits =
    Number((input.saved as { library?: { waits?: unknown } } | undefined)?.library?.waits) || 0
  const wait = (code: keyof typeof copyWords): LibraryStepOutcome =>
    waits < libraryWaits
      ? {
          kind: 'waiting',
          work: { library: { waits: waits + 1 } },
          seconds: libraryWaitSeconds
        }
      : {
          kind: 'coded',
          reasonCode: `library_${code}`,
          reason: copyWords[code] as string
        }
  const bp = await input.port.blueprint(input.emailId)
  if (bp.state === 'waiting') return wait('waiting')
  if (bp.state === 'unusable')
    return {
      kind: 'coded',
      reasonCode: 'library_unusable',
      reason: copyWords.failed(bp.reason)
    }
  const copyIn = copyInput({
    store: input.store,
    draft: input.draft,
    rules: input.rules,
    sourceNames: bp.sourceNames,
    mode: input.mode
  })
  const got = await input.port.copy(bp.messageId, copyIn, photosFor(copyIn))
  if (got.state === 'queued') return wait('copying')
  if (got.state === 'failed')
    return {
      kind: 'coded',
      reasonCode: 'library_failed',
      reason: copyWords.failed(got.reason)
    }
  const record = got.record
  if (record.leaks.length)
    return { kind: 'coded', reasonCode: 'library_leaks', reason: copyWords.leaks }
  const email: BuiltEmail = {
    ...input.coded,
    html: record.html,
    approach: 'A',
    library: {
      emailId: input.emailId,
      sections: record.sections.map((s: CopiedSection) => s),
      footerAdded: record.footerAdded
    }
  }
  const problems = input.checks(email.html, email)
  if (problems.length)
    return {
      kind: 'coded',
      reasonCode: `library_check_${problems[0]!.check}`,
      reason: `${copyWords.checks} ${problems[0]!.problem}`
    }
  return { kind: 'email', email }
}
