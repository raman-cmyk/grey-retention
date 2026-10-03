import 'server-only'

import { cookies } from 'next/headers'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { Route } from 'next'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import type {
  AdminRequestContext,
  AuthSurface,
  ClientRequestContext,
  DesignerRequestContext,
  RequestContext
} from '../domain/types'

export const activeTenantCookieName = 'gr-active-tenant'

const loginBySurface: Record<AuthSurface, Route> = {
  client: '/login',
  admin: '/admin/login',
  designer: '/designer/login'
}

const uuidSchema = z.uuid()

const demoContexts: Record<AuthSurface, RequestContext> = {
  client: {
    kind: 'client',
    userId: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-000000000101',
    tenantRole: 'owner',
    tenantName: 'Grey Retention Demo',
    tenantSlug: 'grey-retention-demo',
    timezone: 'Asia/Kathmandu'
  },
  admin: {
    kind: 'admin',
    userId: '00000000-0000-4000-8000-000000000002',
    adminRole: 'super_admin'
  },
  designer: {
    kind: 'designer',
    userId: '00000000-0000-4000-8000-000000000003',
    designerId: '00000000-0000-4000-8000-000000000201'
  }
}

function demoContext(surface: AuthSurface) {
  if (process.env.AUTH_MODE !== 'demo') return null
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_MODE=demo is forbidden in production')
  }
  return demoContexts[surface]
}

export const resolveRequestContext = cache(
  async (surface: AuthSurface): Promise<RequestContext | null> => {
    const demo = demoContext(surface)
    if (demo) return demo

    const supabase = await createClient()
    if (!supabase) return null

    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims()
    const userId = claimsData?.claims?.sub
    if (claimsError || typeof userId !== 'string') return null

    if (surface === 'client') {
      const cookieStore = await cookies()
      const rawTenant = cookieStore.get(activeTenantCookieName)?.value
      const requestedTenant = uuidSchema.safeParse(rawTenant)
      const { data, error } = await supabase.rpc('resolve_client_context', {
        requested_tenant_id: requestedTenant.success
          ? requestedTenant.data
          : undefined
      })
      const row = data?.[0]
      if (error || !row) return null

      return {
        kind: 'client',
        userId,
        tenantId: row.tenant_id,
        tenantRole: row.tenant_role,
        tenantName: row.tenant_name,
        tenantSlug: row.tenant_slug,
        timezone: row.tenant_timezone
      } satisfies ClientRequestContext
    }

    if (surface === 'admin') {
      const { data, error } = await supabase.rpc('resolve_admin_context')
      const row = data?.[0]
      if (error || !row) return null
      return {
        kind: 'admin',
        userId,
        adminRole: row.admin_role
      } satisfies AdminRequestContext
    }

    const { data, error } = await supabase.rpc('resolve_designer_context')
    const row = data?.[0]
    if (error || !row) return null
    return {
      kind: 'designer',
      userId,
      designerId: row.designer_id
    } satisfies DesignerRequestContext
  }
)

export async function requireRequestContext<TSurface extends AuthSurface>(
  surface: TSurface
): Promise<Extract<RequestContext, { kind: TSurface }>> {
  const context = await resolveRequestContext(surface)
  if (!context || context.kind !== surface) {
    redirect(loginBySurface[surface])
  }
  return context as Extract<RequestContext, { kind: TSurface }>
}
