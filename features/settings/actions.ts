'use server'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { readDefaultsForm } from './defaults'

function failed(error: { code?: string; message?: string }) {
  const text = error.message ?? ''
  if (error.code === 'PT409')
    return 'Your defaults changed in another window. Reload the page to see them, then save again.'
  if (error.code === '42501')
    return 'Only the workspace owner can change campaign defaults.'
  if (error.code === '23514')
    return text.startsWith('Choose a product')
      ? 'That product is no longer in your catalogue. Choose another one.'
      : text.startsWith('An audience cannot be in both')
        ? 'A list or segment cannot be in both Send to and Don’t send to.'
        : 'Check the fields and try again.'
  return 'We could not save your defaults. Nothing was changed. Try again.'
}

/** "Save defaults": every tab at once; new campaigns only. */
export async function saveCampaignDefaults(
  _state: FormResult,
  form: FormData
): Promise<FormResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only the workspace owner can change campaign defaults.' }
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return { error: 'Please sign in again. Your changes are still here.' }
  const parsed = readDefaultsForm(form)
  if (!parsed.success)
    return { error: parsed.error.issues[0]?.message ?? 'Check the fields.' }
  const v = parsed.data
  const saved = await db.rpc('save_campaign_defaults', {
    t: context.tenantId,
    expected_revision: v.revision,
    featured_product_id: v.featuredProductId as string,
    sender_name: v.senderName,
    primary_link: v.primaryLink,
    send_to: v.sendTo,
    dont_send_to: v.dontSendTo,
    include_footer: v.includeFooter,
    footer_source: v.footerSource
  })
  if (saved.error) return { error: failed(saved.error) }
  revalidatePath('/settings')
  return { message: 'Defaults saved. New campaigns will start with them.' }
}
