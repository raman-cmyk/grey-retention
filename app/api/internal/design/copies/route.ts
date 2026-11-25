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

/** The body, read only up to `max` bytes (null past it, with or without a length). */
async function cappedBody(request: NextRequest, max: number) {
  if (Number(request.headers.get('content-length') ?? 0) > max) return null
  const reader = request.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    size += chunk.value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(chunk.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * DES-ENGINE-002b2: the library copy browser calls this with
 * `Authorization: Bearer <CRON_SECRET>`: GET `?peek=1` only says how many
 * copies are waiting; GET `?engine=<version>` hands out one copy to make
 * (none, and nothing claimed, with the owner's switch off or to a browser
 * on another engine version); POST records one result; POST `?carry=1`
 * takes the builds whose copies are in through their checks and into
 * Klaviyo as drafts (the fake push unless the owner's write switch is on)
 * and removes the photos no email needs. The browser runs outside the app
 * (a scheduled GitHub Actions job), because a server function cannot run
 * Chromium.
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
  if (request.nextUrl.searchParams.get('carry') === '1')
    try {
      return NextResponse.json(
        await runCopiedBuilds(db, {
          deadline: Date.now() + budgetMs,
          pusher: draftPusherFor(db)
        }),
        { headers: noStore }
      )
    } catch (error) {
      logger.error('Copied emails could not go on', {
        code: (error as { code?: string }).code ?? 'copy_carry_error'
      })
      return refuse('Copied emails could not go on; they stay waiting.', 500)
    }
  const body = await cappedBody(request, copyLimits.bodyBytes)
  if (body === null) return refuse('Invalid copy result', 413)
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
