import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import {
  copiesWaiting,
  copyJobs,
  copyLimits,
  copyResult,
  finishCopy,
  runCopiedBuilds
} from '@/features/email-build/copy-jobs'
import { draftPusherFor } from '@/features/klaviyo-push/live'
import { logger } from '@/lib/logger'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 120
/** The carry-on's deadline inside the route's time (as the studio's builds). */
const budgetMs = 105_000
const noStore = { 'cache-control': 'no-store' }

const refuse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: noStore })

/**
 * DES-ENGINE-002b2: the library copy browser calls this with
 * `Authorization: Bearer <CRON_SECRET>`: GET `?peek=1` only says how many
 * copies are waiting; GET `?engine=<version>` hands out one copy to make
 * (none, and nothing claimed, to a browser on another engine version);
 * GET `?carry=1` takes the builds whose copies are in through their checks
 * and into Klaviyo as drafts (the fake push unless the owner's write
 * switch is on); POST records one result. The browser runs outside the
 * app (a scheduled GitHub Actions job), because a server function cannot
 * run Chromium.
 */
export async function GET(request: NextRequest) {
  if (
    !cronAuthorized(
      request.headers.get('authorization'),
      process.env.CRON_SECRET
    )
  )
    return refuse('Unauthorized', 401)
  const db = createServiceClient()
  if (!db) return refuse('Server configuration unavailable', 503)
  const params = request.nextUrl.searchParams
  try {
    if (params.get('peek') === '1')
      return NextResponse.json(
        { waiting: await copiesWaiting(db) },
        { headers: noStore }
      )
    if (params.get('carry') === '1')
      return NextResponse.json(
        await runCopiedBuilds(db, {
          deadline: Date.now() + budgetMs,
          pusher: draftPusherFor(db)
        }),
        { headers: noStore }
      )
    return NextResponse.json(await copyJobs(db, params.get('engine')), {
      headers: noStore
    })
  } catch (error) {
    logger.error('Copy jobs could not be handed out', {
      code: (error as { code?: string }).code ?? 'copy_jobs_error'
    })
    return refuse('Copy jobs unavailable; they stay queued.', 500)
  }
}

export async function POST(request: NextRequest) {
  if (
    !cronAuthorized(
      request.headers.get('authorization'),
      process.env.CRON_SECRET
    )
  )
    return refuse('Unauthorized', 401)
  const db = createServiceClient()
  if (!db) return refuse('Server configuration unavailable', 503)
  if (Number(request.headers.get('content-length') ?? 0) > copyLimits.bodyBytes)
    return refuse('Invalid copy result', 413)
  const body = await request.text()
  if (Buffer.byteLength(body) > copyLimits.bodyBytes)
    return refuse('Invalid copy result', 413)
  let parsed: ReturnType<typeof copyResult.safeParse>
  try {
    parsed = copyResult.safeParse(JSON.parse(body))
  } catch {
    return refuse('Invalid copy result', 400)
  }
  if (!parsed.success) return refuse('Invalid copy result', 400)
  const done = await finishCopy(db, parsed.data)
  if (!done.ok)
    return NextResponse.json(
      { error: 'Copy not recorded', code: done.code },
      {
        status: done.code === 'PT409' ? 409 : done.code === '23514' ? 422 : 500,
        headers: noStore
      }
    )
  return NextResponse.json(
    { ok: true, state: done.state },
    { headers: noStore }
  )
}
