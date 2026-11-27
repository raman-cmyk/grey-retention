'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { localDate } from '@/features/holidays/entries'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { parseRevenueGoal } from './revenue-goal'
import { goalMoney, goalMonths, monthLabel, storeCurrency } from './settings'

/**
 * Owner pick #33: the revenue goal in Settings. The owner or an admin
 * types it in words ("$20k this month") for this month or next month; the
 * database command checks the role again and the revision the page read
 * (`set_revenue_goal`: PT409 when another window changed it).
 */
const editorsOnly = 'Only the owner or an admin can change the revenue goal.'
const reload = 'Reload the page and try again.'

type Rpc = {
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): PromiseLike<{
    data: unknown
    error: { code?: string; message?: string; details?: string } | null
  }>
}

const monthDay = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/)
const revision = z.coerce.number().int().min(0).max(1_000_000_000)
/** The months the page read, each with its revision: "2026-11-01:3,2026-12-01:0". */
const revisions = z
  .string()
  .max(60)
  .transform((text, ctx) => {
    const pairs = text.split(',').map((p) => p.split(':'))
    const out = new Map<string, number>()
    for (const [month, rev] of pairs) {
      const m = monthDay.safeParse(month)
      const r = revision.safeParse(rev)
      if (!m.success || !r.success || out.has(m.data)) {
        ctx.addIssue({ code: 'custom', message: 'bad revisions' })
        return z.NEVER
      }
      out.set(m.data, r.data)
    }
    return out
  })
const saveForm = z.object({
  goal: z.string().trim().min(1).max(120),
  revisions
})
const clearForm = z.object({ month: monthDay, revision })

async function editorSession() {
  const context = await requireRequestContext('client')
  if (!['owner', 'admin'].includes(context.tenantRole))
    return { error: editorsOnly } as const
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' } as const
  return { context, db } as const
}

function refused(error: { code?: string }, what: 'save' | 'remove') {
  if (error.code === 'PT409')
    return 'The revenue goal changed in another window. Reload the page, then try again.'
  if (error.code === '42501') return editorsOnly
  if (error.code === '23514') return 'Check the amount and the month.'
  return what === 'save'
    ? 'We could not save the revenue goal. Nothing was changed.'
    : 'We could not remove the revenue goal. Nothing was changed.'
}

/** "Save goal" in Settings: the goal in the owner's words. */
export async function saveRevenueGoal(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await editorSession()
  if ('error' in session) return { error: session.error }
  const parsed = saveForm.safeParse({
    goal: form.get('goal'),
    revisions: form.get('revisions')
  })
  if (!parsed.success)
    return parsed.error.issues.some((i) => i.path[0] === 'goal')
      ? { error: 'Type the goal, like $20k this month.' }
      : { error: reload }
  const { context, db } = session
  let today: string
  try {
    today = localDate(context.timezone, new Date())
  } catch {
    today = localDate('UTC', new Date())
  }
  let currency: string | null
  try {
    currency = await storeCurrency(db, context.tenantId)
  } catch {
    return { error: 'We could not save the revenue goal. Nothing was changed.' }
  }
  const goal = parseRevenueGoal(parsed.data.goal, {
    currency: currency ?? '',
    today
  })
  if (!goal)
    return {
      error: currency
        ? `Type one amount and at most one month, like ${goalMoney({ amount: 20_000, currency })} this month or 20k next month.`
        : 'Type one amount with its currency and at most one month, like 20,000 USD this month.'
    }
  if (currency && goal.currency !== currency)
    return {
      error: `Your store sells in ${currency}: type the goal in ${currency}.`
    }
  const allowed = goalMonths(today)
  const expected = parsed.data.revisions.get(goal.month)
  if (!allowed.includes(goal.month))
    return { error: 'Set a goal for this month or next month.' }
  if (expected === undefined) return { error: reload }
  const { error } = await (db as unknown as Rpc).rpc('set_revenue_goal', {
    t: context.tenantId,
    goal_month: goal.month,
    goal_amount: goal.amount,
    goal_currency: goal.currency,
    expected_revision: expected
  })
  if (error) return { error: refused(error, 'save') }
  revalidatePath('/settings')
  revalidatePath('/plan')
  return {
    message: `Saved. The goal for ${monthLabel(goal.month)} is ${goalMoney(goal)}; new 15-day plans work back from it.`
  }
}

/** "Remove" next to a month's goal. */
export async function clearRevenueGoal(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const session = await editorSession()
  if ('error' in session) return { error: session.error }
  const parsed = clearForm.safeParse({
    month: form.get('month'),
    revision: form.get('revision')
  })
  if (!parsed.success) return { error: reload }
  const { context, db } = session
  const { error } = await (db as unknown as Rpc).rpc('set_revenue_goal', {
    t: context.tenantId,
    goal_month: parsed.data.month,
    goal_amount: null,
    goal_currency: null,
    expected_revision: parsed.data.revision
  })
  if (error) return { error: refused(error, 'remove') }
  revalidatePath('/settings')
  revalidatePath('/plan')
  return {
    message: `Removed the goal for ${monthLabel(parsed.data.month)}. New plans have no goal for it.`
  }
}
