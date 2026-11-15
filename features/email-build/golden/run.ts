import type { Draft } from '@/features/assembly/assemble'
import type { FallbackLog } from '@/features/fallback/log'
import type { BuildAgents, SectionsOutput } from '../build'
import { runBuildStep } from '../steps'
import { buildSteps, maxStepSaves } from '../step-names'
import {
  goldenNow,
  goldenOffers,
  goldenStore,
  type GoldenBrief
} from './briefs'
import type { GoldenRun } from './properties'

/**
 * REL-EVL: one golden brief, built the way the job builds it: each saved
 * step from the plain JSON the step before saved, the store read fresh for
 * each, on a fixed clock. `agents` null is the code-only path (what the
 * app runs on the fake AI); otherwise the agents ask `agents.ai`.
 */
export async function runGolden(
  brief: GoldenBrief,
  deps: {
    agents: BuildAgents | null
    fallbacks: FallbackLog & { entries(): GoldenRun['fallbacks'] }
    /** Subjects the plan's other emails use. */
    taken?: readonly string[]
  }
): Promise<GoldenRun> {
  const ctx = {
    tenantId: '00000000-0000-4000-8000-0000000000e1',
    callerKey: `email-build:golden-${brief.id}`,
    fallbacks: deps.fallbacks,
    agents: deps.agents,
    clock: () => goldenNow
  }
  const progress: Record<string, unknown> = {}
  const saved = () => {
    const s = progress.sections as SectionsOutput | undefined
    return s ? { rules: s.rules, sendAt: s.sendAt } : null
  }
  const done = async (result: GoldenRun['result']): Promise<GoldenRun> => ({
    result,
    store: await goldenStore(brief.store),
    sections: saved(),
    fallbacks: deps.fallbacks.entries()
  })
  for (const step of buildSteps) {
    for (let saves = 0; ; saves++) {
      const made = await runBuildStep(
        step,
        {
          planned: brief.planned,
          store: await goldenStore(brief.store),
          offers: goldenOffers,
          progress: JSON.parse(JSON.stringify(progress)),
          taken: deps.taken
        },
        ctx
      )
      if (!made.ok) return done(made)
      if ('saved' in made) {
        if (saves >= maxStepSaves) throw new Error('Too many saved rounds')
        progress.work = { [step]: { ...made.work, saves: saves + 1 } }
        continue
      }
      if (made.done === 'design') {
        const copy = progress.copy as { draft: Draft }
        return done({ ok: true, email: made.email, draft: copy.draft })
      }
      progress[made.done] = JSON.parse(JSON.stringify(made.output))
      delete progress.work
      break
    }
  }
  throw new Error('The build ended without its design step')
}
