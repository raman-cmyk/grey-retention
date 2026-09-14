export type AuthSurface = 'client' | 'admin' | 'designer'

export type TenantRole = 'owner' | 'admin' | 'staff'
export type AdminRole = 'super_admin' | 'admin'

export type ClientRequestContext = {
  kind: 'client'
  userId: string
  tenantId: string
  tenantRole: TenantRole
  tenantName: string
  tenantSlug: string
  timezone: string
}

export type AdminRequestContext = {
  kind: 'admin'
  userId: string
  adminRole: AdminRole
}

export type DesignerRequestContext = {
  kind: 'designer'
  userId: string
  designerId: string
}

export type RequestContext =
  ClientRequestContext | AdminRequestContext | DesignerRequestContext

export type AuthActionState = {
  status: 'idle' | 'error' | 'success'
  message?: string
  fieldErrors?: Partial<
    Record<'name' | 'email' | 'password' | 'confirmation', string[]>
  >
}

export const initialAuthActionState: AuthActionState = { status: 'idle' }

export type WorkspaceActionState = {
  status: 'idle' | 'error'
  message?: string
  fieldErrors?: Partial<Record<'name' | 'slug' | 'timezone', string[]>>
}

export const initialWorkspaceActionState: WorkspaceActionState = {
  status: 'idle'
}
