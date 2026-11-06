import 'server-only'
import type { ClientRequestContext } from '@/features/auth/domain/types'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeSourceUrl,
  pastedLimits,
  pastedReferenceSchema,
  readablePastedText
} from './pasted'

export type PastedReferenceInput = Record<
  'requestKey' | 'subject' | 'body' | 'sourceDescription' | 'sourceUrl',
  string
>

export type SaveFailure =
  | 'too_long'
  | 'invalid'
  | 'bad_url'
  | 'unreadable'
  | 'signed_out'
  | 'conflict'
  | 'forbidden'
  | 'rejected'
  | 'failed'

/** `error` is the paste form's wording; other callers may word by `reason`. */
export type SavePastedResult =
  | { id: string; error?: undefined; reason?: undefined }
  | { id?: undefined; error: string; reason: SaveFailure }

/**
 * Saves an owner-pasted email exactly as received. Shared by the paste form
 * and the composer so both keep the same limits, messages and idempotency.
 * Callers check the owner role first; the database command checks it again.
 */
export async function savePastedReference(
  context: ClientRequestContext,
  raw: PastedReferenceInput
): Promise<SavePastedResult> {
  if (raw.body.length > pastedLimits.body)
    return {
      reason: 'too_long',
      error: `This email is too long to paste. Keep it under ${pastedLimits.body.toLocaleString('en')} characters.`
    }
  const parsed = pastedReferenceSchema.safeParse(raw)
  if (!parsed.success)
    return {
      reason: 'invalid',
      error:
        'Add a subject line (up to 200 characters) and the email text, then try again.'
    }
  const x = parsed.data
  const sourceUrl = normalizeSourceUrl(x.sourceUrl)
  if (sourceUrl === null)
    return {
      reason: 'bad_url',
      error:
        'Use a full web address starting with http:// or https://, or leave it blank.'
    }
  // The original is saved exactly as received; only the preview normalizes.
  const readable = readablePastedText(x.body)
  if (!readable)
    return {
      reason: 'unreadable',
      error:
        'We could not find readable text in this email. Paste the text people see, not only code or images.'
    }
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo')
    return {
      reason: 'signed_out',
      error: 'Please sign in again to save this email. Your text is still here.'
    }
  const result = await db.rpc('import_pasted_reference', {
    t: context.tenantId,
    request_key: x.requestKey,
    input: {
      subject: x.subject,
      body: x.body,
      readable_text: readable,
      source_description: x.sourceDescription,
      source_url: sourceUrl
    }
  })
  if (result.error || !result.data) {
    const code = result.error?.code
    const reason =
      code === 'PT409'
        ? 'conflict'
        : code === '42501'
          ? 'forbidden'
          : code === '23514'
            ? 'rejected'
            : 'failed'
    const messages = {
      conflict:
        'This form was already used to save a different email. Reload the page to paste another one.',
      forbidden: 'Ask your workspace owner to add reference emails.',
      rejected:
        'Check the subject, email text and web address, then try again.',
      failed:
        'We could not save this email. Your text is still here; try again.'
    } as const
    return { reason, error: messages[reason] }
  }
  return { id: result.data }
}
