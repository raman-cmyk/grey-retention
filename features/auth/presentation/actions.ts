'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { z } from 'zod'
import { clientEnvironment } from '@/lib/env/client'
import { createClient } from '@/lib/supabase/server'
import {
  activeTenantCookieName,
  resolveRequestContext
} from '../application/request-context'
import type {
  AuthActionState,
  AuthSurface,
  WorkspaceActionState
} from '../domain/types'

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase(),
  password: z.string().min(8, 'Password must contain at least 8 characters.')
})

const emailSchema = z.object({
  email: z.email('Enter a valid email address.').trim().toLowerCase()
})

const signupSchema = credentialsSchema.extend({
  name: z
    .string()
    .trim()
    .min(2, 'Name must contain at least 2 characters.')
    .max(100)
})

const resetSchema = z
  .object({
    password: z.string().min(12, 'Use at least 12 characters.'),
    confirmation: z.string()
  })
  .refine((value) => value.password === value.confirmation, {
    path: ['confirmation'],
    message: 'Passwords do not match.'
  })

const workspaceSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Use lowercase letters, numbers, and hyphens.'
    ),
  timezone: z.string().trim().min(1).max(100).default('UTC')
})

const landingBySurface: Record<AuthSurface, Route> = {
  client: '/dashboard',
  admin: '/admin/dashboard',
  designer: '/designer/dashboard'
}

function unavailable(): AuthActionState {
  return {
    status: 'error',
    message: 'Authentication is not configured in this environment.'
  }
}

export async function signIn(
  surface: AuthSurface,
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return {
      status: 'error',
      fieldErrors: parsed.error.flatten().fieldErrors
    }
  }

  const supabase = await createClient()
  if (!supabase) return unavailable()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    return { status: 'error', message: 'Email or password is incorrect.' }
  }
  if (surface === 'client' && !(await resolveRequestContext('client'))) {
    redirect('/onboarding' as Route)
  }
  redirect(landingBySurface[surface])
}

export async function signOut() {
  const supabase = await createClient()
  if (supabase) await supabase.auth.signOut()
  const cookieStore = await cookies()
  cookieStore.delete(activeTenantCookieName)
  redirect('/login')
}

export async function requestPasswordReset(
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = emailSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { status: 'error', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createClient()
  if (!supabase) return unavailable()
  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    {
      redirectTo: `${clientEnvironment.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`
    }
  )
  if (error)
    return { status: 'error', message: 'Reset request failed. Try again.' }
  return {
    status: 'success',
    message: 'If the account exists, a reset link is on its way.'
  }
}

export async function signUp(
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = signupSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { status: 'error', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createClient()
  if (!supabase) return unavailable()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.name } }
  })
  if (error) return { status: 'error', message: 'Account creation failed.' }
  return {
    status: 'success',
    message: 'Account created. Check your email to confirm access.'
  }
}

export async function updatePassword(
  _state: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { status: 'error', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createClient()
  if (!supabase) return unavailable()
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password
  })
  if (error)
    return { status: 'error', message: 'Password could not be updated.' }
  return {
    status: 'success',
    message: 'Password updated. You can now sign in.'
  }
}

export async function switchActiveTenant(tenantId: string) {
  const parsed = z.uuid().safeParse(tenantId)
  if (!parsed.success) return { ok: false as const }
  const supabase = await createClient()
  if (!supabase) return { ok: false as const }
  const { data, error } = await supabase.rpc('resolve_client_context', {
    requested_tenant_id: parsed.data
  })
  if (error || !data?.[0]) return { ok: false as const }

  const cookieStore = await cookies()
  cookieStore.set(activeTenantCookieName, parsed.data, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  })
  return { ok: true as const }
}

export async function createWorkspace(
  _state: WorkspaceActionState,
  formData: FormData
): Promise<WorkspaceActionState> {
  const parsed = workspaceSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return { status: 'error', fieldErrors: parsed.error.flatten().fieldErrors }
  }
  const supabase = await createClient()
  if (!supabase) return { status: 'error', message: unavailable().message }
  const { data: tenantId, error } = await supabase.rpc(
    'create_tenant_workspace',
    {
      workspace_name: parsed.data.name,
      workspace_slug: parsed.data.slug,
      workspace_timezone: parsed.data.timezone
    }
  )
  if (error || !tenantId) {
    return {
      status: 'error',
      message:
        error?.code === '23505'
          ? 'That workspace URL is already taken.'
          : 'Workspace could not be created.'
    }
  }
  const cookieStore = await cookies()
  cookieStore.set(activeTenantCookieName, tenantId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  })
  redirect('/dashboard')
}
