import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import { runSourceReadings } from '@/features/onboarding/readers'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 60
const noStore = { 'cache-control': 'no-store' }

/**
 * The onboarding readers' run (ONB-101, ONB-102): the scheduled GitHub
 * Actions job calls this with `Authorization: Bearer <CRON_SECRET>`. GET
 * `?peek=1` only says how many source reads (site and catalog) are waiting;
 * GET reads them (each within 30 seconds, every model and Klaviyo call
 * capped) and answers with counts only.
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
    const waiting = await db.rpc('source_readings_waiting')
    return waiting.error
      ? NextResponse.json(
          { error: 'Waiting reads unavailable' },
          { status: 500, headers: noStore }
        )
      : NextResponse.json({ waiting: waiting.data ?? 0 }, { headers: noStore })
  }
  const run = await runSourceReadings(db)
  return NextResponse.json(run, {
    status: run.state === 'done' ? 200 : 500,
    headers: noStore
  })
}
