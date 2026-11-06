'use server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'
import { createStatelessClient } from '@/lib/supabase/stateless'
import { PASSWORD_MAX_BYTES, PASSWORD_MIN } from './rules'

/** Result with an optional message per field, shown under that field. */
export type ProfileResult = {
  status?: 'success' | 'error'
  message?: string
  fieldErrors?: Partial<Record<string, string>>
}

const bytes = (text: string) => new TextEncoder().encode(text).length

const account = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Use at least 2 characters.')
    .max(120, 'Use at most 120 characters.'),
  jobTitle: z.string().trim().max(120, 'Use at most 120 characters.'),
  phone: z
    .string()
    .trim()
    .max(40, 'Use at most 40 characters.')
    .regex(/^[0-9+().\- ]*$/, 'Use digits, spaces and + ( ) - . only.')
    .refine((v) => v === '' || /\d/.test(v), 'Add the phone number’s digits.')
})

const checkFields = 'Check the fields marked below.'

function invalid(issues: z.core.$ZodIssue[]): ProfileResult {
  const fieldErrors: Record<string, string> = {}
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form')
    fieldErrors[key] ??= issue.message
  }
  return { status: 'error', message: checkFields, fieldErrors }
}

async function session() {
  await requireRequestContext('client')
  const db = await createClient()
  if (!db || process.env.AUTH_MODE === 'demo') return null
  const user = await db.auth.getUser()
  if (user.error || !user.data.user) return null
  return { db, user: user.data.user }
}

const signedOut: ProfileResult = {
  status: 'error',
  message: 'Please sign in again.'
}

/** Name, job title and phone of the signed-in user (RLS: own row only). */
export async function updateAccount(
  _state: ProfileResult,
  form: FormData
): Promise<ProfileResult> {
  const current = await session()
  if (!current) return signedOut
  const parsed = account.safeParse({
    name: form.get('name') ?? '',
    jobTitle: form.get('jobTitle') ?? '',
    phone: form.get('phone') ?? ''
  })
  if (!parsed.success) return invalid(parsed.error.issues)
  const saved = await current.db
    .from('profiles')
    .update({
      full_name: parsed.data.name,
      job_title: parsed.data.jobTitle || null,
      phone: parsed.data.phone || null
    })
    .eq('id', current.user.id)
    .select('id')
  if (saved.error || !saved.data?.length)
    return {
      status: 'error',
      message: 'We could not save your details. Nothing was changed. Try again.'
    }
  // The sidebar shows the name, so refresh every page's layout.
  revalidatePath('/', 'layout')
  return { status: 'success', message: 'Saved.' }
}

const passwords = z
  .object({
    current: z
      .string()
      .min(1, 'Enter your current password.')
      .max(1000, 'That is not your current password.'),
    next: z
      .string()
      .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
      .refine(
        (v) => bytes(v) <= PASSWORD_MAX_BYTES,
        'Too long: use fewer characters (letters outside English count as 2–4).'
      ),
    confirm: z.string()
  })
  .refine((v) => v.next === v.confirm, {
    path: ['confirm'],
    message: 'The new passwords do not match.'
  })
  .refine((v) => v.next !== v.current, {
    path: ['next'],
    message: 'Choose a password different from your current one.'
  })

type AuthError = { code?: string; status?: number } | null
const tooMany = (error: AuthError) =>
  error?.status === 429 || error?.code === 'over_request_rate_limit'
const tooManyResult: ProfileResult = {
  status: 'error',
  message: 'Too many attempts. Wait a few minutes, then try again.'
}

/**
 * Checks the current password first, with a separate client that keeps no
 * session (so the signed-in session is untouched), then sets the new one.
 * This guards the form; it is not a security boundary while Supabase
 * "secure password change" is off (see the register entry ACC-013).
 */
export async function changePassword(
  _state: ProfileResult,
  form: FormData
): Promise<ProfileResult> {
  const current = await session()
  if (!current || !current.user.email) return signedOut
  const parsed = passwords.safeParse({
    current: form.get('current') ?? '',
    next: form.get('next') ?? '',
    confirm: form.get('confirm') ?? ''
  })
  if (!parsed.success) return invalid(parsed.error.issues)
  const checker = createStatelessClient()
  if (!checker) return signedOut
  const verified = await checker.auth.signInWithPassword({
    email: current.user.email,
    password: parsed.data.current
  })
  await checker.auth.signOut({ scope: 'local' }).catch(() => undefined)
  if (tooMany(verified.error)) return tooManyResult
  if (verified.error?.code === 'invalid_credentials')
    return {
      status: 'error',
      message: checkFields,
      fieldErrors: { current: 'That is not your current password.' }
    }
  if (verified.error || verified.data.user?.id !== current.user.id)
    return {
      status: 'error',
      message:
        'We could not check your current password. Nothing was changed. Try again.'
    }
  const updated = await current.db.auth.updateUser({
    password: parsed.data.next
  })
  if (tooMany(updated.error)) return tooManyResult
  if (updated.error?.code === 'weak_password')
    return {
      status: 'error',
      message: checkFields,
      fieldErrors: {
        next: 'This password is too easy to guess. Choose a longer, less common one.'
      }
    }
  if (updated.error?.code === 'same_password')
    return {
      status: 'error',
      message: checkFields,
      fieldErrors: {
        next: 'Choose a password different from your current one.'
      }
    }
  if (updated.error)
    return {
      status: 'error',
      message:
        'We could not change your password. Your old password still works.'
    }
  return { status: 'success', message: 'Password updated.' }
}
