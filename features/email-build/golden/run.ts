import type { Draft } from '@/features/assembly/assemble'
import type { FallbackLog } from '@/features/fallback/log'
import { inPlanWindow } from '@/features/strategy/dates'
import {
  builtEmail,
  plannedEmail,
  type BuildAgents,
  type SectionsOutput
} from '../build'
import { runBuildStep } from '../steps'
import { buildSteps, maxEmailBytes, maxStepSaves } from '../step-names'
import {
  goldenNow,
  goldenOffers,
  goldenStart,
  goldenStore,
  goldenTenantId,
  type GoldenBrief
} from './briefs'
import type { GoldenRun } from './properties'

/** What `save_email_round` takes for one step's work (its 64 kB). */
const maxWorkBytes = 64_000

/**
 * REL-EVL: one golden brief, built the way the job builds it
 * (`runEmailBuilds`): the planned email read and its day checked against
 * the plan's 15 days, then each saved step from the plain JSON the steps
 * before saved, the store read fresh for each, on a fixed clock. A step's
 * saved rounds are kept as the database keeps them (`progress.work`, with
 * the count of saves), and the finished email is read and size-checked as
 * the job stores it. `agents` null is the code-only path (what the app
 * runs on the fake AI); otherwise the agents ask `agents.ai`.
 */
export async function runGolden(
  brief: GoldenBrief,
  deps: {
    agents: BuildAgents | null
    fallbacks: FallbackLog & { entries(): GoldenRun['fallbacks'] }
    /** Subjects the plan's other emails use. */
    taken?: readonly string[]
    /** When each claim must end (part 2's saved rounds); none: no limit. */
    until?: () => number
    clock?: () => number
  }
): Promise<GoldenRun> {
  const progress: Record<string, unknown> = {}
  const done = async (result: GoldenRun['result']): Promise<GoldenRun> => {
    const s = progress.sections as SectionsOutput | undefined
    return {
      result,
      store: await goldenStore(brief.store),
      sections: s ? { rules: s.rules, sendAt: s.sendAt } : null,
      fallbacks: deps.fallbacks.entries()
    }
  }
  const planned = plannedEmail.safeParse(brief.planned)
  if (!planned.success)
    return done({ ok: false, code: 'planned_email_invalid' })
  if (!inPlanWindow(planned.data.date, goldenStart))
    return done({ ok: false, code: 'slot_outside_plan' })
  for (const step of buildSteps) {
    for (;;) {
      const made = await runBuildStep(
        step,
        {
          planned: planned.data,
          store: await goldenStore(brief.store),
          offers: goldenOffers,
          progress: JSON.parse(JSON.stringify(progress)),
          taken: deps.taken
        },
        {
          tenantId: goldenTenantId,
          callerKey: `email-build:golden-${brief.id}`,
          fallbacks: deps.fallbacks,
          agents: deps.agents,
          clock: deps.clock ?? (() => goldenNow),
          ...(deps.until ? { until: deps.until() } : {})
        }
      )
      if (!made.ok) return done(made)
      if ('saved' in made) {
        // As `save_email_round`: the work merged in, its saves counted.
        const work = (progress.work ?? {}) as Record<string, { saves?: number }>
        const saves = (work[step]?.saves ?? 0) + 1
        if (saves > maxStepSaves)
          return done({ ok: false, code: 'step_timed_out' })
        if (Buffer.byteLength(JSON.stringify(made.work)) > maxWorkBytes)
          return done({ ok: false, code: 'step_output_invalid' })
        progress.work = { ...work, [step]: { ...made.work, saves } }
        continue
      }
      if (made.done !== 'design') {
        progress[made.done] = JSON.parse(JSON.stringify(made.output))
        break
      }
      // As the job stores it: read back from JSON, then size-checked.
      const email = builtEmail.safeParse(JSON.parse(JSON.stringify(made.email)))
      if (!email.success)
        return done({ ok: false, code: 'built_email_invalid' })
      if (Buffer.byteLength(JSON.stringify(email.data)) > maxEmailBytes)
        return done({ ok: false, code: 'email_too_large' })
      const copy = progress.copy as { draft: Draft }
      return done({ ok: true, email: email.data, draft: copy.draft })
    }
  }
  throw new Error('The build ended without its design step')
}
