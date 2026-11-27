import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import {
  blockJobLimits,
  blockJobs,
  blockResult,
  blocksWaiting,
  finishBlocks
} from '@/features/block-library/jobs'
import { logger } from '@/lib/logger'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 30
const noStore = { 'cache-control': 'no-store' }

const refuse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: noStore })

/**
 * DES-ENGINE-004: the block browser job calls this with
 * `Authorization: Bearer <CRON_SECRET>`: GET `?engine=<version>` hands out
 * one source's new sections to draw back (none, and nothing claimed, to a
 * browser on another engine version), GET `?peek=1` only says how many
 * sources wait, and POST records one result (a verdict per section).
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
  try {
    if (request.nextUrl.searchParams.get('peek') === '1')
      return NextResponse.json(
        { waiting: await blocksWaiting(db) },
        { headers: noStore }
      )
    return NextResponse.json(
      await blockJobs(db, request.nextUrl.searchParams.get('engine')),
      { headers: noStore }
    )
  } catch (error) {
    logger.error('Block jobs could not be handed out', {
      code: (error as { code?: string }).code ?? 'block_jobs_error'
    })
    return refuse('Block jobs unavailable; they stay queued.', 500)
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
  if (
    Number(request.headers.get('content-length') ?? 0) >
    blockJobLimits.bodyBytes
  )
    return refuse('Invalid block result', 413)
  const body = await request.text()
  if (body.length > blockJobLimits.bodyBytes)
    return refuse('Invalid block result', 413)
  let parsed: ReturnType<typeof blockResult.safeParse>
  try {
    parsed = blockResult.safeParse(JSON.parse(body))
  } catch {
    return refuse('Invalid block result', 400)
  }
  if (!parsed.success) return refuse('Invalid block result', 400)
  const done = await finishBlocks(db, parsed.data)
  if (!done.ok)
    return NextResponse.json(
      { error: 'Block result not recorded', code: done.code },
      { status: done.code === 'PT409' ? 409 : 500, headers: noStore }
    )
  return NextResponse.json(
    { ok: true, state: done.state },
    { headers: noStore }
  )
}
