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
      canonical_products: {
        Row: {
          category: string | null
          created_at: string
          id: string
          name: string
          normalized_name: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          name: string
          normalized_name: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          name?: string
          normalized_name?: string
          updated_at?: string
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
          confidence: number | null
          created_at: string
          id: string
          match_method: string
          matched_by: string | null
          retailer_product_id: string
          updated_at: string
        }
        Insert: {
          canonical_product_id: string
          confidence?: number | null
          created_at?: string
          id?: string
          match_method?: string
          matched_by?: string | null
          retailer_product_id: string
          updated_at?: string
        }
        Update: {
          canonical_product_id?: string
          confidence?: number | null
          created_at?: string
          id?: string
          match_method?: string
          matched_by?: string | null
          retailer_product_id?: string
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
            isOneToOne: true
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
      provider_sync_runs: {
        Row: {
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
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          name?: string
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
      create_group_with_initial_list: {
        Args: { group_name: string; list_name: string; postal_code: string }
        Returns: {
          group_id: string
          shopping_list_id: string
        }[]
      }
      generate_group_invite: {
        Args: {
          allowed_uses?: number
          expires_in?: string
          target_group_id: string
        }
        Returns: string
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
    }
    Enums: {
      group_member_role: "owner" | "member"
      provider_health_status: "healthy" | "degraded" | "unavailable"
      provider_sync_status: "running" | "succeeded" | "partial" | "failed"
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
      provider_sync_status: ["running", "succeeded", "partial", "failed"],
    },
  },
} as const

