import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import type { DraftPusher } from '@/lib/providers/klaviyo-draft'
import type { FallbackLog } from '@/features/fallback/log'
import { buildAgentsFor, emailAgentsOn } from '@/features/email-build/agents'
import type { BuildAgents } from '@/features/email-build/build'
import { stepBudgetMs } from '@/features/email-build/steps'
import { runEmailBuilds } from '@/features/email-build/worker'
import { claimWaitingDesign, designStudioOn } from './waits'

type Db = SupabaseClient<Database>

/** Waiting design steps one run claims at most, those waiting longest first. */
export const studioBuildsPerRun = 5

/**
 * DST-006b: the design studio's job. The section browser (DST-001c) calls
 * it after each run: the design steps waiting for their pictures are
 * claimed, the one waiting longest first, once every picture each asked
 * for is drawn or failed (`claim_studio_build`), and each runs with the
 * agents, then its next steps (the push) as the owner's click does. Only
 * with the owner's switches on (`DESIGN_STUDIO=on`, `EMAIL_BUILD_AGENTS=on`)
 * and a live model: else it claims nothing, and a waiting step is drawn
 * with coded blocks by the sweep once its time is up.
 */
export async function runStudioBuilds(
  db: Db,
  deps: {
    /** Stop claiming after this time (ms since epoch). */
    deadline: number
    env?: NodeJS.ProcessEnv
    /** Default: `buildAgentsFor(db, env)`. */
    agents?: BuildAgents | null
    pusher?: DraftPusher
    fallbacks?: FallbackLog
    now?: () => number
  }
): Promise<{ off: boolean; builds: number; ran: number }> {
  const env = deps.env ?? process.env
  if (!designStudioOn(env) || !emailAgentsOn(env))
    return { off: true, builds: 0, ran: 0 }
  const agents =
    deps.agents === undefined ? buildAgentsFor(db, env) : deps.agents
  if (!agents) return { off: true, builds: 0, ran: 0 }
  const now = deps.now ?? Date.now
  let builds = 0
  let ran = 0
  for (let n = 0; n < studioBuildsPerRun; n++) {
    // A design round with the agents takes most of a step's budget: a
    // build is claimed only while a whole step fits.
    if (now() + stepBudgetMs > deps.deadline) break
    const job = await claimWaitingDesign(db)
    if (!job) break
    builds++
    const done = await runEmailBuilds(db, {
      build: job.id,
      first: job,
      // Its own switch, as read here (never the process's again).
      studio: true,
      agents,
      deadline: deps.deadline,
      pusher: deps.pusher,
      fallbacks: deps.fallbacks,
      now
    })
    ran += done.ran
  }
  return { off: false, builds, ran }
}
