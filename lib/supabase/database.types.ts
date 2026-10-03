export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audiences: {
        Row: {
          account_id: string
          canonical_key: string
          created_at: string
          excluded_provider_ids: string[]
          id: string
          label: string
          provider_id: string
          synthetic: boolean
          tenant_id: string
        }
        Insert: {
          account_id: string
          canonical_key: string
          created_at?: string
          excluded_provider_ids: string[]
          id?: string
          label: string
          provider_id: string
          synthetic?: boolean
          tenant_id: string
        }
        Update: {
          account_id?: string
          canonical_key?: string
          created_at?: string
          excluded_provider_ids?: string[]
          id?: string
          label?: string
          provider_id?: string
          synthetic?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'audiences_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      brand_profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_revision: number | null
          brand_name: string
          corrections: Json
          created_at: string
          domain: string
          positioning: string
          prohibitions: string
          revision: number
          synthetic: boolean
          tenant_id: string
          updated_at: string
          voice: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_revision?: number | null
          brand_name: string
          corrections?: Json
          created_at?: string
          domain?: string
          positioning?: string
          prohibitions?: string
          revision?: number
          synthetic?: boolean
          tenant_id: string
          updated_at?: string
          voice?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_revision?: number | null
          brand_name?: string
          corrections?: Json
          created_at?: string
          domain?: string
          positioning?: string
          prohibitions?: string
          revision?: number
          synthetic?: boolean
          tenant_id?: string
          updated_at?: string
          voice?: string
        }
        Relationships: [
          {
            foreignKeyName: 'brand_profiles_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'brand_profiles_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: true
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      calendar_plans: {
        Row: {
          created_at: string
          created_by: string
          id: string
          input_revisions: Json
          lineage: Json
          starts_at: string
          synthetic: boolean
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          input_revisions: Json
          lineage: Json
          starts_at: string
          synthetic?: boolean
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          input_revisions?: Json
          lineage?: Json
          starts_at?: string
          synthetic?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'calendar_plans_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'calendar_plans_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      campaign_approvals: {
        Row: {
          actor_id: string
          campaign_id: string
          created_at: string
          id: string
          kind: string
          revision: number
          tenant_id: string
        }
        Insert: {
          actor_id: string
          campaign_id: string
          created_at?: string
          id?: string
          kind: string
          revision: number
          tenant_id: string
        }
        Update: {
          actor_id?: string
          campaign_id?: string
          created_at?: string
          id?: string
          kind?: string
          revision?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_approvals_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_approvals_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      campaign_comments: {
        Row: {
          actor_id: string
          body: string
          campaign_id: string
          created_at: string
          id: string
          tenant_id: string
        }
        Insert: {
          actor_id: string
          body: string
          campaign_id: string
          created_at?: string
          id?: string
          tenant_id: string
        }
        Update: {
          actor_id?: string
          body?: string
          campaign_id?: string
          created_at?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_comments_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_comments_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      campaign_content: {
        Row: {
          body: string
          campaign_id: string
          created_at: string
          created_by: string
          cta: string
          id: string
          preheader: string
          primary_url: string
          revision: number
          subject: string
          subject_options: string[]
          tenant_id: string
        }
        Insert: {
          body?: string
          campaign_id: string
          created_at?: string
          created_by: string
          cta?: string
          id?: string
          preheader?: string
          primary_url?: string
          revision: number
          subject?: string
          subject_options?: string[]
          tenant_id: string
        }
        Update: {
          body?: string
          campaign_id?: string
          created_at?: string
          created_by?: string
          cta?: string
          id?: string
          preheader?: string
          primary_url?: string
          revision?: number
          subject?: string
          subject_options?: string[]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_content_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_content_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      campaign_events: {
        Row: {
          action: string
          actor_id: string
          campaign_id: string
          created_at: string
          detail: Json
          id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id: string
          campaign_id: string
          created_at?: string
          detail?: Json
          id?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          campaign_id?: string
          created_at?: string
          detail?: Json
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_events_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      campaigns: {
        Row: {
          audience_id: string | null
          calendar_revision: number
          calendar_state: string
          channel: string
          copy_revision: number
          copy_state: string
          created_at: string
          created_by: string
          delivery_revision: number
          delivery_state: string
          design_revision: number
          design_state: string
          goal: string
          id: string
          lineage: Json
          offer_id: string | null
          planned_at: string
          product_id: string | null
          reference_notes: string
          sequence_id: string | null
          sequence_position: number | null
          synthetic: boolean
          tenant_id: string
          timezone: string
          title: string
          updated_at: string
        }
        Insert: {
          audience_id?: string | null
          calendar_revision?: number
          calendar_state?: string
          channel: string
          copy_revision?: number
          copy_state?: string
          created_at?: string
          created_by: string
          delivery_revision?: number
          delivery_state?: string
          design_revision?: number
          design_state?: string
          goal?: string
          id?: string
          lineage?: Json
          offer_id?: string | null
          planned_at: string
          product_id?: string | null
          reference_notes?: string
          sequence_id?: string | null
          sequence_position?: number | null
          synthetic?: boolean
          tenant_id: string
          timezone: string
          title: string
          updated_at?: string
        }
        Update: {
          audience_id?: string | null
          calendar_revision?: number
          calendar_state?: string
          channel?: string
          copy_revision?: number
          copy_state?: string
          created_at?: string
          created_by?: string
          delivery_revision?: number
          delivery_state?: string
          design_revision?: number
          design_state?: string
          goal?: string
          id?: string
          lineage?: Json
          offer_id?: string | null
          planned_at?: string
          product_id?: string | null
          reference_notes?: string
          sequence_id?: string | null
          sequence_position?: number | null
          synthetic?: boolean
          tenant_id?: string
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaigns_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaigns_tenant_id_audience_id_fkey'
            columns: ['tenant_id', 'audience_id']
            isOneToOne: false
            referencedRelation: 'audiences'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'campaigns_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaigns_tenant_id_offer_id_fkey'
            columns: ['tenant_id', 'offer_id']
            isOneToOne: false
            referencedRelation: 'offers'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'campaigns_tenant_id_product_id_fkey'
            columns: ['tenant_id', 'product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      designer_tenant_access: {
        Row: {
          created_at: string
          designer_id: string
          granted_by: string | null
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          designer_id: string
          granted_by?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          designer_id?: string
          granted_by?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'designer_tenant_access_designer_id_fkey'
            columns: ['designer_id']
            isOneToOne: false
            referencedRelation: 'designers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'designer_tenant_access_granted_by_fkey'
            columns: ['granted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'designer_tenant_access_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      designers: {
        Row: {
          activated_at: string | null
          activation_sent_at: string | null
          created_at: string
          id: string
          last_login_at: string | null
          profile_id: string
          status: Database['public']['Enums']['designer_status']
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activation_sent_at?: string | null
          created_at?: string
          id?: string
          last_login_at?: string | null
          profile_id: string
          status?: Database['public']['Enums']['designer_status']
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activation_sent_at?: string | null
          created_at?: string
          id?: string
          last_login_at?: string | null
          profile_id?: string
          status?: Database['public']['Enums']['designer_status']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'designers_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      offers: {
        Row: {
          approved_by: string
          conditions: string
          created_at: string
          depth_percent: number
          ends_at: string
          id: string
          kind: string
          label: string
          revision: number
          starts_at: string
          synthetic: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_by: string
          conditions: string
          created_at?: string
          depth_percent?: number
          ends_at: string
          id?: string
          kind: string
          label: string
          revision?: number
          starts_at: string
          synthetic?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_by?: string
          conditions?: string
          created_at?: string
          depth_percent?: number
          ends_at?: string
          id?: string
          kind?: string
          label?: string
          revision?: number
          starts_at?: string
          synthetic?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'offers_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'offers_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      platform_admins: {
        Row: {
          accepted_at: string | null
          active: boolean
          created_at: string
          invited_at: string | null
          profile_id: string
          role: Database['public']['Enums']['platform_admin_role']
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          active?: boolean
          created_at?: string
          invited_at?: string | null
          profile_id: string
          role?: Database['public']['Enums']['platform_admin_role']
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          active?: boolean
          created_at?: string
          invited_at?: string | null
          profile_id?: string
          role?: Database['public']['Enums']['platform_admin_role']
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'platform_admins_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: true
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      products: {
        Row: {
          created_at: string
          currency: string
          id: string
          price_minor: number
          source: string
          stock: number
          stock_observed_at: string
          synthetic: boolean
          tenant_id: string
          title: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          price_minor?: number
          source: string
          stock?: number
          stock_observed_at: string
          synthetic?: boolean
          tenant_id: string
          title: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          price_minor?: number
          source?: string
          stock?: number
          stock_observed_at?: string
          synthetic?: boolean
          tenant_id?: string
          title?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: 'products_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          job_title: string | null
          phone: string | null
          status: Database['public']['Enums']['profile_status']
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          job_title?: string | null
          phone?: string | null
          status?: Database['public']['Enums']['profile_status']
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          job_title?: string | null
          phone?: string | null
          status?: Database['public']['Enums']['profile_status']
          updated_at?: string
        }
        Relationships: []
      }
      tenant_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          revoked_at: string | null
          role: Database['public']['Enums']['tenant_role']
          tenant_id: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by: string
          revoked_at?: string | null
          role: Database['public']['Enums']['tenant_role']
          tenant_id: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          revoked_at?: string | null
          role?: Database['public']['Enums']['tenant_role']
          tenant_id?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tenant_invites_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tenant_invites_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      tenant_memberships: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_by: string | null
          profile_id: string
          role: Database['public']['Enums']['tenant_role']
          status: Database['public']['Enums']['membership_status']
          tenant_id: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          profile_id: string
          role?: Database['public']['Enums']['tenant_role']
          status?: Database['public']['Enums']['membership_status']
          tenant_id: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          profile_id?: string
          role?: Database['public']['Enums']['tenant_role']
          status?: Database['public']['Enums']['membership_status']
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'tenant_memberships_invited_by_fkey'
            columns: ['invited_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tenant_memberships_profile_id_fkey'
            columns: ['profile_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'tenant_memberships_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          onboarding_state: Database['public']['Enums']['onboarding_state']
          slug: string
          status: Database['public']['Enums']['tenant_status']
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          onboarding_state?: Database['public']['Enums']['onboarding_state']
          slug: string
          status?: Database['public']['Enums']['tenant_status']
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          onboarding_state?: Database['public']['Enums']['onboarding_state']
          slug?: string
          status?: Database['public']['Enums']['tenant_status']
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_campaign_note: {
        Args: { body: string; t: string; target_id: string }
        Returns: undefined
      }
      approve_brand: {
        Args: { expected_revision: number; t: string }
        Returns: undefined
      }
      approve_calendar: {
        Args: { expected_revision: number; t: string; target_id: string }
        Returns: undefined
      }
      create_offer: {
        Args: {
          conditions: string
          depth_percent: number
          ends_at: string
          kind: string
          label: string
          starts_at: string
          t: string
        }
        Returns: string
      }
      create_product: {
        Args: {
          price_minor: number
          stock: number
          t: string
          title: string
          url: string
        }
        Returns: string
      }
      create_tenant_workspace: {
        Args: {
          workspace_name: string
          workspace_slug: string
          workspace_timezone?: string
        }
        Returns: string
      }
      resolve_admin_context: {
        Args: never
        Returns: {
          admin_role: Database['public']['Enums']['platform_admin_role']
        }[]
      }
      resolve_client_context: {
        Args: { requested_tenant_id?: string }
        Returns: {
          tenant_id: string
          tenant_name: string
          tenant_role: Database['public']['Enums']['tenant_role']
          tenant_slug: string
          tenant_timezone: string
        }[]
      }
      resolve_designer_context: {
        Args: never
        Returns: {
          designer_id: string
        }[]
      }
      save_brand: {
        Args: {
          brand_name: string
          domain: string
          expected_revision: number
          positioning: string
          prohibitions: string
          t: string
          voice: string
        }
        Returns: undefined
      }
      save_campaign: {
        Args: {
          expected_revision?: number
          input?: Json
          t: string
          target_id?: string
        }
        Returns: string
      }
    }
    Enums: {
      designer_status: 'invited' | 'active' | 'inactive'
      membership_status: 'invited' | 'active' | 'inactive'
      onboarding_state: 'pending' | 'in_progress' | 'complete'
      platform_admin_role: 'super_admin' | 'admin'
      profile_status: 'active' | 'inactive'
      tenant_role: 'owner' | 'admin' | 'staff'
      tenant_status: 'active' | 'paused'
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {}
  },
  public: {
    Enums: {
      designer_status: ['invited', 'active', 'inactive'],
      membership_status: ['invited', 'active', 'inactive'],
      onboarding_state: ['pending', 'in_progress', 'complete'],
      platform_admin_role: ['super_admin', 'admin'],
      profile_status: ['active', 'inactive'],
      tenant_role: ['owner', 'admin', 'staff'],
      tenant_status: ['active', 'paused']
    }
  }
} as const
