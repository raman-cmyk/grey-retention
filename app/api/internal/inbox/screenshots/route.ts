import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import {
  finishScreenshot,
  screenshotJobs,
  screenshotsWaiting,
  screenshotResult
} from '@/features/inbox/screenshots'
import { logger } from '@/lib/logger'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 30
const noStore = { 'cache-control': 'no-store' }

const refuse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: noStore })

/**
 * The screenshot browser (INB-002) calls this with `Authorization: Bearer
 * <CRON_SECRET>`: GET hands out up to 4 emails to photograph (short-lived
 * signed links only), GET `?peek=1` only says how many are waiting, and
 * POST records one result. The browser runs outside
 * the app (a scheduled GitHub Actions job), because a server function
 * cannot run Chromium.
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
        { waiting: await screenshotsWaiting(db) },
        { headers: noStore }
      )
    return NextResponse.json(
      { jobs: await screenshotJobs(db) },
      { headers: noStore }
    )
  } catch (error) {
    logger.error('Screenshot jobs could not be handed out', {
      code: (error as { code?: string }).code ?? 'screenshot_jobs_error'
    })
    return refuse('Screenshot jobs unavailable; they stay queued.', 500)
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
  if (Number(request.headers.get('content-length') ?? 0) > 2_000)
    return refuse('Invalid screenshot result', 400)
  const body = await request.text()
  if (body.length > 2_000) return refuse('Invalid screenshot result', 400)
  let parsed: ReturnType<typeof screenshotResult.safeParse>
  try {
    parsed = screenshotResult.safeParse(JSON.parse(body))
  } catch {
    return refuse('Invalid screenshot result', 400)
  }
  if (!parsed.success) return refuse('Invalid screenshot result', 400)
  const done = await finishScreenshot(db, parsed.data)
  if (!done.ok)
    return NextResponse.json(
      { error: 'Screenshot not recorded', code: done.code },
      { status: done.code === 'PT409' ? 409 : 500, headers: noStore }
    )
  return NextResponse.json({ ok: true }, { headers: noStore })
}
