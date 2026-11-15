import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { renderScale } from './renderer'

/**
 * DST-006b: the email build's design step waits for its pictures. It asks
 * for its designed sections to be drawn (DST-001b) by a browser that runs
 * outside the app every 10 minutes (DST-001c), so it cannot wait inside one
 * claim: it saves its work and waits (`waitForPictures`). The design
 * studio's job claims it again as soon as every picture it asked for is
 * drawn or failed (`claimWaitingDesign`), and reads them
 * (`buildRenders`). Nothing else takes it before its time is up; past it,
 * the sweep draws the email with coded blocks (D16).
 */

type Db = SupabaseClient<Database>

/**
 * The owner's switch for the design studio in "Create email": off unless
 * `DESIGN_STUDIO=on`. It checks this switch only: the studio's job also
 * needs the agents on (`EMAIL_BUILD_AGENTS=on` and a live model), as its
 * agents are paid AI.
 */
export const designStudioOn = (
  env: Readonly<Record<string, string | undefined>>
) => env.DESIGN_STUDIO?.trim() === 'on'

/**
 * The database's limits (`wait_email_round`, `request_section_render`),
 * repeated here: the database refuses past them whatever these say.
 */
export const studioWaits = {
  minSeconds: 60,
  maxSeconds: 3_600,
  /** Waits per design step: the studio's rounds are 3 at most. */
  perStep: 6,
  /** Pictures per build. */
  renders: 12
}

export type WaitResult =
  | { ok: true; waits: number }
  | {
      ok: false
      /**
       * `lease`: the claim is gone (it ran out or moved on); `step`: the
       * build is not on its design step (the claim is still held: fail
       * it); `too_many`: the step waited 6 times; `refused`: the work.
       */
      reason: 'lease' | 'step' | 'too_many' | 'refused'
    }

/**
 * Saves the design step's work and waits at most `seconds` for its
 * pictures, kept within the database's 1 minute to 1 hour. The claim ends
 * and its try is given back; the step's save count stays the database's
 * own. Errors other than a refusal throw, as does a time that is not a
 * number (a caller's bug, never read as refused work).
 */
export async function waitForPictures(
  db: Db,
  input: { build: string; lease: string; work: object; seconds: number }
): Promise<WaitResult> {
  if (!Number.isFinite(input.seconds))
    throw new Error('A wait needs a number of seconds')
  const seconds = Math.min(
    studioWaits.maxSeconds,
    Math.max(studioWaits.minSeconds, Math.round(input.seconds))
  )
  const { data, error } = await db.rpc('wait_email_round', {
    build: input.build,
    lease: input.lease,
    work: input.work as never,
    seconds
  })
  if (!error) return { ok: true, waits: data }
  if (error.code === 'PT409')
    return {
      ok: false,
      reason: error.details === 'not_design_step' ? 'step' : 'lease'
    }
  if (error.code === '22023')
    return {
      ok: false,
      reason: error.details === 'too_many_waits' ? 'too_many' : 'refused'
    }
  throw error
}

/**
 * Claims a waiting design step once every picture it asked for is drawn or
 * failed (or its time is up): the named one, or else the one waiting
 * longest that is ready, in an active workspace. It returns what
 * `claim_email_build` returns; null when none is ready (one out of tries,
 * or whose day passed, is failed on the way).
 */
export async function claimWaitingDesign(db: Db, build?: string) {
  const { data, error } = await db.rpc(
    'claim_studio_build',
    build !== undefined ? { target: build } : {}
  )
  if (error) throw error
  return data?.[0] ?? null
}

const renderRow = z.object({
  id: z.uuid(),
  section_key: z.string(),
  state: z.enum(['queued', 'drawn', 'failed']),
  failure: z.string().nullable(),
  path: z.string().nullable(),
  height: z.int().nullable(),
  bytes: z.int().nullable(),
  etag: z.string().nullable()
})

/** One of the build's pictures as the database holds it. */
export type BuildRender =
  | { id: string; key: string; state: 'queued' }
  | {
      id: string
      key: string
      state: 'drawn'
      /** In the private `studio-renders` bucket: render/<id>.jpg. */
      path: string
      /** CSS px at 600 wide (the picture is `renderScale` times this). */
      height: number
      bytes: number
      /** The stored picture's tag when it was recorded: compared before use. */
      etag: string
    }
  | { id: string; key: string; state: 'failed'; failure: string }

/**
 * The build's pictures, oldest first, in the build's own shape, read in
 * its own workspace only. A row the database should never hold (drawn
 * without its picture, or with a picture at another path) reads as
 * failed; one that cannot be read at all is left out.
 */
export async function buildRenders(
  db: Db,
  input: { tenant: string; build: string }
): Promise<BuildRender[]> {
  const { data, error } = await db
    .from('section_renders')
    .select('id,section_key,state,failure,path,height,bytes,etag')
    .eq('tenant_id', input.tenant)
    .eq('build_id', input.build)
    .order('created_at')
    .order('id')
    .limit(studioWaits.renders)
  if (error) throw error
  return (data ?? []).flatMap((raw): BuildRender[] => {
    const row = renderRow.safeParse(raw)
    if (!row.success) return []
    const r = row.data
    if (r.state === 'queued')
      return [{ id: r.id, key: r.section_key, state: 'queued' }]
    if (
      r.state === 'drawn' &&
      r.path === `render/${r.id}.jpg` &&
      r.height &&
      r.height % renderScale === 0 &&
      r.bytes &&
      r.etag
    )
      return [
        {
          id: r.id,
          key: r.section_key,
          state: 'drawn',
          path: r.path,
          height: r.height / renderScale,
          bytes: r.bytes,
          etag: r.etag
        }
      ]
    return [
      {
        id: r.id,
        key: r.section_key,
        state: 'failed',
        failure: r.failure ?? 'unreadable'
      }
    ]
  })
}
