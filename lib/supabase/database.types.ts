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
      ai_calls: {
        Row: {
          cost_micro_usd: number
          created_at: string
          feature: string
          id: string
          input_revisions: Json
          input_tokens: number
          job_id: string
          output_tokens: number
          prompt_version: string
          provider: string
          status: string
          tenant_id: string
        }
        Insert: {
          cost_micro_usd?: number
          created_at?: string
          feature: string
          id?: string
          input_revisions: Json
          input_tokens: number
          job_id: string
          output_tokens: number
          prompt_version: string
          provider: string
          status: string
          tenant_id: string
        }
        Update: {
          cost_micro_usd?: number
          created_at?: string
          feature?: string
          id?: string
          input_revisions?: Json
          input_tokens?: number
          job_id?: string
          output_tokens?: number
          prompt_version?: string
          provider?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ai_calls_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'ai_job'
            columns: ['job_id']
            isOneToOne: true
            referencedRelation: 'job_runs'
            referencedColumns: ['id']
          }
        ]
      }
      asset_events: {
        Row: {
          action: string
          actor_id: string | null
          asset_id: string
          created_at: string
          detail: Json
          id: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          asset_id: string
          created_at?: string
          detail: Json
          id?: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          asset_id?: string
          created_at?: string
          detail?: Json
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'asset_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'asset_events_tenant_id_asset_id_fkey'
            columns: ['tenant_id', 'asset_id']
            isOneToOne: false
            referencedRelation: 'assets'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'asset_events_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      asset_import_items: {
        Row: {
          asset_id: string | null
          error_code: string | null
          filename: string
          id: string
          import_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          asset_id?: string | null
          error_code?: string | null
          filename: string
          id?: string
          import_id: string
          status: string
          tenant_id: string
        }
        Update: {
          asset_id?: string | null
          error_code?: string | null
          filename?: string
          id?: string
          import_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'asset_import_items_tenant_id_asset_id_fkey'
            columns: ['tenant_id', 'asset_id']
            isOneToOne: false
            referencedRelation: 'assets'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'asset_import_items_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'asset_import_items_tenant_id_import_id_fkey'
            columns: ['tenant_id', 'import_id']
            isOneToOne: false
            referencedRelation: 'asset_imports'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      asset_imports: {
        Row: {
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          source: string
          state: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          idempotency_key: string
          source: string
          state?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          source?: string
          state?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'asset_imports_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'asset_imports_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      assets: {
        Row: {
          byte_size: number
          category: string | null
          classification_source: string | null
          confidence: number | null
          created_at: string
          filename: string
          id: string
          media_type: string
          product_id: string | null
          revision: number
          sha256: string
          source: string
          storage_path: string
          synthetic: boolean
          tenant_id: string
          updated_at: string
          uploaded_by: string
          variant_id: string | null
        }
        Insert: {
          byte_size: number
          category?: string | null
          classification_source?: string | null
          confidence?: number | null
          created_at?: string
          filename: string
          id?: string
          media_type: string
          product_id?: string | null
          revision?: number
          sha256: string
          source: string
          storage_path: string
          synthetic?: boolean
          tenant_id: string
          updated_at?: string
          uploaded_by: string
          variant_id?: string | null
        }
        Update: {
          byte_size?: number
          category?: string | null
          classification_source?: string | null
          confidence?: number | null
          created_at?: string
          filename?: string
          id?: string
          media_type?: string
          product_id?: string | null
          revision?: number
          sha256?: string
          source?: string
          storage_path?: string
          synthetic?: boolean
          tenant_id?: string
          updated_at?: string
          uploaded_by?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'assets_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'assets_tenant_id_product_id_fkey'
            columns: ['tenant_id', 'product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'assets_tenant_id_variant_id_fkey'
            columns: ['tenant_id', 'variant_id']
            isOneToOne: false
            referencedRelation: 'product_variants'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'assets_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      assignment_requests: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          requested_by: string
          state: string
          tenant_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          requested_by: string
          state?: string
          tenant_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          requested_by?: string
          state?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'assignment_requests_requested_by_fkey'
            columns: ['requested_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'assignment_requests_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'request_campaign_tenant'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
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
      autopilot_streaks: {
        Row: {
          consecutive_sends: number
          generation: number
          last_rejection_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          consecutive_sends?: number
          generation?: number
          last_rejection_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          consecutive_sends?: number
          generation?: number
          last_rejection_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'autopilot_streaks_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: true
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      brand_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          revision: number
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          revision: number
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          revision?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'brand_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'brand_events_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      brand_kits: {
        Row: {
          approved_by: string | null
          colors: string[]
          fonts: string[]
          revision: number
          source_text: string
          synthetic: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          colors?: string[]
          fonts?: string[]
          revision?: number
          source_text?: string
          synthetic?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          colors?: string[]
          fonts?: string[]
          revision?: number
          source_text?: string
          synthetic?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'brand_kits_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'brand_kits_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: true
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      brand_profile_sections: {
        Row: {
          content: Json
          edited_at: string | null
          edited_by: string | null
          generated_at: string | null
          locked: string[]
          revision: number
          section: string
          source: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          content?: Json
          edited_at?: string | null
          edited_by?: string | null
          generated_at?: string | null
          locked?: string[]
          revision?: number
          section: string
          source: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          content?: Json
          edited_at?: string | null
          edited_by?: string | null
          generated_at?: string | null
          locked?: string[]
          revision?: number
          section?: string
          source?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'brand_profile_sections_edited_by_fkey'
            columns: ['edited_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'brand_profile_sections_tenant_id_fkey'
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
      brand_versions: {
        Row: {
          created_at: string
          id: string
          recorded_by: string | null
          revision: number
          snapshot: Json
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          recorded_by?: string | null
          revision: number
          snapshot: Json
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          recorded_by?: string | null
          revision?: number
          snapshot?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'brand_versions_recorded_by_fkey'
            columns: ['recorded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'brand_versions_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      budget_alerts: {
        Row: {
          created_at: string
          cycle_id: string
          tenant_id: string
          window_key: string
        }
        Insert: {
          created_at?: string
          cycle_id: string
          tenant_id: string
          window_key: string
        }
        Update: {
          created_at?: string
          cycle_id?: string
          tenant_id?: string
          window_key?: string
        }
        Relationships: [
          {
            foreignKeyName: 'budget_alerts_cycle_id_fkey'
            columns: ['cycle_id']
            isOneToOne: false
            referencedRelation: 'package_cycles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'budget_alerts_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
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
          input_revisions: Json
          preheader: string
          primary_url: string
          revision: number
          subject: string
          subject_options: string[]
          tenant_id: string
          validation_errors: string[]
          validation_state: string
          verified_claims: Json
        }
        Insert: {
          body?: string
          campaign_id: string
          created_at?: string
          created_by: string
          cta?: string
          id?: string
          input_revisions?: Json
          preheader?: string
          primary_url?: string
          revision: number
          subject?: string
          subject_options?: string[]
          tenant_id: string
          validation_errors?: string[]
          validation_state?: string
          verified_claims?: Json
        }
        Update: {
          body?: string
          campaign_id?: string
          created_at?: string
          created_by?: string
          cta?: string
          id?: string
          input_revisions?: Json
          preheader?: string
          primary_url?: string
          revision?: number
          subject?: string
          subject_options?: string[]
          tenant_id?: string
          validation_errors?: string[]
          validation_state?: string
          verified_claims?: Json
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
      campaign_rejections: {
        Row: {
          actor_id: string
          campaign_id: string
          created_at: string
          id: string
          kind: string
          reason: string
          revision: number
          scope: string
          tenant_id: string
        }
        Insert: {
          actor_id: string
          campaign_id: string
          created_at?: string
          id?: string
          kind: string
          reason: string
          revision: number
          scope: string
          tenant_id: string
        }
        Update: {
          actor_id?: string
          campaign_id?: string
          created_at?: string
          id?: string
          kind?: string
          reason?: string
          revision?: number
          scope?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_rejections_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_rejections_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rejection_campaign_tenant'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      campaign_results: {
        Row: {
          clicks: number
          collected_at: string
          comparable: boolean
          complete: boolean
          confounders: Json
          created_at: string
          currency: string
          delivery_id: string
          id: string
          package_id: string
          recipients: number
          revenue_minor: number
          source: string
          spam: number
          tenant_id: string
          unsubscribes: number
          window_end: string
          window_key: string
          window_start: string
        }
        Insert: {
          clicks: number
          collected_at: string
          comparable: boolean
          complete: boolean
          confounders: Json
          created_at?: string
          currency: string
          delivery_id: string
          id?: string
          package_id: string
          recipients: number
          revenue_minor: number
          source: string
          spam: number
          tenant_id: string
          unsubscribes: number
          window_end: string
          window_key: string
          window_start: string
        }
        Update: {
          clicks?: number
          collected_at?: string
          comparable?: boolean
          complete?: boolean
          confounders?: Json
          created_at?: string
          currency?: string
          delivery_id?: string
          id?: string
          package_id?: string
          recipients?: number
          revenue_minor?: number
          source?: string
          spam?: number
          tenant_id?: string
          unsubscribes?: number
          window_end?: string
          window_key?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_results_delivery_id_fkey'
            columns: ['delivery_id']
            isOneToOne: false
            referencedRelation: 'fixture_deliveries'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_results_package_id_fkey'
            columns: ['package_id']
            isOneToOne: false
            referencedRelation: 'delivery_packages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_results_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      campaign_send_metadata: {
        Row: {
          campaign_id: string
          comparison_key: Json
          created_at: string
          package_id: string
          snapshot: Json
          subject_group: string
          tenant_id: string
        }
        Insert: {
          campaign_id: string
          comparison_key: Json
          created_at?: string
          package_id: string
          snapshot: Json
          subject_group: string
          tenant_id: string
        }
        Update: {
          campaign_id?: string
          comparison_key?: Json
          created_at?: string
          package_id?: string
          snapshot?: Json
          subject_group?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_send_metadata_package_id_fkey'
            columns: ['package_id']
            isOneToOne: true
            referencedRelation: 'delivery_packages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'campaign_send_metadata_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'campaign_send_metadata_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      campaign_sequences: {
        Row: {
          brief: string
          created_at: string
          id: string
          key: string
          plan_id: string
          tenant_id: string
        }
        Insert: {
          brief: string
          created_at?: string
          id?: string
          key: string
          plan_id: string
          tenant_id: string
        }
        Update: {
          brief?: string
          created_at?: string
          id?: string
          key?: string
          plan_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_sequences_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'sequence_plan_tenant'
            columns: ['tenant_id', 'plan_id']
            isOneToOne: false
            referencedRelation: 'calendar_plans'
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
          superseded_by_plan: string | null
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
          superseded_by_plan?: string | null
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
          superseded_by_plan?: string | null
          synthetic?: boolean
          tenant_id?: string
          timezone?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'campaign_sequence_tenant'
            columns: ['tenant_id', 'sequence_id']
            isOneToOne: false
            referencedRelation: 'campaign_sequences'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'campaign_superseded_tenant'
            columns: ['tenant_id', 'superseded_by_plan']
            isOneToOne: false
            referencedRelation: 'calendar_plans'
            referencedColumns: ['tenant_id', 'id']
          },
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
      chat_messages: {
        Row: {
          actor_id: string
          body: string
          conversation_id: string
          created_at: string
          evidence: Json
          id: string
          message_index: number
          role: string
          synthetic: boolean
          tenant_id: string
        }
        Insert: {
          actor_id: string
          body: string
          conversation_id: string
          created_at?: string
          evidence?: Json
          id?: string
          message_index: number
          role: string
          synthetic?: boolean
          tenant_id: string
        }
        Update: {
          actor_id?: string
          body?: string
          conversation_id?: string
          created_at?: string
          evidence?: Json
          id?: string
          message_index?: number
          role?: string
          synthetic?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chat_messages_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_messages_tenant_id_conversation_id_fkey'
            columns: ['tenant_id', 'conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      chat_proposals: {
        Row: {
          actor_id: string
          campaign_id: string
          confirmed_at: string | null
          consequence: string
          conversation_id: string
          created_at: string
          expires_at: string
          id: string
          kind: string
          payload: Json
          payload_hash: string | null
          status: string
          target_revisions: Json
          tenant_id: string
        }
        Insert: {
          actor_id: string
          campaign_id: string
          confirmed_at?: string | null
          consequence: string
          conversation_id: string
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          payload: Json
          payload_hash?: string | null
          status?: string
          target_revisions: Json
          tenant_id: string
        }
        Update: {
          actor_id?: string
          campaign_id?: string
          confirmed_at?: string | null
          consequence?: string
          conversation_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          payload?: Json
          payload_hash?: string | null
          status?: string
          target_revisions?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'chat_proposals_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'chat_proposals_tenant_id_conversation_id_fkey'
            columns: ['tenant_id', 'conversation_id']
            isOneToOne: false
            referencedRelation: 'conversations'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'proposal_campaign_tenant'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      competitor_captures: {
        Row: {
          created_at: string
          cursor: string | null
          domain: string
          id: string
          last_error: string | null
          last_received_at: string | null
          status: string
          synthetic: boolean
        }
        Insert: {
          created_at?: string
          cursor?: string | null
          domain: string
          id?: string
          last_error?: string | null
          last_received_at?: string | null
          status?: string
          synthetic?: boolean
        }
        Update: {
          created_at?: string
          cursor?: string | null
          domain?: string
          id?: string
          last_error?: string | null
          last_received_at?: string | null
          status?: string
          synthetic?: boolean
        }
        Relationships: []
      }
      competitor_emails: {
        Row: {
          capture_id: string
          created_at: string
          external_id: string
          id: string
          micro: Json
          received_at: string
          safe_html: string
          subject: string
          synthetic: boolean
          text_content: string
        }
        Insert: {
          capture_id: string
          created_at?: string
          external_id: string
          id?: string
          micro: Json
          received_at: string
          safe_html: string
          subject: string
          synthetic?: boolean
          text_content: string
        }
        Update: {
          capture_id?: string
          created_at?: string
          external_id?: string
          id?: string
          micro?: Json
          received_at?: string
          safe_html?: string
          subject?: string
          synthetic?: boolean
          text_content?: string
        }
        Relationships: [
          {
            foreignKeyName: 'competitor_emails_capture_id_fkey'
            columns: ['capture_id']
            isOneToOne: false
            referencedRelation: 'competitor_captures'
            referencedColumns: ['id']
          }
        ]
      }
      competitor_sequences: {
        Row: {
          capture_id: string
          confidence: string
          evidence_ids: string[]
          id: string
          key: string
          pattern: string
          synthetic: boolean
        }
        Insert: {
          capture_id: string
          confidence: string
          evidence_ids: string[]
          id?: string
          key: string
          pattern: string
          synthetic?: boolean
        }
        Update: {
          capture_id?: string
          confidence?: string
          evidence_ids?: string[]
          id?: string
          key?: string
          pattern?: string
          synthetic?: boolean
        }
        Relationships: [
          {
            foreignKeyName: 'competitor_sequences_capture_id_fkey'
            columns: ['capture_id']
            isOneToOne: false
            referencedRelation: 'competitor_captures'
            referencedColumns: ['id']
          }
        ]
      }
      competitor_subscriptions: {
        Row: {
          active: boolean
          capture_id: string
          created_at: string
          created_by: string
          id: string
          label: string
          private_rules: string
          revision: number
          tenant_id: string
        }
        Insert: {
          active?: boolean
          capture_id: string
          created_at?: string
          created_by: string
          id?: string
          label: string
          private_rules?: string
          revision?: number
          tenant_id: string
        }
        Update: {
          active?: boolean
          capture_id?: string
          created_at?: string
          created_by?: string
          id?: string
          label?: string
          private_rules?: string
          revision?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'competitor_subscriptions_capture_id_fkey'
            columns: ['capture_id']
            isOneToOne: false
            referencedRelation: 'competitor_captures'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'competitor_subscriptions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'competitor_subscriptions_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      conversations: {
        Row: {
          created_at: string
          creator_id: string
          id: string
          status: string
          tenant_id: string
          title: string
          visibility: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          id?: string
          status?: string
          tenant_id: string
          title: string
          visibility?: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          id?: string
          status?: string
          tenant_id?: string
          title?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: 'conversations_creator_id_fkey'
            columns: ['creator_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'conversations_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      copy_review_batches: {
        Row: {
          approved_at: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          revisions: Json
          status: string
          tenant_id: string
          timezone: string
          week_start: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          revisions: Json
          status?: string
          tenant_id: string
          timezone: string
          week_start: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          revisions?: Json
          status?: string
          tenant_id?: string
          timezone?: string
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: 'copy_review_batches_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'copy_review_batches_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      delivery_packages: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string
          id: string
          revision: number
          snapshot: Json
          tenant_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by: string
          id?: string
          revision: number
          snapshot: Json
          tenant_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string
          id?: string
          revision?: number
          snapshot?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'delivery_packages_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'delivery_packages_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'package_campaign_tenant'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      delivery_policies: {
        Row: {
          approved_by: string
          defaults: Json
          enabled: boolean
          level: string
          revision: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_by: string
          defaults: Json
          enabled?: boolean
          level?: string
          revision?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_by?: string
          defaults?: Json
          enabled?: boolean
          level?: string
          revision?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'delivery_policies_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'delivery_policies_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: true
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      delivery_policy_events: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          revision: number
          snapshot: Json
          tenant_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          revision: number
          snapshot: Json
          tenant_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          revision?: number
          snapshot?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'delivery_policy_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'delivery_policy_events_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      design_renders: {
        Row: {
          campaign_id: string
          copy_revision: number
          created_at: string
          created_by: string
          id: string
          input_revisions: Json
          revision: number
          source: string
          source_id: string | null
          strips: Json
          tenant_id: string
        }
        Insert: {
          campaign_id: string
          copy_revision: number
          created_at?: string
          created_by: string
          id?: string
          input_revisions: Json
          revision: number
          source: string
          source_id?: string | null
          strips: Json
          tenant_id: string
        }
        Update: {
          campaign_id?: string
          copy_revision?: number
          created_at?: string
          created_by?: string
          id?: string
          input_revisions?: Json
          revision?: number
          source?: string
          source_id?: string | null
          strips?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'design_renders_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'design_renders_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      designer_assignments: {
        Row: {
          assigned_by: string
          brief: Json
          campaign_id: string
          copy_revision: number
          created_at: string
          designer_id: string
          due_at: string
          id: string
          state: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_by: string
          brief: Json
          campaign_id: string
          copy_revision: number
          created_at?: string
          designer_id: string
          due_at: string
          id?: string
          state?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_by?: string
          brief?: Json
          campaign_id?: string
          copy_revision?: number
          created_at?: string
          designer_id?: string
          due_at?: string
          id?: string
          state?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'designer_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'designer_assignments_designer_id_fkey'
            columns: ['designer_id']
            isOneToOne: false
            referencedRelation: 'designers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'designer_assignments_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      designer_reviews: {
        Row: {
          actor_id: string
          assignment_id: string
          created_at: string
          decision: string
          feedback: string
          id: string
          section: string
          submission_id: string
          tenant_id: string
        }
        Insert: {
          actor_id: string
          assignment_id: string
          created_at?: string
          decision: string
          feedback: string
          id?: string
          section: string
          submission_id: string
          tenant_id: string
        }
        Update: {
          actor_id?: string
          assignment_id?: string
          created_at?: string
          decision?: string
          feedback?: string
          id?: string
          section?: string
          submission_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'designer_reviews_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'designer_reviews_submission_id_fkey'
            columns: ['submission_id']
            isOneToOne: false
            referencedRelation: 'designer_submissions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'designer_reviews_tenant_id_assignment_id_fkey'
            columns: ['tenant_id', 'assignment_id']
            isOneToOne: false
            referencedRelation: 'designer_assignments'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      designer_submissions: {
        Row: {
          assignment_id: string
          copy_revision: number
          created_at: string
          id: string
          notes: string
          revision: number
          storage_path: string
          submitted_by: string
          tenant_id: string
        }
        Insert: {
          assignment_id: string
          copy_revision: number
          created_at?: string
          id?: string
          notes: string
          revision: number
          storage_path: string
          submitted_by: string
          tenant_id: string
        }
        Update: {
          assignment_id?: string
          copy_revision?: number
          created_at?: string
          id?: string
          notes?: string
          revision?: number
          storage_path?: string
          submitted_by?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'designer_submissions_storage_path_fkey'
            columns: ['storage_path']
            isOneToOne: true
            referencedRelation: 'verified_design_uploads'
            referencedColumns: ['storage_path']
          },
          {
            foreignKeyName: 'designer_submissions_submitted_by_fkey'
            columns: ['submitted_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'designer_submissions_tenant_id_assignment_id_fkey'
            columns: ['tenant_id', 'assignment_id']
            isOneToOne: false
            referencedRelation: 'designer_assignments'
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
      email_file_imports: {
        Row: {
          attachment_count: number | null
          byte_size: number
          content_format: string | null
          created_at: string
          created_by: string
          failure_code: string | null
          file_kind: string
          file_name: string
          header_date: string | null
          header_from: string | null
          header_subject: string | null
          id: string
          job_id: string | null
          media_type: string
          notes: string[]
          reference_import_id: string | null
          retries: number
          sha256: string
          state: string
          storage_path: string
          tenant_id: string
          title: string
          updated_at: string
          upload_expires_at: string
        }
        Insert: {
          attachment_count?: number | null
          byte_size: number
          content_format?: string | null
          created_at?: string
          created_by: string
          failure_code?: string | null
          file_kind: string
          file_name: string
          header_date?: string | null
          header_from?: string | null
          header_subject?: string | null
          id?: string
          job_id?: string | null
          media_type: string
          notes?: string[]
          reference_import_id?: string | null
          retries?: number
          sha256: string
          state?: string
          storage_path: string
          tenant_id: string
          title?: string
          updated_at?: string
          upload_expires_at?: string
        }
        Update: {
          attachment_count?: number | null
          byte_size?: number
          content_format?: string | null
          created_at?: string
          created_by?: string
          failure_code?: string | null
          file_kind?: string
          file_name?: string
          header_date?: string | null
          header_from?: string | null
          header_subject?: string | null
          id?: string
          job_id?: string | null
          media_type?: string
          notes?: string[]
          reference_import_id?: string | null
          retries?: number
          sha256?: string
          state?: string
          storage_path?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          upload_expires_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_file_imports_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_file_imports_reference_fkey'
            columns: ['tenant_id', 'reference_import_id']
            isOneToOne: false
            referencedRelation: 'reference_imports'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'email_file_imports_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_file_imports_tenant_id_job_id_fkey'
            columns: ['tenant_id', 'job_id']
            isOneToOne: false
            referencedRelation: 'job_runs'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      email_generations: {
        Row: {
          brand_revision: number
          cost_micro: number
          created_at: string
          created_by: string
          diagnostic: string | null
          dispatches: number
          failure_code: string | null
          id: string
          input_tokens: number
          job_id: string
          model: string | null
          options: Json
          output_revision: number | null
          output_tokens: number
          prompt_version: string
          provider: string | null
          request_key: string
          response_id: string | null
          result_id: string
          source_sha256: string
          state: string
          target_revision: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          brand_revision: number
          cost_micro?: number
          created_at?: string
          created_by: string
          diagnostic?: string | null
          dispatches?: number
          failure_code?: string | null
          id?: string
          input_tokens?: number
          job_id: string
          model?: string | null
          options?: Json
          output_revision?: number | null
          output_tokens?: number
          prompt_version: string
          provider?: string | null
          request_key: string
          response_id?: string | null
          result_id: string
          source_sha256: string
          state?: string
          target_revision: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          brand_revision?: number
          cost_micro?: number
          created_at?: string
          created_by?: string
          diagnostic?: string | null
          dispatches?: number
          failure_code?: string | null
          id?: string
          input_tokens?: number
          job_id?: string
          model?: string | null
          options?: Json
          output_revision?: number | null
          output_tokens?: number
          prompt_version?: string
          provider?: string | null
          request_key?: string
          response_id?: string | null
          result_id?: string
          source_sha256?: string
          state?: string
          target_revision?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_generations_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_generations_tenant_id_job_id_fkey'
            columns: ['tenant_id', 'job_id']
            isOneToOne: false
            referencedRelation: 'job_runs'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'email_generations_tenant_id_result_id_fkey'
            columns: ['tenant_id', 'result_id']
            isOneToOne: false
            referencedRelation: 'email_results'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      email_result_revisions: {
        Row: {
          body_text: string
          campaign_copy_revision: number
          checks: Json
          created_at: string
          created_by: string
          cta_label: string
          cta_url: string
          generation_id: string | null
          html: string | null
          id: string
          origin: string
          preheader: string
          restored_from: number | null
          result_id: string
          revision: number
          subject: string
          subject_options: string[]
          tenant_id: string
        }
        Insert: {
          body_text?: string
          campaign_copy_revision: number
          checks?: Json
          created_at?: string
          created_by: string
          cta_label?: string
          cta_url?: string
          generation_id?: string | null
          html?: string | null
          id?: string
          origin: string
          preheader?: string
          restored_from?: number | null
          result_id: string
          revision: number
          subject: string
          subject_options?: string[]
          tenant_id: string
        }
        Update: {
          body_text?: string
          campaign_copy_revision?: number
          checks?: Json
          created_at?: string
          created_by?: string
          cta_label?: string
          cta_url?: string
          generation_id?: string | null
          html?: string | null
          id?: string
          origin?: string
          preheader?: string
          restored_from?: number | null
          result_id?: string
          revision?: number
          subject?: string
          subject_options?: string[]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_result_revisions_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_result_revisions_tenant_id_result_id_fkey'
            columns: ['tenant_id', 'result_id']
            isOneToOne: false
            referencedRelation: 'email_results'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'email_revision_generation'
            columns: ['tenant_id', 'generation_id']
            isOneToOne: false
            referencedRelation: 'email_generations'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      email_results: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string
          current_revision: number
          id: string
          mode: string
          source_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by: string
          current_revision?: number
          id?: string
          mode: string
          source_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string
          current_revision?: number
          id?: string
          mode?: string
          source_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_results_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_results_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'email_results_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_results_tenant_id_source_id_fkey'
            columns: ['tenant_id', 'source_id']
            isOneToOne: false
            referencedRelation: 'email_sources'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      email_sources: {
        Row: {
          created_at: string
          created_by: string
          format: string
          id: string
          original: string
          original_sha256: string
          reference_import_id: string
          subject: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          format: string
          id?: string
          original: string
          original_sha256: string
          reference_import_id: string
          subject: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          format?: string
          id?: string
          original?: string
          original_sha256?: string
          reference_import_id?: string
          subject?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_sources_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_sources_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_sources_tenant_id_reference_import_id_fkey'
            columns: ['tenant_id', 'reference_import_id']
            isOneToOne: true
            referencedRelation: 'reference_imports'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      fixture_deliveries: {
        Row: {
          created_at: string
          id: string
          idempotency_key: string
          package_id: string
          scheduled_at: string | null
          sent_at: string | null
          snapshot: Json
          state: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          idempotency_key: string
          package_id: string
          scheduled_at?: string | null
          sent_at?: string | null
          snapshot: Json
          state: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          idempotency_key?: string
          package_id?: string
          scheduled_at?: string | null
          sent_at?: string | null
          snapshot?: Json
          state?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fixture_deliveries_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fixture_deliveries_tenant_id_package_id_fkey'
            columns: ['tenant_id', 'package_id']
            isOneToOne: false
            referencedRelation: 'delivery_packages'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      fixture_delivery_history: {
        Row: {
          delivery_id: string
          id: string
          package_id: string
          recorded_at: string
          scheduled_at: string | null
          snapshot: Json
          state: string
          tenant_id: string
        }
        Insert: {
          delivery_id: string
          id?: string
          package_id: string
          recorded_at?: string
          scheduled_at?: string | null
          snapshot: Json
          state: string
          tenant_id: string
        }
        Update: {
          delivery_id?: string
          id?: string
          package_id?: string
          recorded_at?: string
          scheduled_at?: string | null
          snapshot?: Json
          state?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fixture_delivery_history_delivery_id_fkey'
            columns: ['delivery_id']
            isOneToOne: false
            referencedRelation: 'fixture_deliveries'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fixture_delivery_history_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fixture_delivery_history_tenant_id_package_id_fkey'
            columns: ['tenant_id', 'package_id']
            isOneToOne: false
            referencedRelation: 'delivery_packages'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      fixture_fault_controls: {
        Row: {
          campaign_id: string
          consumed: boolean
          revision: number
          scenario: string
          tenant_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          campaign_id: string
          consumed?: boolean
          revision?: number
          scenario: string
          tenant_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          campaign_id?: string
          consumed?: boolean
          revision?: number
          scenario?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fault_campaign_tenant'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: true
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'fixture_fault_controls_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fixture_fault_controls_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      fixture_metric_controls: {
        Row: {
          delivery_id: string
          scenario: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          delivery_id: string
          scenario: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          delivery_id?: string
          scenario?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fixture_metric_controls_delivery_id_fkey'
            columns: ['delivery_id']
            isOneToOne: true
            referencedRelation: 'fixture_deliveries'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'fixture_metric_controls_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      holidays: {
        Row: {
          created_at: string
          created_by: string
          event_date: string
          id: string
          name: string
          notes: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          event_date: string
          id?: string
          name: string
          notes?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          event_date?: string
          id?: string
          name?: string
          notes?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'holidays_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'holidays_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      job_runs: {
        Row: {
          attempt: number
          available_at: string
          campaign_id: string | null
          checkpoint: Json
          created_at: string
          created_by: string
          error_code: string | null
          failure_class: string | null
          id: string
          idempotency_key: string
          input: Json
          kind: string
          lease_token: string | null
          lease_until: string | null
          max_attempts: number
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          available_at?: string
          campaign_id?: string | null
          checkpoint?: Json
          created_at?: string
          created_by: string
          error_code?: string | null
          failure_class?: string | null
          id?: string
          idempotency_key: string
          input: Json
          kind: string
          lease_token?: string | null
          lease_until?: string | null
          max_attempts?: number
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          available_at?: string
          campaign_id?: string | null
          checkpoint?: Json
          created_at?: string
          created_by?: string
          error_code?: string | null
          failure_class?: string | null
          id?: string
          idempotency_key?: string
          input?: Json
          kind?: string
          lease_token?: string | null
          lease_until?: string | null
          max_attempts?: number
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'job_campaign_tenant'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'job_runs_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'job_runs_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      l2_silence_candidates: {
        Row: {
          brand_revision: number
          campaign_id: string
          content_id: string
          created_at: string
          created_by: string
          eligible_at: string
          id: string
          policy_revision: number
          simulated_at: string | null
          status: string
          streak_generation: number
          target_revisions: Json
          tenant_id: string
        }
        Insert: {
          brand_revision: number
          campaign_id: string
          content_id: string
          created_at?: string
          created_by: string
          eligible_at: string
          id?: string
          policy_revision: number
          simulated_at?: string | null
          status?: string
          streak_generation: number
          target_revisions: Json
          tenant_id: string
        }
        Update: {
          brand_revision?: number
          campaign_id?: string
          content_id?: string
          created_at?: string
          created_by?: string
          eligible_at?: string
          id?: string
          policy_revision?: number
          simulated_at?: string | null
          status?: string
          streak_generation?: number
          target_revisions?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'l2_silence_candidates_content_id_fkey'
            columns: ['content_id']
            isOneToOne: false
            referencedRelation: 'campaign_content'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'l2_silence_candidates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'l2_silence_candidates_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      l2_simulation_policies: {
        Row: {
          approved_by: string
          design_delegation: boolean
          enabled: boolean
          production_enabled: boolean
          required_sends: number
          revision: number
          silence_hours: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_by: string
          design_delegation?: boolean
          enabled?: boolean
          production_enabled?: boolean
          required_sends?: number
          revision?: number
          silence_hours?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_by?: string
          design_delegation?: boolean
          enabled?: boolean
          production_enabled?: boolean
          required_sends?: number
          revision?: number
          silence_hours?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'l2_simulation_policies_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'l2_simulation_policies_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: true
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      learned_rules: {
        Row: {
          comparison_key: Json
          created_at: string
          evidence: Json
          evidence_hash: string
          id: string
          kind: string
          preferred_group: string
          revision: number
          status: string
          summary: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          comparison_key: Json
          created_at?: string
          evidence: Json
          evidence_hash: string
          id?: string
          kind: string
          preferred_group: string
          revision?: number
          status?: string
          summary: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          comparison_key?: Json
          created_at?: string
          evidence?: Json
          evidence_hash?: string
          id?: string
          kind?: string
          preferred_group?: string
          revision?: number
          status?: string
          summary?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'learned_rules_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      learning_runs: {
        Row: {
          created_at: string
          detail: Json
          id: string
          job_id: string
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          detail: Json
          id?: string
          job_id: string
          status: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          id?: string
          job_id?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'learning_runs_job_id_fkey'
            columns: ['job_id']
            isOneToOne: true
            referencedRelation: 'job_runs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'learning_runs_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      notification_deliveries: {
        Row: {
          channel: string
          created_at: string
          id: string
          notification_id: string
          provider: string
          state: string
          tenant_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          id?: string
          notification_id: string
          provider: string
          state: string
          tenant_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          notification_id?: string
          provider?: string
          state?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notification_deliveries_notification_id_fkey'
            columns: ['notification_id']
            isOneToOne: true
            referencedRelation: 'notifications'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notification_deliveries_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      notifications: {
        Row: {
          created_at: string
          entity_id: string | null
          id: string
          kind: string
          message: string
          read_at: string | null
          recipient_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          id?: string
          kind: string
          message: string
          read_at?: string | null
          recipient_id: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          id?: string
          kind?: string
          message?: string
          read_at?: string | null
          recipient_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'notifications_recipient_id_fkey'
            columns: ['recipient_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'notifications_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
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
      optimizer_candidates: {
        Row: {
          eligible: boolean
          profile_id: string
          profile_revision: number
          reason: string
          state: string
          sweep_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          eligible: boolean
          profile_id: string
          profile_revision: number
          reason: string
          state?: string
          sweep_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          eligible?: boolean
          profile_id?: string
          profile_revision?: number
          reason?: string
          state?: string
          sweep_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'optimizer_candidates_sweep_id_fkey'
            columns: ['sweep_id']
            isOneToOne: false
            referencedRelation: 'optimizer_sweeps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'optimizer_candidates_tenant_id_profile_id_fkey'
            columns: ['tenant_id', 'profile_id']
            isOneToOne: false
            referencedRelation: 'optimizer_profiles'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      optimizer_events: {
        Row: {
          created_at: string
          detail: Json
          id: string
          kind: string
          profile_id: string
          sweep_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          detail: Json
          id?: string
          kind: string
          profile_id: string
          sweep_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          id?: string
          kind?: string
          profile_id?: string
          sweep_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'optimizer_events_sweep_id_fkey'
            columns: ['sweep_id']
            isOneToOne: false
            referencedRelation: 'optimizer_sweeps'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'optimizer_events_tenant_id_profile_id_fkey'
            columns: ['tenant_id', 'profile_id']
            isOneToOne: false
            referencedRelation: 'optimizer_profiles'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      optimizer_profiles: {
        Row: {
          consent: string
          created_at: string
          email: string
          external_id: string
          fixture_responds: boolean
          hard_bounce: boolean
          id: string
          last_engaged_at: string | null
          last_order_at: string | null
          revision: number
          spam: boolean
          suppression_reasons: string[]
          synthetic: boolean
          tenant_id: string
        }
        Insert: {
          consent: string
          created_at?: string
          email: string
          external_id: string
          fixture_responds?: boolean
          hard_bounce?: boolean
          id?: string
          last_engaged_at?: string | null
          last_order_at?: string | null
          revision?: number
          spam?: boolean
          suppression_reasons?: string[]
          synthetic?: boolean
          tenant_id: string
        }
        Update: {
          consent?: string
          created_at?: string
          email?: string
          external_id?: string
          fixture_responds?: boolean
          hard_bounce?: boolean
          id?: string
          last_engaged_at?: string | null
          last_order_at?: string | null
          revision?: number
          spam?: boolean
          suppression_reasons?: string[]
          synthetic?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'optimizer_profiles_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      optimizer_sweeps: {
        Row: {
          approved_by: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          observed_at: string
          pricing_snapshot: Json
          revision: number
          snapshot: Json
          state: string
          tenant_id: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          created_by: string
          expires_at?: string
          id?: string
          observed_at: string
          pricing_snapshot: Json
          revision?: number
          snapshot: Json
          state?: string
          tenant_id: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          observed_at?: string
          pricing_snapshot?: Json
          revision?: number
          snapshot?: Json
          state?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'optimizer_sweeps_approved_by_fkey'
            columns: ['approved_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'optimizer_sweeps_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'optimizer_sweeps_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      own_templates: {
        Row: {
          campaign_id: string
          created_at: string
          created_by: string
          delivery_id: string
          id: string
          name: string
          skeleton: Json
          tenant_id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          created_by: string
          delivery_id: string
          id?: string
          name: string
          skeleton: Json
          tenant_id: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          created_by?: string
          delivery_id?: string
          id?: string
          name?: string
          skeleton?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'own_templates_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'own_templates_delivery_id_fkey'
            columns: ['delivery_id']
            isOneToOne: true
            referencedRelation: 'fixture_deliveries'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'own_templates_tenant_id_campaign_id_fkey'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'own_templates_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      owner_rules: {
        Row: {
          active: boolean
          audience_id: string | null
          campaign_id: string | null
          created_at: string
          created_by: string
          forbidden_phrase: string
          id: string
          revision: number
          scope: string
          sequence_id: string | null
          tenant_id: string
        }
        Insert: {
          active?: boolean
          audience_id?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by: string
          forbidden_phrase: string
          id?: string
          revision?: number
          scope: string
          sequence_id?: string | null
          tenant_id: string
        }
        Update: {
          active?: boolean
          audience_id?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string
          forbidden_phrase?: string
          id?: string
          revision?: number
          scope?: string
          sequence_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'owner_rules_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'owner_rules_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'rule_audience_tenant'
            columns: ['tenant_id', 'audience_id']
            isOneToOne: false
            referencedRelation: 'audiences'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'rule_campaign_tenant'
            columns: ['tenant_id', 'campaign_id']
            isOneToOne: false
            referencedRelation: 'campaigns'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'rule_sequence_tenant'
            columns: ['tenant_id', 'sequence_id']
            isOneToOne: false
            referencedRelation: 'campaign_sequences'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      package_cycles: {
        Row: {
          allocation_micro: number
          created_at: string
          daily_micro: number
          ends_at: string
          id: string
          package_id: string
          reserved_micro: number
          snapshot: Json
          starts_at: string
          state: string
          tenant_id: string
          used_micro: number
        }
        Insert: {
          allocation_micro: number
          created_at?: string
          daily_micro: number
          ends_at: string
          id?: string
          package_id: string
          reserved_micro?: number
          snapshot: Json
          starts_at?: string
          state?: string
          tenant_id: string
          used_micro?: number
        }
        Update: {
          allocation_micro?: number
          created_at?: string
          daily_micro?: number
          ends_at?: string
          id?: string
          package_id?: string
          reserved_micro?: number
          snapshot?: Json
          starts_at?: string
          state?: string
          tenant_id?: string
          used_micro?: number
        }
        Relationships: [
          {
            foreignKeyName: 'package_cycles_package_id_fkey'
            columns: ['package_id']
            isOneToOne: false
            referencedRelation: 'packages'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'package_cycles_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      packages: {
        Row: {
          active: boolean
          allocation_micro: number
          created_at: string
          currency: string
          cycle_days: number
          daily_micro: number
          id: string
          name: string
          price_minor: number
          revision: number
          synthetic: boolean
        }
        Insert: {
          active?: boolean
          allocation_micro: number
          created_at?: string
          currency?: string
          cycle_days?: number
          daily_micro: number
          id?: string
          name: string
          price_minor?: number
          revision?: number
          synthetic?: boolean
        }
        Update: {
          active?: boolean
          allocation_micro?: number
          created_at?: string
          currency?: string
          cycle_days?: number
          daily_micro?: number
          id?: string
          name?: string
          price_minor?: number
          revision?: number
          synthetic?: boolean
        }
        Relationships: []
      }
      planning_preferences: {
        Row: {
          discount_cap: number
          generation: number
          revision: number
          sitewide_gap: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
          weekly_cap: number
        }
        Insert: {
          discount_cap?: number
          generation?: number
          revision?: number
          sitewide_gap?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          weekly_cap?: number
        }
        Update: {
          discount_cap?: number
          generation?: number
          revision?: number
          sitewide_gap?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          weekly_cap?: number
        }
        Relationships: [
          {
            foreignKeyName: 'planning_preferences_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: true
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'planning_preferences_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'profiles'
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
      playbooks: {
        Row: {
          brand_revision: number
          created_at: string
          created_by: string
          evidence_ids: string[]
          id: string
          patterns: Json
          revision: number
          source_count: number
          subscription_revisions: Json
          synthetic: boolean
          tenant_id: string
        }
        Insert: {
          brand_revision: number
          created_at?: string
          created_by: string
          evidence_ids: string[]
          id?: string
          patterns: Json
          revision: number
          source_count: number
          subscription_revisions: Json
          synthetic?: boolean
          tenant_id: string
        }
        Update: {
          brand_revision?: number
          created_at?: string
          created_by?: string
          evidence_ids?: string[]
          id?: string
          patterns?: Json
          revision?: number
          source_count?: number
          subscription_revisions?: Json
          synthetic?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'playbooks_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'playbooks_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      product_variants: {
        Row: {
          id: string
          observed_at: string
          product_id: string
          sku: string
          stock: number
          synthetic: boolean
          tenant_id: string
          title: string
        }
        Insert: {
          id?: string
          observed_at?: string
          product_id: string
          sku: string
          stock: number
          synthetic?: boolean
          tenant_id: string
          title: string
        }
        Update: {
          id?: string
          observed_at?: string
          product_id?: string
          sku?: string
          stock?: number
          synthetic?: boolean
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: 'product_variants_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'product_variants_tenant_id_product_id_fkey'
            columns: ['tenant_id', 'product_id']
            isOneToOne: false
            referencedRelation: 'products'
            referencedColumns: ['tenant_id', 'id']
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
      reference_imports: {
        Row: {
          content_format: string | null
          created_at: string
          created_by: string
          file_import_id: string | null
          id: string
          origin: string
          original_body: string
          readable_text: string
          source_description: string
          source_kind: string
          source_url: string | null
          structure: Json
          subject: string
          tenant_id: string
        }
        Insert: {
          content_format?: string | null
          created_at?: string
          created_by: string
          file_import_id?: string | null
          id?: string
          origin?: string
          original_body: string
          readable_text: string
          source_description?: string
          source_kind?: string
          source_url?: string | null
          structure: Json
          subject: string
          tenant_id: string
        }
        Update: {
          content_format?: string | null
          created_at?: string
          created_by?: string
          file_import_id?: string | null
          id?: string
          origin?: string
          original_body?: string
          readable_text?: string
          source_description?: string
          source_kind?: string
          source_url?: string | null
          structure?: Json
          subject?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'reference_imports_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reference_imports_file_import_fkey'
            columns: ['tenant_id', 'file_import_id']
            isOneToOne: false
            referencedRelation: 'email_file_imports'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'reference_imports_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      render_reviews: {
        Row: {
          actor_id: string
          created_at: string
          decision: string
          feedback: string
          id: string
          render_id: string
          section: string
          tenant_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          decision: string
          feedback: string
          id?: string
          render_id: string
          section: string
          tenant_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          decision?: string
          feedback?: string
          id?: string
          render_id?: string
          section?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'render_reviews_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'render_reviews_render_id_fkey'
            columns: ['render_id']
            isOneToOne: false
            referencedRelation: 'design_renders'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'render_reviews_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      result_digests: {
        Row: {
          created_at: string
          id: string
          local_date: string
          observed_at: string
          snapshot: Json
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          local_date: string
          observed_at: string
          snapshot: Json
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          local_date?: string
          observed_at?: string
          snapshot?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'result_digests_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      segment_registry: {
        Row: {
          account_id: string
          canonical_key: string
          created_at: string
          definition: string
          provider_id: string
          synthetic: boolean
          tenant_id: string
        }
        Insert: {
          account_id: string
          canonical_key: string
          created_at?: string
          definition: string
          provider_id: string
          synthetic?: boolean
          tenant_id: string
        }
        Update: {
          account_id?: string
          canonical_key?: string
          created_at?: string
          definition?: string
          provider_id?: string
          synthetic?: boolean
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'segment_registry_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      support_messages: {
        Row: {
          actor_id: string
          body: string
          created_at: string
          id: string
          tenant_id: string
          ticket_id: string
        }
        Insert: {
          actor_id: string
          body: string
          created_at?: string
          id?: string
          tenant_id: string
          ticket_id: string
        }
        Update: {
          actor_id?: string
          body?: string
          created_at?: string
          id?: string
          tenant_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'support_messages_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_messages_tenant_id_ticket_id_fkey'
            columns: ['tenant_id', 'ticket_id']
            isOneToOne: false
            referencedRelation: 'support_tickets'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      support_tickets: {
        Row: {
          category: string | null
          created_at: string
          creator_id: string
          id: string
          kind: string
          revision: number
          state: string
          subject: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          creator_id: string
          id?: string
          kind: string
          revision?: number
          state?: string
          subject: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          creator_id?: string
          id?: string
          kind?: string
          revision?: number
          state?: string
          subject?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'support_tickets_creator_id_fkey'
            columns: ['creator_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'support_tickets_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
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
      usage_reservations: {
        Row: {
          actual_micro: number | null
          created_at: string
          cycle_id: string
          estimate_micro: number
          expires_at: string
          feature: string
          id: string
          local_date: string
          operation_id: string
          state: string
          tenant_id: string
        }
        Insert: {
          actual_micro?: number | null
          created_at?: string
          cycle_id: string
          estimate_micro: number
          expires_at?: string
          feature: string
          id?: string
          local_date: string
          operation_id: string
          state?: string
          tenant_id: string
        }
        Update: {
          actual_micro?: number | null
          created_at?: string
          cycle_id?: string
          estimate_micro?: number
          expires_at?: string
          feature?: string
          id?: string
          local_date?: string
          operation_id?: string
          state?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'usage_reservations_tenant_id_cycle_id_fkey'
            columns: ['tenant_id', 'cycle_id']
            isOneToOne: false
            referencedRelation: 'package_cycles'
            referencedColumns: ['tenant_id', 'id']
          }
        ]
      }
      verified_design_uploads: {
        Row: {
          assignment_id: string
          byte_size: number
          created_at: string
          media_type: string
          sha256: string
          storage_path: string
          tenant_id: string
          uploaded_by: string
        }
        Insert: {
          assignment_id: string
          byte_size: number
          created_at?: string
          media_type: string
          sha256: string
          storage_path: string
          tenant_id: string
          uploaded_by: string
        }
        Update: {
          assignment_id?: string
          byte_size?: number
          created_at?: string
          media_type?: string
          sha256?: string
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: 'verified_design_uploads_tenant_id_assignment_id_fkey'
            columns: ['tenant_id', 'assignment_id']
            isOneToOne: false
            referencedRelation: 'designer_assignments'
            referencedColumns: ['tenant_id', 'id']
          },
          {
            foreignKeyName: 'verified_design_uploads_uploaded_by_fkey'
            columns: ['uploaded_by']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          }
        ]
      }
      verified_render_uploads: {
        Row: {
          byte_size: number
          created_at: string
          job_id: string
          section: string
          sha256: string
          storage_path: string
          tenant_id: string
        }
        Insert: {
          byte_size: number
          created_at?: string
          job_id: string
          section: string
          sha256: string
          storage_path: string
          tenant_id: string
        }
        Update: {
          byte_size?: number
          created_at?: string
          job_id?: string
          section?: string
          sha256?: string
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'verified_render_uploads_job_id_fkey'
            columns: ['job_id']
            isOneToOne: false
            referencedRelation: 'job_runs'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'verified_render_uploads_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      workspace_connections: {
        Row: {
          account_label: string | null
          connected_at: string | null
          credential_hint: string | null
          fixture_account: string
          folder_id: string | null
          last_error: string | null
          last_sync_at: string | null
          mode: string
          provider: string
          read_only: boolean
          revision: number
          shop_domain: string | null
          status: string
          template_count: number | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          account_label?: string | null
          connected_at?: string | null
          credential_hint?: string | null
          fixture_account: string
          folder_id?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          mode?: string
          provider: string
          read_only?: boolean
          revision?: number
          shop_domain?: string | null
          status: string
          template_count?: number | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          account_label?: string | null
          connected_at?: string | null
          credential_hint?: string | null
          fixture_account?: string
          folder_id?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          mode?: string
          provider?: string
          read_only?: boolean
          revision?: number
          shop_domain?: string | null
          status?: string
          template_count?: number | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workspace_connections_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
      workspace_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: Json
          entity_id: string | null
          id: string
          kind: string
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          id?: string
          kind: string
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: Json
          entity_id?: string | null
          id?: string
          kind?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: 'workspace_events_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'workspace_events_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_team_invite: { Args: { invite: string }; Returns: string }
      add_campaign_note: {
        Args: { body: string; t: string; target_id: string }
        Returns: undefined
      }
      add_holiday: {
        Args: { event_date: string; name: string; notes: string; t: string }
        Returns: string
      }
      admit_email_file_upload: {
        Args: { input: Json; request_key: string; t: string }
        Returns: {
          import_id: string
          needs_upload: boolean
          state: string
          storage_path: string
        }[]
      }
      advance_optimizer_clock: {
        Args: { observed_at: string; sweep: string; t: string }
        Returns: number
      }
      advance_results_clock: {
        Args: { observed_at: string; t: string }
        Returns: number
      }
      apply_brand_suggestion: {
        Args: {
          expected_revision: number
          section: string
          suggestion: Json
          t: string
        }
        Returns: number
      }
      approve_brand: {
        Args: { expected_revision: number; t: string }
        Returns: undefined
      }
      approve_brand_kit: {
        Args: { expected_revision: number; t: string }
        Returns: undefined
      }
      approve_calendar: {
        Args: { expected_revision: number; t: string; target_id: string }
        Returns: undefined
      }
      approve_copy: {
        Args: { campaign: string; expected_revision: number; t: string }
        Returns: undefined
      }
      approve_copy_batch: {
        Args: { batch: string; t: string }
        Returns: number
      }
      approve_optimizer: {
        Args: { expected_revision: number; sweep: string; t: string }
        Returns: undefined
      }
      approve_plan: { Args: { plan: string; t: string }; Returns: undefined }
      ask_fixture_gros: {
        Args: {
          campaign: string
          chat: string
          intent?: string
          question: string
          t: string
          value?: string
        }
        Returns: string
      }
      assign_campaign: {
        Args: {
          campaign: string
          designer: string
          expected_copy: number
          t: string
        }
        Returns: string
      }
      assign_fixture_package: {
        Args: { package: string; t: string }
        Returns: string
      }
      assignable_designers: {
        Args: { t: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      assignment_brief: { Args: { assignment: string }; Returns: Json }
      begin_asset_import: {
        Args: { key: string; source: string; t: string }
        Returns: string
      }
      begin_email_dispatch: {
        Args: {
          estimate: number
          job: string
          lease: string
          model: string
          prompt_version: string
          provider: string
        }
        Returns: string
      }
      change_fixture_profile_evidence: {
        Args: {
          bounce: boolean
          consent: string
          expected_revision: number
          profile: string
          recent_order: boolean
          spam: boolean
          t: string
        }
        Returns: undefined
      }
      claim_email_file_import: {
        Args: { import: string; t: string }
        Returns: {
          actor: string
          attempt: number
          byte_size: number
          file_kind: string
          file_name: string
          job_id: string
          lease_token: string
          sha256: string
          storage_path: string
          title: string
        }[]
      }
      claim_email_generation: {
        Args: { generation: string; t: string }
        Returns: {
          actor: string
          attempt: number
          brand_revision: number
          generation_id: string
          job_id: string
          lease_token: string
          options: Json
          result_id: string
          source_id: string
        }[]
      }
      claim_job: {
        Args: { t: string }
        Returns: {
          attempt: number
          available_at: string
          campaign_id: string | null
          checkpoint: Json
          created_at: string
          created_by: string
          error_code: string | null
          failure_class: string | null
          id: string
          idempotency_key: string
          input: Json
          kind: string
          lease_token: string | null
          lease_until: string | null
          max_attempts: number
          status: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: '*'
          to: 'job_runs'
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_asset_import: {
        Args: { import_id: string; t: string }
        Returns: undefined
      }
      confirm_fixture_sent: {
        Args: { delivery: string; observed_at: string; t: string }
        Returns: undefined
      }
      connect_sample_provider: {
        Args: {
          account_label: string
          credential_hint: string
          provider: string
          shop_domain?: string
          t: string
          template_count?: number
        }
        Returns: number
      }
      correct_asset: {
        Args: {
          asset: string
          category: string
          expected_revision: number
          product?: string
          t: string
          variant?: string
        }
        Returns: undefined
      }
      create_conversation: {
        Args: { t: string; title: string; visibility?: string }
        Returns: string
      }
      create_delivery_package: {
        Args: {
          campaign: string
          expected_revision: number
          settings: Json
          t: string
        }
        Returns: string
      }
      create_email_result: {
        Args: {
          import_id: string
          mode: string
          options?: Json
          request_key: string
          t: string
        }
        Returns: string
      }
      create_first_draft: {
        Args: {
          input: Json
          request_key: string
          source: string
          source_id?: string
          t: string
        }
        Returns: string
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
      decide_chat_proposal: {
        Args: {
          decision: string
          expected_hash: string
          proposal: string
          t: string
        }
        Returns: undefined
      }
      define_fixture_package: {
        Args: { allocation: number; daily: number; name: string }
        Returns: string
      }
      design_escalation_operations: {
        Args: never
        Returns: {
          assignment_id: string
          campaign_id: string
          can_escalate: boolean
          design_revision: number
          due_at: string
          escalation_id: string
          issue_state: string
          reason: string
          sla_overdue: boolean
          tenant_id: string
          title: string
        }[]
      }
      design_operations: {
        Args: never
        Returns: {
          assignment_id: string
          campaign_id: string
          copy_revision: number
          design_state: string
          designer_id: string
          due_at: string
          tenant_id: string
          title: string
        }[]
      }
      draft_from_structure: {
        Args: { input: Json; source: string; source_id: string; t: string }
        Returns: string
      }
      enqueue_cancel: {
        Args: { campaign: string; expected_revision: number; t: string }
        Returns: string
      }
      enqueue_copy: {
        Args: { campaign: string; expected_revision: number; t: string }
        Returns: string
      }
      enqueue_daily_result_digest: { Args: { t: string }; Returns: undefined }
      enqueue_delivery: {
        Args: { expected_revision: number; package: string; t: string }
        Returns: string
      }
      enqueue_health_check: { Args: { t: string }; Returns: undefined }
      enqueue_l1_delivery: {
        Args: {
          expected_revision: number
          package: string
          policy_revision: number
          t: string
        }
        Returns: string
      }
      enqueue_learning: { Args: { t: string }; Returns: string }
      enqueue_onboarding_job: {
        Args: { input?: Json; kind: string; t: string }
        Returns: string
      }
      enqueue_plan: {
        Args: { audience: string; starts_at: string; t: string }
        Returns: string
      }
      enqueue_reference_job: {
        Args: { kind: string; subscription?: string; t: string }
        Returns: string
      }
      enqueue_render: {
        Args: {
          campaign: string
          expected_copy: number
          expected_design: number
          source?: string
          source_id?: string
          t: string
        }
        Returns: string
      }
      enqueue_review_reminders: { Args: { t: string }; Returns: string }
      escalate_design: {
        Args: {
          campaign: string
          category: string
          expected_design: number
          reason: string
          t: string
        }
        Returns: string
      }
      fail_email_file_import: {
        Args: { failure: Json; job: string; lease: string }
        Returns: string
      }
      fail_email_generation: {
        Args: { failure: Json; job: string; lease: string }
        Returns: string
      }
      fail_job: {
        Args: { failure: string; job: string; lease: string }
        Returns: undefined
      }
      finalize_email_file_upload: {
        Args: { import: string; t: string }
        Returns: string
      }
      finish_capture_job: {
        Args: { job: string; lease: string; output: Json }
        Returns: undefined
      }
      finish_copy_job: {
        Args: { job: string; lease: string; output: Json }
        Returns: undefined
      }
      finish_delivery_job: {
        Args: { job: string; lease: string }
        Returns: undefined
      }
      finish_email_file_import: {
        Args: { job: string; lease: string; output: Json }
        Returns: string
      }
      finish_email_generation: {
        Args: { job: string; lease: string; output: Json; usage: Json }
        Returns: number
      }
      finish_health_check: {
        Args: { job: string; lease: string }
        Returns: undefined
      }
      finish_learning_job: {
        Args: { job: string; lease: string }
        Returns: undefined
      }
      finish_onboarding_job: {
        Args: { job: string; lease: string; output: Json }
        Returns: undefined
      }
      finish_optimizer_job: {
        Args: { job: string; lease: string; output: Json }
        Returns: undefined
      }
      finish_plan_job: {
        Args: { job: string; lease: string; output: Json }
        Returns: string
      }
      finish_playbook_job: {
        Args: { job: string; lease: string; output: Json }
        Returns: undefined
      }
      finish_reminder_job: {
        Args: { job: string; lease: string }
        Returns: undefined
      }
      finish_render_job: {
        Args: { job: string; lease: string; output: Json }
        Returns: string
      }
      finish_result_digest: {
        Args: { job: string; lease: string }
        Returns: undefined
      }
      finish_result_job: {
        Args: { job: string; lease: string; output: Json }
        Returns: string
      }
      fixture_copy_preference: {
        Args: { campaign: string; t: string }
        Returns: Json
      }
      fixture_delivery_command: {
        Args: { command: string; job: string; lease: string }
        Returns: Json
      }
      fixture_fault_probe: {
        Args: { job: string; lease: string; stage: string }
        Returns: string
      }
      fixture_optimizer_payload: {
        Args: { job: string; lease: string }
        Returns: Json
      }
      fixture_result_payload: {
        Args: {
          delivery: string
          job: string
          lease: string
          window_key: string
        }
        Returns: Json
      }
      fixture_usage_summary: {
        Args: { t: string }
        Returns: {
          day_micro: number
          feature: string
          held_micro: number
          used_micro: number
        }[]
      }
      import_pasted_reference: {
        Args: { input: Json; request_key: string; t: string }
        Returns: string
      }
      install_optimizer_fixture: { Args: { t: string }; Returns: undefined }
      invite_team: {
        Args: {
          email: string
          role: Database['public']['Enums']['tenant_role']
          t: string
        }
        Returns: string
      }
      my_pending_invites: {
        Args: never
        Returns: {
          id: string
          role: Database['public']['Enums']['tenant_role']
          tenant_name: string
        }[]
      }
      open_support_ticket: {
        Args: { body: string; kind: string; subject: string; t: string }
        Returns: string
      }
      operator_diagnostics: { Args: never; Returns: Json }
      prepare_copy_review: {
        Args: { t: string; week: string }
        Returns: string
      }
      prepare_l2_silence: {
        Args: { campaign: string; expected_copy: number; t: string }
        Returns: string
      }
      preview_optimizer: {
        Args: { observed_at: string; t: string }
        Returns: string
      }
      queue_ready_l1: { Args: { t: string }; Returns: number }
      queue_weekly_copy: { Args: { t: string; week: string }; Returns: number }
      reconcile_fixture_usage: {
        Args: { actual: number; reservation: string; t: string }
        Returns: undefined
      }
      record_asset_upload: {
        Args: {
          actor: string
          byte_size: number
          filename: string
          hash: string
          media_type: string
          path: string
          source: string
          t: string
        }
        Returns: string
      }
      record_design_upload: {
        Args: {
          actor: string
          assignment: string
          byte_size: number
          hash: string
          media_type: string
          path: string
        }
        Returns: undefined
      }
      record_import_item: {
        Args: {
          asset?: string
          error_code?: string
          filename: string
          import_id: string
          status: string
          t: string
        }
        Returns: undefined
      }
      record_render_upload: {
        Args: {
          byte_size: number
          hash: string
          job: string
          lease: string
          path: string
          section: string
        }
        Returns: undefined
      }
      recover_expired_usage: { Args: { t: string }; Returns: number }
      refresh_catalog_stock: {
        Args: { product: string; stock: number; t: string }
        Returns: undefined
      }
      reject_campaign_version: {
        Args: {
          campaign: string
          expected_revision: number
          forbidden_phrase?: string
          kind: string
          reason: string
          scope: string
          t: string
        }
        Returns: undefined
      }
      reply_support: {
        Args: {
          body: string
          expected_revision: number
          state: string
          t: string
          ticket: string
        }
        Returns: undefined
      }
      request_email_rewrite: {
        Args: {
          expected_revision: number
          options?: Json
          request_key: string
          result: string
          t: string
        }
        Returns: string
      }
      request_feature: {
        Args: { category: string; details: string; subject: string; t: string }
        Returns: string
      }
      request_reschedule: {
        Args: {
          campaign: string
          expected_revision: number
          scheduled_at: string
          t: string
        }
        Returns: string
      }
      reserve_fixture_usage: {
        Args: {
          estimate: number
          feature: string
          operation: string
          t: string
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
      resolve_design_escalation: {
        Args: { escalation: string; resolution: string; t: string }
        Returns: undefined
      }
      resolve_designer_context: {
        Args: never
        Returns: {
          designer_id: string
        }[]
      }
      resolve_fixture_outcome: {
        Args: { job: string; t: string }
        Returns: undefined
      }
      restore_email_revision: {
        Args: {
          expected_revision: number
          from_revision: number
          result: string
          t: string
        }
        Returns: number
      }
      retry_email_file_import: {
        Args: { import: string; t: string }
        Returns: string
      }
      retry_fixture_job: {
        Args: { job: string; t: string }
        Returns: undefined
      }
      reverse_fixture_suppression: {
        Args: { expected_revision: number; profile: string; t: string }
        Returns: undefined
      }
      review_design: {
        Args: {
          decision: string
          expected_revision: number
          feedback: string
          section: string
          submission: string
          t: string
        }
        Returns: undefined
      }
      review_learned_rule: {
        Args: {
          decision: string
          expected_revision: number
          rule: string
          t: string
        }
        Returns: undefined
      }
      review_render: {
        Args: {
          decision: string
          expected_revision: number
          feedback: string
          render: string
          section: string
          t: string
        }
        Returns: undefined
      }
      revoke_team_invite: {
        Args: { invite: string; t: string }
        Returns: undefined
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
      save_brand_section: {
        Args: {
          content: Json
          expected_brand_revision?: number
          expected_revision: number
          facts?: Json
          locked?: string[]
          section: string
          t: string
        }
        Returns: Json
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
      save_copy: {
        Args: {
          campaign: string
          expected_revision: number
          input: Json
          t: string
        }
        Returns: undefined
      }
      save_delivery_policy: {
        Args: {
          defaults: Json
          enabled: boolean
          expected_revision: number
          level: string
          t: string
        }
        Returns: undefined
      }
      save_email_revision: {
        Args: {
          expected_revision: number
          input: Json
          result: string
          t: string
        }
        Returns: number
      }
      save_l2_simulation_policy: {
        Args: {
          enabled: boolean
          expected_revision: number
          required_sends?: number
          t: string
        }
        Returns: undefined
      }
      save_own_template: {
        Args: { delivery: string; t: string }
        Returns: string
      }
      set_conversation_visibility: {
        Args: { chat: string; t: string; visibility: string }
        Returns: undefined
      }
      set_fixture_connection: {
        Args: { folder?: string; provider: string; status: string; t: string }
        Returns: undefined
      }
      set_fixture_fault: {
        Args: { campaign: string; scenario: string; t: string }
        Returns: undefined
      }
      set_fixture_metrics: {
        Args: { delivery: string; scenario: string; t: string }
        Returns: undefined
      }
      set_planning_preferences: {
        Args: {
          discounted: number
          expected_revision: number
          gap: number
          t: string
          weekly: number
        }
        Returns: undefined
      }
      simulate_l2_schedule: {
        Args: {
          candidate: string
          expected_delivery: number
          package: string
          t: string
        }
        Returns: string
      }
      simulate_l2_silence: {
        Args: { candidate: string; observed_at: string; t: string }
        Returns: undefined
      }
      submit_design: {
        Args: {
          assignment: string
          expected_revision: number
          notes: string
          path: string
        }
        Returns: string
      }
      subscribe_competitor: {
        Args: {
          domain: string
          label: string
          private_rules?: string
          t: string
        }
        Returns: string
      }
      update_competitor_subscription: {
        Args: {
          active: boolean
          expected_revision: number
          private_rules: string
          subscription: string
          t: string
        }
        Returns: undefined
      }
      update_team_access: {
        Args: {
          expected_at: string
          membership: string
          role: Database['public']['Enums']['tenant_role']
          status: Database['public']['Enums']['membership_status']
          t: string
        }
        Returns: undefined
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
