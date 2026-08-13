export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          actor: string
          after_data: Json | null
          before_data: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: number
        }
        Insert: {
          action: string
          actor: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: never
        }
        Update: {
          action?: string
          actor?: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: never
        }
        Relationships: []
      }
      canonical_products: {
        Row: {
          base_name: string
          brand: string | null
          category: string | null
          created_at: string
          gtin: string | null
          id: string
          name: string
          normalized_brand: string | null
          normalized_category: string | null
          normalized_name: string
          package_count: number | null
          package_size: number | null
          package_unit: string | null
          total_amount: number | null
          updated_at: string
          variant: string | null
        }
        Insert: {
          base_name: string
          brand?: string | null
          category?: string | null
          created_at?: string
          gtin?: string | null
          id?: string
          name: string
          normalized_brand?: string | null
          normalized_category?: string | null
          normalized_name: string
          package_count?: number | null
          package_size?: number | null
          package_unit?: string | null
          total_amount?: number | null
          updated_at?: string
          variant?: string | null
        }
        Update: {
          base_name?: string
          brand?: string | null
          category?: string | null
          created_at?: string
          gtin?: string | null
          id?: string
          name?: string
          normalized_brand?: string | null
          normalized_category?: string | null
          normalized_name?: string
          package_count?: number | null
          package_size?: number | null
          package_unit?: string | null
          total_amount?: number | null
          updated_at?: string
          variant?: string | null
        }
        Relationships: []
      }
      group_members: {
        Row: {
          added_by: string | null
          created_at: string
          group_id: string
          profile_id: string
          role: Database["public"]["Enums"]["group_member_role"]
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          group_id: string
          profile_id: string
          role?: Database["public"]["Enums"]["group_member_role"]
        }
        Update: {
          added_by?: string | null
          created_at?: string
          group_id?: string
          profile_id?: string
          role?: Database["public"]["Enums"]["group_member_role"]
        }
        Relationships: [
          {
            foreignKeyName: "group_members_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_runtime_config: {
        Row: {
          catalog_sync_interval_minutes: number
          max_jobs_per_tick: number
          price_refresh_interval_minutes: number
          refresh_request_max_attempts: number
          refresh_request_retry_delay_minutes: number
          running_timeout_minutes: number
          singleton: boolean
          updated_at: string
        }
        Insert: {
          catalog_sync_interval_minutes?: number
          max_jobs_per_tick?: number
          price_refresh_interval_minutes?: number
          refresh_request_max_attempts?: number
          refresh_request_retry_delay_minutes?: number
          running_timeout_minutes?: number
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          catalog_sync_interval_minutes?: number
          max_jobs_per_tick?: number
          price_refresh_interval_minutes?: number
          refresh_request_max_attempts?: number
          refresh_request_retry_delay_minutes?: number
          running_timeout_minutes?: number
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      price_history: {
        Row: {
          created_at: string
          id: number
          normal_price: number
          observed_at: string
          price_per_unit: number | null
          product_offer_id: string
          promo_price: number | null
          reference_unit: string | null
        }
        Insert: {
          created_at?: string
          id?: never
          normal_price: number
          observed_at: string
          price_per_unit?: number | null
          product_offer_id: string
          promo_price?: number | null
          reference_unit?: string | null
        }
        Update: {
          created_at?: string
          id?: never
          normal_price?: number
          observed_at?: string
          price_per_unit?: number | null
          product_offer_id?: string
          promo_price?: number | null
          reference_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_history_product_offer_id_fkey"
            columns: ["product_offer_id"]
            isOneToOne: false
            referencedRelation: "product_offers"
            referencedColumns: ["id"]
          },
        ]
      }
      product_matches: {
        Row: {
          canonical_product_id: string
          confidence: string
          created_at: string
          id: string
          match_type: string
          matched_by: string | null
          method: string
          reasons: Json
          retailer_product_id: string
          reviewed: boolean
          reviewed_at: string | null
          score: number
          status: string
          updated_at: string
        }
        Insert: {
          canonical_product_id: string
          confidence?: string
          created_at?: string
          id?: string
          match_type?: string
          matched_by?: string | null
          method?: string
          reasons?: Json
          retailer_product_id: string
          reviewed?: boolean
          reviewed_at?: string | null
          score?: number
          status?: string
          updated_at?: string
        }
        Update: {
          canonical_product_id?: string
          confidence?: string
          created_at?: string
          id?: string
          match_type?: string
          matched_by?: string | null
          method?: string
          reasons?: Json
          retailer_product_id?: string
          reviewed?: boolean
          reviewed_at?: string | null
          score?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_matches_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "canonical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_matches_matched_by_fkey"
            columns: ["matched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_matches_retailer_product_id_fkey"
            columns: ["retailer_product_id"]
            isOneToOne: false
            referencedRelation: "retailer_products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_offers: {
        Row: {
          available: boolean
          created_at: string
          id: string
          market_id: string
          normal_price: number
          observed_at: string
          price_per_unit: number | null
          promo_price: number | null
          promotion_text: string | null
          promotion_type: string | null
          reference_unit: string | null
          requires_membership: boolean
          retailer_id: string
          retailer_product_id: string
          updated_at: string
        }
        Insert: {
          available?: boolean
          created_at?: string
          id?: string
          market_id: string
          normal_price: number
          observed_at: string
          price_per_unit?: number | null
          promo_price?: number | null
          promotion_text?: string | null
          promotion_type?: string | null
          reference_unit?: string | null
          requires_membership?: boolean
          retailer_id: string
          retailer_product_id: string
          updated_at?: string
        }
        Update: {
          available?: boolean
          created_at?: string
          id?: string
          market_id?: string
          normal_price?: number
          observed_at?: string
          price_per_unit?: number | null
          promo_price?: number | null
          promotion_text?: string | null
          promotion_type?: string | null
          reference_unit?: string | null
          requires_membership?: boolean
          retailer_id?: string
          retailer_product_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_offers_market_fk"
            columns: ["market_id", "retailer_id"]
            isOneToOne: false
            referencedRelation: "retailer_markets"
            referencedColumns: ["id", "retailer_id"]
          },
          {
            foreignKeyName: "product_offers_product_fk"
            columns: ["retailer_product_id", "retailer_id"]
            isOneToOne: false
            referencedRelation: "retailer_products"
            referencedColumns: ["id", "retailer_id"]
          },
          {
            foreignKeyName: "product_offers_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_health: {
        Row: {
          checked_at: string
          created_at: string
          id: string
          latency_ms: number | null
          market_id: string | null
          message: string | null
          metadata: Json
          retailer_id: string
          status: Database["public"]["Enums"]["provider_health_status"]
          updated_at: string
        }
        Insert: {
          checked_at: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          market_id?: string | null
          message?: string | null
          metadata?: Json
          retailer_id: string
          status: Database["public"]["Enums"]["provider_health_status"]
          updated_at?: string
        }
        Update: {
          checked_at?: string
          created_at?: string
          id?: string
          latency_ms?: number | null
          market_id?: string | null
          message?: string | null
          metadata?: Json
          retailer_id?: string
          status?: Database["public"]["Enums"]["provider_health_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_health_market_fk"
            columns: ["market_id", "retailer_id"]
            isOneToOne: false
            referencedRelation: "retailer_markets"
            referencedColumns: ["id", "retailer_id"]
          },
          {
            foreignKeyName: "provider_health_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_job_schedules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          last_dispatched_at: string | null
          next_run_at: string
          postal_code: string
          request_type: Database["public"]["Enums"]["refresh_request_type"]
          retailer_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_dispatched_at?: string | null
          next_run_at?: string
          postal_code: string
          request_type: Database["public"]["Enums"]["refresh_request_type"]
          retailer_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          last_dispatched_at?: string | null
          next_run_at?: string
          postal_code?: string
          request_type?: Database["public"]["Enums"]["refresh_request_type"]
          retailer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_job_schedules_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_sync_runs: {
        Row: {
          catalog_miss_evidence_recorded_at: string | null
          created_at: string
          error_message: string | null
          finished_at: string | null
          id: string
          market_id: string | null
          metadata: Json
          offers_seen: number
          products_seen: number
          retailer_id: string
          started_at: string
          status: Database["public"]["Enums"]["provider_sync_status"]
          sync_type: string
          updated_at: string
        }
        Insert: {
          catalog_miss_evidence_recorded_at?: string | null
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          market_id?: string | null
          metadata?: Json
          offers_seen?: number
          products_seen?: number
          retailer_id: string
          started_at?: string
          status?: Database["public"]["Enums"]["provider_sync_status"]
          sync_type: string
          updated_at?: string
        }
        Update: {
          catalog_miss_evidence_recorded_at?: string | null
          created_at?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          market_id?: string | null
          metadata?: Json
          offers_seen?: number
          products_seen?: number
          retailer_id?: string
          started_at?: string
          status?: Database["public"]["Enums"]["provider_sync_status"]
          sync_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_sync_runs_market_fk"
            columns: ["market_id", "retailer_id"]
            isOneToOne: false
            referencedRelation: "retailer_markets"
            referencedColumns: ["id", "retailer_id"]
          },
          {
            foreignKeyName: "provider_sync_runs_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      refresh_requests: {
        Row: {
          attempt_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json
          next_attempt_at: string
          postal_code: string
          product_ids: string[]
          request_type: Database["public"]["Enums"]["refresh_request_type"]
          requested_at: string
          requested_by: string
          retailer_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["refresh_request_status"]
          worker_id: string | null
        }
        Insert: {
          attempt_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          next_attempt_at?: string
          postal_code: string
          product_ids?: string[]
          request_type: Database["public"]["Enums"]["refresh_request_type"]
          requested_at?: string
          requested_by: string
          retailer_id: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["refresh_request_status"]
          worker_id?: string | null
        }
        Update: {
          attempt_count?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          next_attempt_at?: string
          postal_code?: string
          product_ids?: string[]
          request_type?: Database["public"]["Enums"]["refresh_request_type"]
          requested_at?: string
          requested_by?: string
          retailer_id?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["refresh_request_status"]
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refresh_requests_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      retailer_market_postal_codes: {
        Row: {
          created_at: string
          market_id: string
          postal_code: string
          retailer_id: string
        }
        Insert: {
          created_at?: string
          market_id: string
          postal_code: string
          retailer_id: string
        }
        Update: {
          created_at?: string
          market_id?: string
          postal_code?: string
          retailer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retailer_market_postal_codes_market_fk"
            columns: ["market_id", "retailer_id"]
            isOneToOne: false
            referencedRelation: "retailer_markets"
            referencedColumns: ["id", "retailer_id"]
          },
          {
            foreignKeyName: "retailer_market_postal_codes_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      retailer_markets: {
        Row: {
          created_at: string
          external_id: string
          id: string
          metadata: Json
          name: string | null
          retailer_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_id: string
          id?: string
          metadata?: Json
          name?: string | null
          retailer_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_id?: string
          id?: string
          metadata?: Json
          name?: string | null
          retailer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "retailer_markets_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      retailer_products: {
        Row: {
          active: boolean
          brand: string | null
          category: string | null
          consecutive_misses: number
          created_at: string
          external_id: string
          gtin: string | null
          id: string
          image_url: string | null
          last_seen_at: string
          market_id: string | null
          name: string
          observed_at: string
          package_count: number | null
          package_size: number | null
          package_unit: string | null
          product_url: string | null
          raw_data: Json | null
          retailer_id: string
          subcategory: string | null
          total_amount: number | null
          updated_at: string
          variable_weight: boolean
        }
        Insert: {
          active?: boolean
          brand?: string | null
          category?: string | null
          consecutive_misses?: number
          created_at?: string
          external_id: string
          gtin?: string | null
          id?: string
          image_url?: string | null
          last_seen_at: string
          market_id?: string | null
          name: string
          observed_at: string
          package_count?: number | null
          package_size?: number | null
          package_unit?: string | null
          product_url?: string | null
          raw_data?: Json | null
          retailer_id: string
          subcategory?: string | null
          total_amount?: number | null
          updated_at?: string
          variable_weight?: boolean
        }
        Update: {
          active?: boolean
          brand?: string | null
          category?: string | null
          consecutive_misses?: number
          created_at?: string
          external_id?: string
          gtin?: string | null
          id?: string
          image_url?: string | null
          last_seen_at?: string
          market_id?: string | null
          name?: string
          observed_at?: string
          package_count?: number | null
          package_size?: number | null
          package_unit?: string | null
          product_url?: string | null
          raw_data?: Json | null
          retailer_id?: string
          subcategory?: string | null
          total_amount?: number | null
          updated_at?: string
          variable_weight?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "retailer_products_market_fk"
            columns: ["market_id", "retailer_id"]
            isOneToOne: false
            referencedRelation: "retailer_markets"
            referencedColumns: ["id", "retailer_id"]
          },
          {
            foreignKeyName: "retailer_products_retailer_id_fkey"
            columns: ["retailer_id"]
            isOneToOne: false
            referencedRelation: "retailers"
            referencedColumns: ["id"]
          },
        ]
      }
      retailers: {
        Row: {
          active: boolean
          capabilities: string[]
          code: string
          created_at: string
          id: string
          name: string
          operational_status: Database["public"]["Enums"]["provider_operational_status"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          capabilities?: string[]
          code: string
          created_at?: string
          id?: string
          name: string
          operational_status?: Database["public"]["Enums"]["provider_operational_status"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          capabilities?: string[]
          code?: string
          created_at?: string
          id?: string
          name?: string
          operational_status?: Database["public"]["Enums"]["provider_operational_status"]
          updated_at?: string
        }
        Relationships: []
      }
      shopping_intents: {
        Row: {
          brand_preference: string | null
          canonical_product_id: string | null
          checked: boolean
          created_at: string
          created_by: string | null
          id: string
          normalized_name: string
          package_count: number | null
          package_size: number | null
          package_unit: string | null
          raw_text: string
          requested_quantity: number | null
          requested_unit: string | null
          shopping_list_id: string
          total_amount: number | null
          updated_at: string
          variant: string | null
        }
        Insert: {
          brand_preference?: string | null
          canonical_product_id?: string | null
          checked?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          normalized_name: string
          package_count?: number | null
          package_size?: number | null
          package_unit?: string | null
          raw_text: string
          requested_quantity?: number | null
          requested_unit?: string | null
          shopping_list_id: string
          total_amount?: number | null
          updated_at?: string
          variant?: string | null
        }
        Update: {
          brand_preference?: string | null
          canonical_product_id?: string | null
          checked?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          normalized_name?: string
          package_count?: number | null
          package_size?: number | null
          package_unit?: string | null
          raw_text?: string
          requested_quantity?: number | null
          requested_unit?: string | null
          shopping_list_id?: string
          total_amount?: number | null
          updated_at?: string
          variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shopping_intents_canonical_product_id_fkey"
            columns: ["canonical_product_id"]
            isOneToOne: false
            referencedRelation: "canonical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_intents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_intents_shopping_list_id_fkey"
            columns: ["shopping_list_id"]
            isOneToOne: false
            referencedRelation: "shopping_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      shopping_lists: {
        Row: {
          created_at: string
          created_by: string | null
          group_id: string
          id: string
          name: string
          postal_code: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          group_id: string
          id?: string
          name: string
          postal_code: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          group_id?: string
          id?: string
          name?: string
          postal_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shopping_lists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shopping_lists_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_product_match: {
        Args: { target_match_id: string }
        Returns: {
          canonical_product_id: string
          confidence: string
          created_at: string
          id: string
          match_type: string
          matched_by: string | null
          method: string
          reasons: Json
          retailer_product_id: string
          reviewed: boolean
          reviewed_at: string | null
          score: number
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "product_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      add_shopping_product_operation: {
        Args: {
          brand_preference?: string
          canonical_product_id?: string
          normalized_name: string
          operation_id: string
          package_count?: number
          package_size?: number
          package_unit?: string
          raw_text: string
          requested_quantity?: number
          requested_unit?: string
          shopping_list_id: string
          total_amount?: number
          variant?: string
        }
        Returns: Json
      }
      admin_accept_product_match: {
        Args: { actor: string; target_match_id: string }
        Returns: {
          canonical_product_id: string
          confidence: string
          created_at: string
          id: string
          match_type: string
          matched_by: string | null
          method: string
          reasons: Json
          retailer_product_id: string
          reviewed: boolean
          reviewed_at: string | null
          score: number
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "product_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_reassign_product_match: {
        Args: {
          actor: string
          target_canonical_product_id: string
          target_match_id: string
        }
        Returns: {
          canonical_product_id: string
          confidence: string
          created_at: string
          id: string
          match_type: string
          matched_by: string | null
          method: string
          reasons: Json
          retailer_product_id: string
          reviewed: boolean
          reviewed_at: string | null
          score: number
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "product_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_reject_product_match: {
        Args: { actor: string; target_match_id: string }
        Returns: {
          canonical_product_id: string
          confidence: string
          created_at: string
          id: string
          match_type: string
          matched_by: string | null
          method: string
          reasons: Json
          retailer_product_id: string
          reviewed: boolean
          reviewed_at: string | null
          score: number
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "product_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_request_refresh: {
        Args: {
          actor: string
          target_postal_code: string
          target_product_ids: string[]
          target_request_type: Database["public"]["Enums"]["refresh_request_type"]
          target_retailer_id: string
        }
        Returns: {
          attempt_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json
          next_attempt_at: string
          postal_code: string
          product_ids: string[]
          request_type: Database["public"]["Enums"]["refresh_request_type"]
          requested_at: string
          requested_by: string
          retailer_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["refresh_request_status"]
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "refresh_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_set_provider_status: {
        Args: {
          actor: string
          target_retailer_id: string
          target_status: Database["public"]["Enums"]["provider_operational_status"]
        }
        Returns: {
          active: boolean
          capabilities: string[]
          code: string
          created_at: string
          id: string
          name: string
          operational_status: Database["public"]["Enums"]["provider_operational_status"]
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "retailers"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_update_canonical_product: {
        Args: {
          actor: string
          changes: Json
          target_canonical_product_id: string
        }
        Returns: {
          base_name: string
          brand: string | null
          category: string | null
          created_at: string
          gtin: string | null
          id: string
          name: string
          normalized_brand: string | null
          normalized_category: string | null
          normalized_name: string
          package_count: number | null
          package_size: number | null
          package_unit: string | null
          total_amount: number | null
          updated_at: string
          variant: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "canonical_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      apply_shopping_intent_operation: {
        Args: {
          action: string
          checked?: boolean
          intent_id?: string
          normalized_name?: string
          operation_id: string
          raw_text?: string
          shopping_list_id?: string
        }
        Returns: Json
      }
      apply_shopping_list_operation: {
        Args: {
          name?: string
          operation_id: string
          postal_code?: string
          shopping_list_id: string
        }
        Returns: Json
      }
      change_product_match: {
        Args: {
          target_canonical_product_id: string
          target_confidence: string
          target_match_type: string
          target_method: string
          target_reasons: Json
          target_retailer_product_id: string
          target_score: number
        }
        Returns: {
          canonical_product_id: string
          confidence: string
          created_at: string
          id: string
          match_type: string
          matched_by: string | null
          method: string
          reasons: Json
          retailer_product_id: string
          reviewed: boolean
          reviewed_at: string | null
          score: number
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "product_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_refresh_request: {
        Args: { claiming_worker_id: string }
        Returns: {
          attempt_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json
          next_attempt_at: string
          postal_code: string
          product_ids: string[]
          request_type: Database["public"]["Enums"]["refresh_request_type"]
          requested_at: string
          requested_by: string
          retailer_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["refresh_request_status"]
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "refresh_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_refresh_request: {
        Args: {
          completion_error?: string
          succeeded: boolean
          target_request_id: string
        }
        Returns: {
          attempt_count: number
          error_message: string | null
          finished_at: string | null
          id: string
          metadata: Json
          next_attempt_at: string
          postal_code: string
          product_ids: string[]
          request_type: Database["public"]["Enums"]["refresh_request_type"]
          requested_at: string
          requested_by: string
          retailer_id: string
          started_at: string | null
          status: Database["public"]["Enums"]["refresh_request_status"]
          worker_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "refresh_requests"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_group_with_initial_list: {
        Args: { group_name: string; list_name: string; postal_code: string }
        Returns: {
          group_id: string
          shopping_list_id: string
        }[]
      }
      dispatch_due_provider_jobs: {
        Args: never
        Returns: {
          enqueued_count: number
          max_jobs_per_tick: number
        }[]
      }
      edit_shopping_product_operation: {
        Args: {
          brand_preference?: string
          intent_id: string
          normalized_name: string
          operation_id: string
          package_count?: number
          package_size?: number
          package_unit?: string
          raw_text: string
          requested_quantity?: number
          requested_unit?: string
          total_amount?: number
          variant?: string
        }
        Returns: Json
      }
      generate_group_invite: {
        Args: {
          allowed_uses?: number
          expires_in?: string
          target_group_id: string
        }
        Returns: string
      }
      get_basket_comparison_inputs: {
        Args: { shopping_list_id: string }
        Returns: Json
      }
      get_offer_freshness_policy: {
        Args: never
        Returns: {
          stale_after_ms: number
          very_stale_after_ms: number
        }[]
      }
      ingest_product_offers_batch: {
        Args: {
          payload: Json
          target_market_id: string
          target_retailer_id: string
        }
        Returns: undefined
      }
      ingest_retailer_products_batch: {
        Args: {
          payload: Json
          target_market_id: string
          target_retailer_id: string
        }
        Returns: undefined
      }
      join_group_by_invite: { Args: { invite_code: string }; Returns: string }
      list_price_refresh_candidates: {
        Args: { target_market_id: string; target_retailer_id: string }
        Returns: {
          in_active_list: boolean
          last_used_at: string
          offer_observed_at: string
          retailer_product_external_id: string
        }[]
      }
      record_catalog_product_misses: {
        Args: {
          required_misses?: number
          seen_external_ids: string[]
          target_market_id: string
          target_retailer_id: string
        }
        Returns: number
      }
      record_catalog_product_misses_for_run: {
        Args: {
          required_misses?: number
          seen_external_ids: string[]
          target_market_id: string
          target_retailer_id: string
          target_sync_run_id: string
        }
        Returns: number
      }
      reject_product_match: {
        Args: { target_match_id: string }
        Returns: {
          canonical_product_id: string
          confidence: string
          created_at: string
          id: string
          match_type: string
          matched_by: string | null
          method: string
          reasons: Json
          retailer_product_id: string
          reviewed: boolean
          reviewed_at: string | null
          score: number
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "product_matches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_product_match_candidates: {
        Args: {
          candidate_limit?: number
          query_gtin: string
          query_normalized_category?: string
          query_normalized_name: string
        }
        Returns: {
          base_name: string
          brand: string | null
          category: string | null
          created_at: string
          gtin: string | null
          id: string
          name: string
          normalized_brand: string | null
          normalized_category: string | null
          normalized_name: string
          package_count: number | null
          package_size: number | null
          package_unit: string | null
          total_amount: number | null
          updated_at: string
          variant: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "canonical_products"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      search_products_for_list: {
        Args: { query: string; result_limit?: number; shopping_list_id: string }
        Returns: Json
      }
    }
    Enums: {
      group_member_role: "owner" | "member"
      provider_health_status: "healthy" | "degraded" | "unavailable"
      provider_operational_status: "ACTIVE" | "DEGRADED" | "DISABLED"
      provider_sync_status: "running" | "succeeded" | "partial" | "failed"
      refresh_request_status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED"
      refresh_request_type: "PRICE_REFRESH" | "CATALOG_SYNC"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      group_member_role: ["owner", "member"],
      provider_health_status: ["healthy", "degraded", "unavailable"],
      provider_operational_status: ["ACTIVE", "DEGRADED", "DISABLED"],
      provider_sync_status: ["running", "succeeded", "partial", "failed"],
      refresh_request_status: ["PENDING", "RUNNING", "SUCCEEDED", "FAILED"],
      refresh_request_type: ["PRICE_REFRESH", "CATALOG_SYNC"],
    },
  },
} as const

