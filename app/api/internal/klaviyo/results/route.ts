import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import { learnFromRecentResults } from '@/features/learning/run'
import { runResultsSync } from '@/features/results/live'
import { logger } from '@/lib/logger'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 60
const noStore = { 'cache-control': 'no-store' }

/**
 * The hourly results sync (LRN-001): the scheduled GitHub Actions job
 * calls this with `Authorization: Bearer <CRON_SECRET>`. GET `?peek=1`
 * only says how many checks are due; GET checks them (every Klaviyo
 * request capped, no new one past 35 s) and answers with counts only.
 * It only reads Klaviyo, and only with the owner's `KLAVIYO_MODE=live`.
 * Then it turns the results that turned final into do's and don'ts
 * (LRN-002, `learnFromRecentResults`; sample results never count).
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
    const waiting = await db.rpc('klaviyo_results_waiting')
    return waiting.error
      ? NextResponse.json(
          { error: 'Waiting checks unavailable' },
          { status: 500, headers: noStore }
        )
      : NextResponse.json({ waiting: waiting.data ?? 0 }, { headers: noStore })
  }
  try {
    const run = await runResultsSync(db)
    // LRN-002: what the final results teach, right after they are read
    // (code only, keyed writes; it never throws).
    const learned = await learnFromRecentResults(db)
    return NextResponse.json({ ...run, learned }, { headers: noStore })
  } catch (error) {
    logger.error('Email results run failed', {
      code: (error as { code?: string }).code ?? 'results_error'
    })
    return NextResponse.json(
      { state: 'failed', code: 'results_error' },
      { status: 500, headers: noStore }
    )
  }
}
