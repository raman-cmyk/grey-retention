export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type Timestamped = { created_at: string; updated_at: string }

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Timestamped & {
          id: string
          full_name: string
          job_title: string | null
          phone: string | null
          status: Database['public']['Enums']['profile_status']
        }
        Insert: {
          id: string
          full_name?: string
          job_title?: string | null
          phone?: string | null
          status?: Database['public']['Enums']['profile_status']
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>
        Relationships: []
      }
      tenants: {
        Row: Timestamped & {
          id: string
          slug: string
          name: string
          status: Database['public']['Enums']['tenant_status']
          timezone: string
          onboarding_state: Database['public']['Enums']['onboarding_state']
        }
        Insert: {
          id?: string
          slug: string
          name: string
          status?: Database['public']['Enums']['tenant_status']
          timezone?: string
          onboarding_state?: Database['public']['Enums']['onboarding_state']
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['tenants']['Insert']>
        Relationships: []
      }
      platform_admins: {
        Row: Timestamped & {
          profile_id: string
          role: Database['public']['Enums']['platform_admin_role']
          active: boolean
          invited_at: string | null
          accepted_at: string | null
        }
        Insert: {
          profile_id: string
          role?: Database['public']['Enums']['platform_admin_role']
          active?: boolean
          invited_at?: string | null
          accepted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<
          Database['public']['Tables']['platform_admins']['Insert']
        >
        Relationships: []
      }
      tenant_memberships: {
        Row: Timestamped & {
          id: string
          tenant_id: string
          profile_id: string
          role: Database['public']['Enums']['tenant_role']
          status: Database['public']['Enums']['membership_status']
          invited_by: string | null
          accepted_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          profile_id: string
          role?: Database['public']['Enums']['tenant_role']
          status?: Database['public']['Enums']['membership_status']
          invited_by?: string | null
          accepted_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<
          Database['public']['Tables']['tenant_memberships']['Insert']
        >
        Relationships: []
      }
      tenant_invites: {
        Row: Timestamped & {
          id: string
          tenant_id: string
          email: string
          role: Database['public']['Enums']['tenant_role']
          token_hash: string
          expires_at: string
          invited_by: string
          accepted_at: string | null
          revoked_at: string | null
        }
        Insert: {
          id?: string
          tenant_id: string
          email: string
          role: Database['public']['Enums']['tenant_role']
          token_hash: string
          expires_at: string
          invited_by: string
          accepted_at?: string | null
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<
          Database['public']['Tables']['tenant_invites']['Insert']
        >
        Relationships: []
      }
      designers: {
        Row: Timestamped & {
          id: string
          profile_id: string
          status: Database['public']['Enums']['designer_status']
          activation_sent_at: string | null
          activated_at: string | null
          last_login_at: string | null
        }
        Insert: {
          id?: string
          profile_id: string
          status?: Database['public']['Enums']['designer_status']
          activation_sent_at?: string | null
          activated_at?: string | null
          last_login_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<Database['public']['Tables']['designers']['Insert']>
        Relationships: []
      }
      designer_tenant_access: {
        Row: Timestamped & {
          id: string
          designer_id: string
          tenant_id: string
          granted_by: string | null
        }
        Insert: {
          id?: string
          designer_id: string
          tenant_id: string
          granted_by?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: Partial<
          Database['public']['Tables']['designer_tenant_access']['Insert']
        >
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: {
      resolve_client_context: {
        Args: { requested_tenant_id?: string | null }
        Returns: {
          tenant_id: string
          tenant_role: Database['public']['Enums']['tenant_role']
          tenant_name: string
          tenant_slug: string
          tenant_timezone: string
        }[]
      }
      resolve_admin_context: {
        Args: Record<PropertyKey, never>
        Returns: {
          admin_role: Database['public']['Enums']['platform_admin_role']
        }[]
      }
      resolve_designer_context: {
        Args: Record<PropertyKey, never>
        Returns: { designer_id: string }[]
      }
      create_tenant_workspace: {
        Args: {
          workspace_name: string
          workspace_slug: string
          workspace_timezone?: string
        }
        Returns: string
      }
    }
    Enums: {
      profile_status: 'active' | 'inactive'
      tenant_status: 'active' | 'paused'
      onboarding_state: 'pending' | 'in_progress' | 'complete'
      tenant_role: 'owner' | 'admin' | 'staff'
      membership_status: 'invited' | 'active' | 'inactive'
      platform_admin_role: 'super_admin' | 'admin'
      designer_status: 'invited' | 'active' | 'inactive'
    }
    CompositeTypes: Record<string, never>
  }
}
