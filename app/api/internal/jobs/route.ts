import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import {
  cronAuthorized,
  localFixtureDispatch,
  scheduledDispatchAllowed
} from '@/features/cron/gate'
import { runScheduledJobs } from '@/features/cron/scheduler'
import { logger } from '@/lib/logger'
import { createServiceClient } from '@/lib/supabase/service'
import { runFixtureJobs } from '@/features/integrations/worker'
import { runInboxStep } from '@/features/inbox/step'
import { runStrategyRuns } from '@/features/strategy/worker'
import { scheduleLimits } from '@/features/cron/scheduler'
export const runtime = 'nodejs'
export const maxDuration = 60
const noStore = { 'cache-control': 'no-store' }

/**
 * Scheduled sweep: Vercel cron and the GitHub Actions schedule call this with
 * `Authorization: Bearer <CRON_SECRET>`. It first reads the Inspiration inbox
 * once (INB-001: Gmail when `INBOX_IMAP_USER` and `INBOX_IMAP_APP_PASSWORD`
 * are set, otherwise the sample inbox), keeps the images of new emails
 * (INB-002), at most 18 seconds together, then runs due
 * jobs for every active workspace in bounded batches through the fixture
 * adapters only, in what is left of the 40-second budget. The inbox does
 * not depend on `ADAPTER_MODE`; the workspace jobs do.
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
  const started = Date.now()
  // Never throws and never waits more than 18 s: an inbox problem is
  // reported and the sweep goes on.
  const inbox = await runInboxStep(db)
  // "Plan next 15 days" steps (STR-003): a failure stays queued for the next run.
  const plans = await runStrategyRuns(db).catch((error) => {
    logger.error('Plan steps could not run', {
      code: (error as { code?: string }).code ?? 'plan_step_error'
    })
    return { ran: 0 }
  })
  if (!scheduledDispatchAllowed(process.env.ADAPTER_MODE))
    return NextResponse.json(
      {
        error: 'Scheduled jobs run only with sample providers in this build.',
        inbox
      },
      { status: 503, headers: noStore }
    )
  try {
    const run = await runScheduledJobs(db, {
      limits: {
        budgetMs: Math.max(
          5_000,
          scheduleLimits.budgetMs - (Date.now() - started)
        )
      }
    })
    logger.info('Scheduled job run finished', run)
    return NextResponse.json(
      { live: false, ...run, inbox, plans },
      { headers: noStore }
    )
  } catch (error) {
    logger.error('Scheduled job run could not start', {
      code: (error as { code?: string }).code ?? 'scheduler_error'
    })
    return NextResponse.json(
      { error: 'Scheduled run failed; queued work stays for the next run.' },
      { status: 500, headers: noStore }
    )
  }
}

/** Loopback-only fixture dispatch for one workspace (local tests). */
export async function POST(request: NextRequest) {
  if (
    !cronAuthorized(
      request.headers.get('authorization'),
      process.env.CRON_SECRET
    )
  )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (
    !localFixtureDispatch(
      process.env.ADAPTER_MODE,
      process.env.NEXT_PUBLIC_SUPABASE_URL
    )
  )
    return NextResponse.json(
      { error: 'Only explicit loopback fixture dispatch is available.' },
      { status: 503 }
    )
  try {
    const reader = request.body?.getReader()
    if (!reader)
      return NextResponse.json({ error: 'Body required' }, { status: 400 })
    let bytes = 0,
      text = ''
    const decoder = new TextDecoder()
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 2048) {
        await reader.cancel()
        return NextResponse.json({ error: 'Body too large' }, { status: 413 })
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    const input = z
      .object({
        tenantId: z.uuid(),
        limit: z.number().int().min(1).max(4).default(4)
      })
      .strict()
      .safeParse(JSON.parse(text))
    if (!input.success)
      return NextResponse.json(
        { error: 'Validated tenant and bounded limit required' },
        { status: 400 }
      )
    const db = createServiceClient()
    if (!db)
      return NextResponse.json(
        { error: 'Local service configuration unavailable' },
        { status: 503 }
      )
    const processed = await runFixtureJobs(
      db,
      input.data.tenantId,
      input.data.limit
    )
    return NextResponse.json({ synthetic: true, processed, live: false })
  } catch {
    return NextResponse.json(
      { error: 'Fixture dispatch failed; inspect sanitized job diagnostics.' },
      { status: 400 }
    )
  }
}
