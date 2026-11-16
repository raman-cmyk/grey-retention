import { NextResponse, type NextRequest } from 'next/server'
import { cronAuthorized } from '@/features/cron/gate'
import { draftPusherFor } from '@/features/klaviyo-push/live'
import { runStudioBuilds } from '@/features/studio/builds'
import { logger } from '@/lib/logger'
import { createServiceClient } from '@/lib/supabase/service'
export const runtime = 'nodejs'
export const maxDuration = 120
/**
 * The steps' deadline, as the click's 110 s inside 120: a step is claimed
 * only while 50 s still fit before it, and every step (the studio's design
 * step has up to 90 s) ends by this deadline, inside the route's time.
 */
const budgetMs = 105_000
const noStore = { 'cache-control': 'no-store' }

/**
 * The design studio's job (DST-006b): the section browser calls this with
 * `Authorization: Bearer <CRON_SECRET>` after each run, and the design
 * steps waiting for their pictures go on with the agents. Only with the
 * owner's switches on (`DESIGN_STUDIO=on`, `EMAIL_BUILD_AGENTS=on`);
 * otherwise it answers `{ off: true }` and claims nothing. The draft push
 * is the fake one unless the owner's write switch is on (PSH-001).
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
  try {
    const result = await runStudioBuilds(db, {
      deadline: Date.now() + budgetMs,
      pusher: draftPusherFor(db)
    })
    return NextResponse.json(result, { headers: noStore })
  } catch (error) {
    logger.error('Waiting designs could not go on', {
      code: (error as { code?: string }).code ?? 'studio_builds_error'
    })
    return NextResponse.json(
      { error: 'Waiting designs could not go on; they stay waiting.' },
      { status: 500, headers: noStore }
    )
  }
}
