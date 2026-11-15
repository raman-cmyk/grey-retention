import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

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
 * `DESIGN_STUDIO=on`, and only with the agents on (`EMAIL_BUILD_AGENTS=on`
 * and a live model): the studio's agents are paid AI.
 */
export const designStudioOn = (env: { DESIGN_STUDIO?: string }) =>
  env.DESIGN_STUDIO?.trim() === 'on'

/** The database's limits (`wait_email_round`, `request_section_render`). */
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
      /** `lease`: the claim moved on; `too_many`: the step waited 6 times; `refused`: the work or the time. */
      reason: 'lease' | 'too_many' | 'refused'
    }

/**
 * Saves the design step's work and waits at most `seconds` for its
 * pictures. The claim ends and its try is given back; the step's save
 * count stays the database's own. Errors other than a refusal throw.
 */
export async function waitForPictures(
  db: Db,
  input: { build: string; lease: string; work: object; seconds: number }
): Promise<WaitResult> {
  const { data, error } = await db.rpc('wait_email_round', {
    build: input.build,
    lease: input.lease,
    work: input.work as never,
    seconds: Math.round(input.seconds)
  })
  if (!error) return { ok: true, waits: data }
  if (error.code === 'PT409') return { ok: false, reason: 'lease' }
  if (error.code === '22023')
    return {
      ok: false,
      reason:
        (error as { details?: string }).details === 'too_many_waits'
          ? 'too_many'
          : 'refused'
    }
  throw error
}

/**
 * The waiting design steps, those waiting longest first: the ones the
 * studio's job tries to claim. Waiting is a design step that waited and has
 * a time (only `wait_email_round` sets one on a design step).
 */
export async function waitingDesigns(db: Db, limit = 5): Promise<string[]> {
  const { data, error } = await db
    .from('email_builds')
    .select('id')
    .eq('state', 'build_queued')
    .eq('step', 'design')
    .gt('waits', 0)
    .not('not_before', 'is', null)
    .order('updated_at')
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((b) => b.id)
}

/**
 * Claims one waiting design step once every picture it asked for is drawn
 * or failed (or its time is up), with what `claim_email_build` returns;
 * null when it is not ready, leased, or failed (out of tries, its day
 * passed).
 */
export async function claimWaitingDesign(db: Db, build: string) {
  const { data, error } = await db.rpc('claim_studio_build', { target: build })
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
      path: string
      height: number
      bytes: number
      /** The stored picture's tag when it was recorded: compared before use. */
      etag: string
    }
  | { id: string; key: string; state: 'failed'; failure: string }

/**
 * The build's pictures, oldest first, in the build's own shape. A row the
 * database should never hold (drawn without its picture) reads as failed.
 */
export async function buildRenders(
  db: Db,
  build: string
): Promise<BuildRender[]> {
  const { data, error } = await db
    .from('section_renders')
    .select('id,section_key,state,failure,path,height,bytes,etag')
    .eq('build_id', build)
    .order('created_at')
    .order('id')
    .limit(studioWaits.renders)
  if (error) throw error
  return (data ?? []).map((raw): BuildRender => {
    const row = renderRow.safeParse(raw)
    if (!row.success)
      return {
        id: String((raw as { id?: unknown }).id ?? ''),
        key: String((raw as { section_key?: unknown }).section_key ?? ''),
        state: 'failed',
        failure: 'unreadable'
      }
    const r = row.data
    if (r.state === 'queued')
      return { id: r.id, key: r.section_key, state: 'queued' }
    if (r.state === 'drawn' && r.path && r.height && r.bytes && r.etag)
      return {
        id: r.id,
        key: r.section_key,
        state: 'drawn',
        path: r.path,
        height: r.height,
        bytes: r.bytes,
        etag: r.etag
      }
    return {
      id: r.id,
      key: r.section_key,
      state: 'failed',
      failure: r.failure ?? 'unreadable'
    }
  })
}
