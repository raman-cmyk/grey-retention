import type { Draft } from '@/features/assembly/assemble'
import type { EmailType } from '@/features/strategy/plan'
import type { BuiltEmail } from './build'
import {
  copyInput,
  photosFor,
  scratchWords,
  type LibraryCopyPort
} from './library-copy'
import { libraryWaits, libraryWaitSeconds } from './library-step'
import type { Store } from './ports'
import { planScratch } from './scratch'

/**
 * DES-ENGINE-004b: the design step of a Scratch email with the library on
 * (`DESIGN_LIBRARY_SCRATCH=on`). It plans the email's sections from the
 * whole block library (`planScratch`: the goal, what the brand can fill,
 * how much each layout is used, variety), keeps the pick in the step's
 * saved work (so every later claim asks for the same copy), asks the
 * design copies job to draw the picked blocks in the brand's look (brand
 * swap, structure check, Footer block when needed, leak check against
 * every email a layout came from) and waits for it like a library copy. A
 * done copy with no leak that passes the email's hard checks is the email;
 * anything else draws the coded blocks, and the owner's log says why in
 * plain words (D16: never silently, never stuck).
 */

export type ScratchStepOutcome =
  | {
      kind: 'waiting'
      work: { library: { waits: number; blocks: string[] } }
      seconds: number
    }
  | { kind: 'email'; email: BuiltEmail }
  | { kind: 'coded'; reasonCode: string; reason: string }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The saved pick (`progress.work.design.library.blocks`), if any. */
export const savedPick = (saved: unknown): string[] | null => {
  const got = (saved as { library?: { blocks?: unknown } } | undefined)?.library
    ?.blocks
  return Array.isArray(got) &&
    got.length >= 1 &&
    got.length <= 12 &&
    got.every((b) => typeof b === 'string' && uuid.test(b))
    ? (got as string[])
    : null
}

const savedWaits = (saved: unknown) => {
  const n = Number(
    (saved as { library?: { waits?: unknown } } | undefined)?.library?.waits
  )
  return Number.isInteger(n) && n > 0 ? n : 0
}

export async function scratchStep(input: {
  port: NonNullable<LibraryCopyPort['scratch']>
  /** The build, for the email's own variety. */
  buildId: string
  emailType: EmailType
  store: Pick<Store, 'brand' | 'products' | 'facts' | 'confirmed' | 'fonts'>
  draft: Draft
  rules: {
    maxDiscountPercent: number
    codes: readonly { code: string; percent: number }[]
  }
  coded: BuiltEmail
  saved: unknown
  checks: (
    html: string,
    email: BuiltEmail
  ) => { check: string; problem: string }[]
}): Promise<ScratchStepOutcome> {
  const waits = savedWaits(input.saved)
  // Klaviyo's tags in the footer, as the coded email has them; the names
  // of the brands a layout came from are the job's (never the input's).
  const copyIn = copyInput({
    store: input.store,
    draft: input.draft,
    rules: input.rules,
    sourceNames: [],
    mode: 'klaviyo'
  })
  let blocks = savedPick(input.saved)
  if (!blocks) {
    const library = await input.port.library()
    const plan = planScratch(library.blocks, {
      emailType: input.emailType,
      products: copyIn.products.length,
      productPhotos: copyIn.products.filter((p) => p.photo).length,
      offer: copyIn.rules.offer !== null,
      logo: !!copyIn.brand.logo,
      photos: copyIn.brand.photos?.length ?? 0,
      recent: new Set(library.recent),
      seed: input.buildId
    })
    if (!plan.ok)
      return {
        kind: 'coded',
        reasonCode: 'scratch_no_plan',
        reason: scratchWords.none(plan.reason)
      }
    blocks = plan.blocks.map((b) => b.id)
  }
  const got = await input.port.copy(blocks, copyIn, photosFor(copyIn))
  if (got.state === 'queued')
    return waits < libraryWaits
      ? {
          kind: 'waiting',
          work: { library: { waits: waits + 1, blocks } },
          seconds: libraryWaitSeconds
        }
      : {
          kind: 'coded',
          reasonCode: 'scratch_copying',
          reason: scratchWords.copying
        }
  if (got.state === 'failed')
    return {
      kind: 'coded',
      reasonCode: 'scratch_failed',
      reason: scratchWords.failed(got.reason)
    }
  const record = got.record
  if (record.leaks.length)
    return {
      kind: 'coded',
      reasonCode: 'scratch_leaks',
      reason: scratchWords.leaks
    }
  const email: BuiltEmail = {
    ...input.coded,
    html: record.html,
    approach: 'A',
    library: {
      emailId: 'scratch',
      scratch: blocks.length,
      sections: record.sections,
      footerAdded: record.footerAdded
    }
  }
  const problems = input.checks(email.html, email)
  if (problems.length)
    return {
      kind: 'coded',
      reasonCode: `scratch_check_${problems[0]!.check}`,
      reason: `${scratchWords.checks} ${problems[0]!.problem}`
    }
  return { kind: 'email', email }
}
