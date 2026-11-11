'use server'

import type { Route } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/logger'
import { runStrategyRuns } from './worker'

export type PlanFormState = { error?: string }

/** Runs the waiting step right after the reply; the cron picks up the rest. */
function runSoon() {
  after(async () => {
    const service = createServiceClient()
    if (!service) return
    try {
      await runStrategyRuns(service)
    } catch (error) {
      logger.error('Plan step could not start', {
        code: (error as { code?: string }).code ?? 'plan_step_error'
      })
    }
  })
}

/** "Plan next 15 days" (D17): only the workspace's owner starts a plan. */
export async function startPlan(): Promise<PlanFormState> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only this workspace’s owner plans its emails.' }
  const db = await createClient()
  if (!db) return { error: 'Planning is unavailable right now.' }
  const { error } = await db.rpc('start_strategy_run', {
    t: context.tenantId
  })
  if (error) return { error: 'We could not start the plan. Try again.' }
  runSoon()
  revalidatePath('/plan')
  redirect('/plan' as Route)
}

const pickForm = z.object({
  run: z.uuid(),
  mode: z.enum(['auto', 'none', 'picked']),
  offers: z.array(z.string().min(1).max(120)).max(20)
})

/** The owner's optional offer pick: picked offers, "you choose" or "none". */
export async function pickOffers(
  _state: PlanFormState,
  form: FormData
): Promise<PlanFormState> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only this workspace’s owner plans its emails.' }
  const parsed = pickForm.safeParse({
    run: form.get('run'),
    mode: form.get('mode'),
    offers: form.getAll('offers')
  })
  if (!parsed.success) return { error: 'Choose how to use your offers.' }
  const { run, mode, offers } = parsed.data
  if (mode === 'picked' && !offers.length)
    return { error: 'Tick at least one offer, or let us choose.' }
  const db = await createClient()
  if (!db) return { error: 'Planning is unavailable right now.' }
  const { error } = await db.rpc('pick_strategy_offers', {
    t: context.tenantId,
    run,
    pick: mode === 'picked' ? { mode, offers } : { mode }
  })
  if (error)
    return {
      error:
        error.code === 'PT409'
          ? 'This plan already moved on. Look again.'
          : 'We could not save your choice. Try again.'
    }
  runSoon()
  revalidatePath('/plan')
  redirect('/plan' as Route)
}
