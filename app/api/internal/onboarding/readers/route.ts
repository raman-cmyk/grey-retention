import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import { runSiteReadings } from '@/features/onboarding/site/live'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 60
const noStore = { 'cache-control': 'no-store' }

/**
 * The onboarding readers' run (ONB-101): the scheduled GitHub Actions job
 * calls this with `Authorization: Bearer <CRON_SECRET>`. GET `?peek=1` only
 * says how many site reads are waiting; GET reads them (each within 30
 * seconds, every model call capped) and answers with counts only.
 */
export async function GET(request: NextRequest) {
  if (
    !cronAuthorized(
      request.headers.get('authorization'),
      process.env.CRON_SECRET
    )
  )
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: noStore }
    )
  const db = createServiceClient()
  if (!db)
    return NextResponse.json(
      { error: 'Server configuration unavailable' },
      { status: 503, headers: noStore }
    )
  if (request.nextUrl.searchParams.get('peek') === '1') {
    const waiting = await db.rpc('site_readings_waiting')
    return waiting.error
      ? NextResponse.json(
          { error: 'Waiting reads unavailable' },
          { status: 500, headers: noStore }
        )
      : NextResponse.json({ waiting: waiting.data ?? 0 }, { headers: noStore })
  }
  const run = await runSiteReadings(db)
  return NextResponse.json(run, {
    status: run.state === 'done' ? 200 : 500,
    headers: noStore
  })
}
