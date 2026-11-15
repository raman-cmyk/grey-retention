import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import {
  finishRender,
  renderJobs,
  renderResult,
  rendersWaiting
} from '@/features/studio/render-jobs'
import { logger } from '@/lib/logger'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 30
const noStore = { 'cache-control': 'no-store' }

const refuse = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: noStore })

/**
 * The section browser (DST-001b) calls this with `Authorization: Bearer
 * <CRON_SECRET>`: GET hands out one designed section to draw (its page, its
 * origins and a signed upload link), GET `?peek=1` only says how many are
 * waiting, and POST records one result. The browser runs outside the app
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
  try {
    if (request.nextUrl.searchParams.get('peek') === '1')
      return NextResponse.json(
        { waiting: await rendersWaiting(db) },
        { headers: noStore }
      )
    return NextResponse.json(
      { jobs: await renderJobs(db) },
      { headers: noStore }
    )
  } catch (error) {
    logger.error('Render jobs could not be handed out', {
      code: (error as { code?: string }).code ?? 'render_jobs_error'
    })
    return refuse('Render jobs unavailable; they stay queued.', 500)
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
    return refuse('Invalid render result', 400)
  const body = await request.text()
  if (body.length > 2_000) return refuse('Invalid render result', 400)
  let parsed: ReturnType<typeof renderResult.safeParse>
  try {
    parsed = renderResult.safeParse(JSON.parse(body))
  } catch {
    return refuse('Invalid render result', 400)
  }
  if (!parsed.success) return refuse('Invalid render result', 400)
  const done = await finishRender(db, parsed.data)
  if (!done.ok)
    return NextResponse.json(
      { error: 'Render not recorded', code: done.code },
      {
        status: done.code === 'PT409' ? 409 : done.code === '23514' ? 422 : 500,
        headers: noStore
      }
    )
  return NextResponse.json({ ok: true }, { headers: noStore })
}
