import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import { runTagging } from '@/features/inbox/tag-run'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 60
const noStore = { 'cache-control': 'no-store' }

/**
 * The tagging run (CI-003): the scheduled GitHub Actions job calls this with
 * `Authorization: Bearer <CRON_SECRET>` between sweeps. It tags waiting
 * Inspiration emails for up to 45 seconds and answers with counts only.
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
  const run = await runTagging(db)
  return NextResponse.json(run, {
    status: run.state === 'done' ? 200 : 500,
    headers: noStore
  })
}
