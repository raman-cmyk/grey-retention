'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { ActionResult } from '@/components/gros/action'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'

const hideForm = z.object({
  block: z.uuid(),
  hide: z.enum(['1', '0'])
})

/**
 * DES-ENGINE-004b: "Don't use this layout" (and "Use it again") on the
 * library screen. Owner and admins; the database checks the role, the
 * workspace and the block again (`set_library_block_hidden`, tenant first)
 * and keeps the hide to this workspace. Scratch never picks a hidden
 * layout.
 */
export async function setLayoutHidden(
  _state: ActionResult,
  form: FormData
): Promise<ActionResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner' && context.tenantRole !== 'admin')
    return { error: 'Only the owner or an admin can change this.' }
  const parsed = hideForm.safeParse(Object.fromEntries(form))
  if (!parsed.success) return { error: 'Reload the page and try again.' }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return { error: 'Please sign in again.' }
  const hide = parsed.data.hide === '1'
  const { error } = await db.rpc('set_library_block_hidden', {
    t: context.tenantId,
    block: parsed.data.block,
    hide
  })
  if (error) {
    if (error.code === '42501')
      return { error: 'Only the owner or an admin can change this.' }
    if (error.code === '22023')
      return { error: 'That layout is no longer in the library.' }
    return { error: 'That could not be saved. Try again.' }
  }
  revalidatePath('/inspiration/library')
  return {
    message: hide
      ? 'GROS will not use this layout for your emails.'
      : 'GROS may use this layout again.'
  }
}
