import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import {
  finishUpload,
  uploadJobLimits,
  uploadJobs,
  uploadResult,
  uploadsWaiting
} from '@/features/email-uploads/jobs'
import { logger } from '@/lib/logger'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 30
const noStore = { 'cache-control': 'no-store' }

const refuse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: noStore })

/**
 * DES-ENGINE-003: the upload measuring browser calls this with
 * `Authorization: Bearer <CRON_SECRET>`: GET `?engine=<version>` hands out
 * one uploaded email to measure (its prepared HTML as a short-lived signed
 * link; none, and nothing claimed, to a browser on another engine version
 * or with the owner's switch off), GET `?peek=1` only says how many wait,
 * and POST records one result.
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
        { waiting: await uploadsWaiting(db) },
        { headers: noStore }
      )
    return NextResponse.json(
      await uploadJobs(db, request.nextUrl.searchParams.get('engine')),
      { headers: noStore }
    )
  } catch (error) {
    logger.error('Upload jobs could not be handed out', {
      code: (error as { code?: string }).code ?? 'upload_jobs_error'
    })
    return refuse('Upload jobs unavailable; they stay queued.', 500)
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
    uploadJobLimits.bodyBytes
  )
    return refuse('Invalid upload result', 413)
  const body = await request.text()
  if (body.length > uploadJobLimits.bodyBytes)
    return refuse('Invalid upload result', 413)
  let parsed: ReturnType<typeof uploadResult.safeParse>
  try {
    parsed = uploadResult.safeParse(JSON.parse(body))
  } catch {
    return refuse('Invalid upload result', 400)
  }
  if (!parsed.success) return refuse('Invalid upload result', 400)
  const done = await finishUpload(db, parsed.data)
  if (!done.ok)
    return NextResponse.json(
      { error: 'Upload result not recorded', code: done.code },
      { status: done.code === 'PT409' ? 409 : 500, headers: noStore }
    )
  return NextResponse.json(
    { ok: true, state: done.state },
    { headers: noStore }
  )
}
