'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/components/gros/action'
import { inUse } from '@/features/agents/memory'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { defaultBrandPresentation } from '@/lib/branding/presentation'
import { createClient } from '@/lib/supabase/server'

/**
 * The owner's Remove and Pin on the Learned page (UI-LRNa, UI-LRNb). Only
 * the workspace's owner; the database checks it again, keeps each command
 * to the workspace's own rules and refuses a stale page (PT409). Each
 * answer says what was done, in plain words, so the page can say it after
 * the rule's row is gone.
 */
const assistant = defaultBrandPresentation.assistantName
const ownerOnly = `Only this workspace’s owner can change what ${assistant} learned.`
const stale =
  'This rule changed in another window. Open Learned again, then try again.'
const gone = `${assistant} no longer uses this rule. Open Learned again.`

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
  failed: (input: F) => string,
  done: (db: Db, args: Args, input: F) => Promise<string>
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
            : error.details === 'not_active'
              ? gone
              : stale
      }
    // The owner was checked above: the rule is not this workspace's (any more).
    if (error.code === '42501') return { error: gone }
    return { error: failed(input) }
  }
  const message = await done(db, args, input)
  revalidatePath('/learned')
  revalidatePath('/home')
  return { message }
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
    () => 'We could not remove the rule. Nothing was changed.',
    async () => `Removed. ${assistant} no longer uses this rule.`
  )
}

/**
 * Whether agents still use a rule just unpinned: an unsure or ended rule
 * stays only while pinned. Unknown when it cannot be read.
 */
async function stillUsed(db: Db, args: Args) {
  const { data, error } = await db
    .from('agent_memory_rules')
    .select('status,confidence,expires_at')
    .eq('tenant_id', args.t)
    .eq('id', args.rule)
    .maybeSingle()
  if (error || !data) return null
  return inUse(
    {
      status: data.status === 'active' ? 'active' : 'retired',
      pinned: false,
      confidence: Number(data.confidence),
      expiresAt: data.expires_at
    },
    Date.now()
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
      `We could not ${input.pinned === 'true' ? 'pin' : 'unpin'} the rule. Nothing was changed.`,
    async (db, args, input) => {
      if (input.pinned === 'true')
        return `Pinned. ${assistant} keeps using this rule.`
      const used = await stillUsed(db, args)
      return used === false
        ? `Unpinned. ${assistant} stopped using this rule: it is not sure enough of it, or its time ended.`
        : used
          ? `Unpinned. ${assistant} still uses this rule.`
          : 'Unpinned.'
    }
  )
}
