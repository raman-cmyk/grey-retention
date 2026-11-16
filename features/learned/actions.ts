'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/components/gros/action'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'

/**
 * The owner's Remove and Pin on the Learned page (UI-LRNa). Only the
 * workspace's owner; the database checks it again, keeps each command to
 * the workspace's own rules and refuses a stale page (PT409).
 */
const ownerOnly = 'Only this workspace’s owner can change what GROS learned.'
const stale =
  'This rule changed in another window. Open Learned again, then try again.'

const ruleForm = z.object({
  rule: z.uuid(),
  revision: z.coerce.number().int().min(1)
})
const pinForm = ruleForm.extend({ pinned: z.enum(['true', 'false']) })

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>
type Args = { t: string; rule: string; expected_revision: number }
type Failure = { code?: string; details?: string } | null

async function ownerCommand<F extends z.infer<typeof ruleForm>>(
  form: FormData,
  schema: z.ZodType<F>,
  run: (db: Db, args: Args, input: F) => PromiseLike<{ error: Failure }>,
  failed: (input: F) => string
): Promise<ActionResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner') return { error: ownerOnly }
  const parsed = schema.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Open Learned again, then try again.' }
  const db = await createClient()
  if (!db) return { error: 'Learned is unavailable right now. Try again.' }
  const input = parsed.data
  const args = {
    t: context.tenantId,
    rule: input.rule,
    expected_revision: input.revision
  }
  const { error } = await run(db, args, input)
  if (error) {
    if (error.code === 'PT409')
      return {
        error:
          error.details === 'too_many_pins'
            ? 'You have 20 pinned rules. Unpin one first.'
            : stale
      }
    if (error.code === '42501') return { error: ownerOnly }
    return { error: failed(input) }
  }
  revalidatePath('/learned')
  revalidatePath('/home')
  return {}
}

/** "Remove": agents stop using the rule. It is kept, marked as removed by the owner. */
export async function retireRule(
  _state: ActionResult,
  form: FormData
): Promise<ActionResult> {
  return ownerCommand(
    form,
    ruleForm,
    (db, args) => db.rpc('retire_memory_rule', args),
    () => 'We could not remove the rule. Nothing was changed.'
  )
}

/** "Pin" or "Unpin": agents read a pinned rule first, and it never expires. */
export async function pinRule(
  _state: ActionResult,
  form: FormData
): Promise<ActionResult> {
  return ownerCommand(
    form,
    pinForm,
    (db, args, input) =>
      db.rpc('pin_memory_rule', { ...args, pinned: input.pinned === 'true' }),
    (input) =>
      `We could not ${input.pinned === 'true' ? 'pin' : 'unpin'} the rule. Nothing was changed.`
  )
}
