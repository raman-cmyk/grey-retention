'use server'
import { revalidatePath } from 'next/cache'
import { createClient as createStatelessClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { requireRequestContext } from '@/features/auth/application/request-context'
import { createClient } from '@/lib/supabase/server'

/** Result with an optional message per field, shown under that field. */
export type ProfileResult = {
  status?: 'success' | 'error'
  message?: string
  fieldErrors?: Partial<Record<string, string>>
}

const account = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Enter your name.')
    .max(120, 'Use at most 120 characters.'),
  jobTitle: z.string().trim().max(120, 'Use at most 120 characters.'),
  phone: z
    .string()
    .trim()
    .max(40, 'Use at most 40 characters.')
    .regex(/^[0-9+()\-.\s]*$/, 'Use digits, spaces and + ( ) - only.')
})

function errorsOf(issues: z.core.$ZodIssue[]) {
  const fieldErrors: Record<string, string> = {}
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form')
    fieldErrors[key] ??= issue.message
  }
  return fieldErrors
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
  message: 'Please sign in again. Your changes are still here.'
}

/** Name, job title and phone of the signed-in user (RLS: own row only). */
export async function updateAccount(
  _state: ProfileResult,
  form: FormData
): Promise<ProfileResult> {
  const parsed = account.safeParse({
    name: form.get('name') ?? '',
    jobTitle: form.get('jobTitle') ?? '',
    phone: form.get('phone') ?? ''
  })
  if (!parsed.success)
    return { status: 'error', fieldErrors: errorsOf(parsed.error.issues) }
  const current = await session()
  if (!current) return signedOut
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
  revalidatePath('/profile')
  revalidatePath('/', 'layout')
  return { status: 'success', message: 'Saved.' }
}

const passwords = z
  .object({
    current: z.string().min(1, 'Enter your current password.'),
    next: z
      .string()
      .min(8, 'Use at least 8 characters.')
      .max(72, 'Use at most 72 characters.'),
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

/**
 * Checks the current password first, with a separate client that keeps no
 * session (so the signed-in session is untouched), then sets the new one.
 */
export async function changePassword(
  _state: ProfileResult,
  form: FormData
): Promise<ProfileResult> {
  const parsed = passwords.safeParse({
    current: form.get('current') ?? '',
    next: form.get('next') ?? '',
    confirm: form.get('confirm') ?? ''
  })
  if (!parsed.success)
    return { status: 'error', fieldErrors: errorsOf(parsed.error.issues) }
  const current = await session()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!current || !current.user.email || !url || !anon) return signedOut
  const checker = createStatelessClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const verified = await checker.auth.signInWithPassword({
    email: current.user.email,
    password: parsed.data.current
  })
  if (verified.error || verified.data.user?.id !== current.user.id)
    return {
      status: 'error',
      fieldErrors: { current: 'That is not your current password.' }
    }
  await checker.auth.signOut({ scope: 'local' }).catch(() => undefined)
  const updated = await current.db.auth.updateUser({
    password: parsed.data.next
  })
  if (updated.error)
    return {
      status: 'error',
      message:
        'We could not change your password. Your old password still works.'
    }
  return { status: 'success', message: 'Password updated.' }
}
