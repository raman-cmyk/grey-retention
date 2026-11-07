'use server'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/features/auth/application/request-context'
import type { FormResult } from '@/components/ui/action-form'
import { getServerEnvironment } from '@/lib/env/server'
import { createClient } from '@/lib/supabase/server'
import { issueField, readDefaultsForm, type SettingsField } from './defaults'

/** The result, plus which field to show the error at (its tab opens). */
export type SettingsResult = FormResult & { field?: SettingsField }

function failed(error: { code?: string; message?: string }): SettingsResult {
  const text = error.message ?? ''
  if (error.code === 'PT409')
    return {
      error:
        'Your defaults changed in another window. Reload the page to see them, then save again.'
    }
  if (error.code === '42501')
    return { error: 'Only the workspace owner can change campaign defaults.' }
  if (error.code === '23514') {
    if (text.startsWith('Choose a product'))
      return {
        error:
          'That product is no longer in your catalogue. Choose another one.',
        field: 'featured_product'
      }
    if (text.startsWith('An audience cannot be in both'))
      return {
        error: 'A list or segment cannot be in both Send to and Don’t send to.',
        field: 'dont_send_to'
      }
    if (text.startsWith('Check the audiences'))
      return { error: 'Check the audiences and try again.', field: 'send_to' }
    if (text.startsWith('Primary link'))
      return {
        error: 'Primary link: use a full address that starts with https://',
        field: 'primary_link'
      }
    if (text.startsWith('Check the sender name'))
      return {
        error: 'Sender name: use one line of text.',
        field: 'sender_name'
      }
    return { error: 'Check the fields and try again.' }
  }
  return {
    error: 'We could not save your defaults. Nothing was changed. Try again.'
  }
}

/** "Save defaults": every tab at once; for new campaigns only. */
export async function saveCampaignDefaults(
  _state: SettingsResult,
  form: FormData
): Promise<SettingsResult> {
  const context = await requireRequestContext('client')
  if (context.tenantRole !== 'owner')
    return { error: 'Only the workspace owner can change campaign defaults.' }
  const db = await createClient()
  if (!db || getServerEnvironment().AUTH_MODE === 'demo')
    return { error: 'Please sign in again. Your changes are still here.' }
  const parsed = readDefaultsForm(form)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      error: issue?.message ?? 'Check the fields.',
      field: issue ? issueField(issue.path) : undefined
    }
  }
  const v = parsed.data
  const saved = await db.rpc('save_campaign_defaults', {
    t: context.tenantId,
    expected_revision: v.revision,
    // null means "no featured product"; the generated type omits null.
    featured_product_id: v.featuredProductId as string,
    sender_name: v.senderName,
    primary_link: v.primaryLink,
    send_to: v.sendTo,
    dont_send_to: v.dontSendTo,
    include_footer: v.includeFooter,
    footer_source: v.footerSource
  })
  if (saved.error) return failed(saved.error)
  revalidatePath('/settings')
  return { message: 'Defaults saved. The new campaign editor will use them.' }
}
