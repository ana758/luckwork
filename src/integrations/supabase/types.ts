export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      access_entries: {
        Row: {
          created_at: string
          id: string
          is_connected: boolean
          label: string
          login: string | null
          password_ciphertext: string | null
          source: Database["public"]["Enums"]["source_key"]
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_connected?: boolean
          label: string
          login?: string | null
          password_ciphertext?: string | null
          source: Database["public"]["Enums"]["source_key"]
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_connected?: boolean
          label?: string
          login?: string | null
          password_ciphertext?: string | null
          source?: Database["public"]["Enums"]["source_key"]
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      crm_angi_events: {
        Row: {
          created_at: string
          error: string | null
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed_at: string | null
          task_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id: string
          event_type: string
          id?: string
          payload: Json
          processed_at?: string | null
          task_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_angi_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          created_at: string
          email: string
          id: string
          is_connected: boolean
          provider: string
          source: Database["public"]["Enums"]["source_key"]
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_connected?: boolean
          provider?: string
          source?: Database["public"]["Enums"]["source_key"]
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_connected?: boolean
          provider?: string
          source?: Database["public"]["Enums"]["source_key"]
        }
        Relationships: []
      }
      meetings: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          external_url: string | null
          google_account: string | null
          google_event_id: string | null
          hidden: boolean
          id: string
          location: string | null
          meeting_type: string | null
          notes: string | null
          people: string | null
          source: Database["public"]["Enums"]["source_key"]
          starts_at: string
          status: string
          synced_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          external_url?: string | null
          google_account?: string | null
          google_event_id?: string | null
          hidden?: boolean
          id?: string
          location?: string | null
          meeting_type?: string | null
          notes?: string | null
          people?: string | null
          source?: Database["public"]["Enums"]["source_key"]
          starts_at: string
          status?: string
          synced_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          external_url?: string | null
          google_account?: string | null
          google_event_id?: string | null
          hidden?: boolean
          id?: string
          location?: string | null
          meeting_type?: string | null
          notes?: string | null
          people?: string | null
          source?: Database["public"]["Enums"]["source_key"]
          starts_at?: string
          status?: string
          synced_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          read_at: string | null
          task_id: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          task_id?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          task_id?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_pushes: {
        Row: {
          body: string | null
          created_at: string
          delivered_at: string | null
          id: string
          tag: string | null
          title: string
          url: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          tag?: string | null
          title: string
          url?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          delivered_at?: string | null
          id?: string
          tag?: string | null
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      source_rules: {
        Row: {
          created_at: string
          id: string
          source: string
          title_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          source: string
          title_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          source?: string
          title_key?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: string | null
          id: string
          imported: number | null
          pushed: number | null
          source: string
          status: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          imported?: number | null
          pushed?: number | null
          source: string
          status: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: string
          imported?: number | null
          pushed?: number | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          crm_destination: string | null
          crm_interaction_id: string | null
          crm_lead_id: string | null
          due_date: string | null
          external_id: string | null
          external_system: string | null
          external_url: string | null
          google_account: string | null
          google_event_id: string | null
          id: string
          notes: string | null
          priority: Database["public"]["Enums"]["task_priority"]
          recurrence: Database["public"]["Enums"]["recurrence_kind"]
          source: Database["public"]["Enums"]["source_key"]
          start_date: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          crm_destination?: string | null
          crm_interaction_id?: string | null
          crm_lead_id?: string | null
          due_date?: string | null
          external_id?: string | null
          external_system?: string | null
          external_url?: string | null
          google_account?: string | null
          google_event_id?: string | null
          id?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence?: Database["public"]["Enums"]["recurrence_kind"]
          source?: Database["public"]["Enums"]["source_key"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          crm_destination?: string | null
          crm_interaction_id?: string | null
          crm_lead_id?: string | null
          due_date?: string | null
          external_id?: string | null
          external_system?: string | null
          external_url?: string | null
          google_account?: string | null
          google_event_id?: string | null
          id?: string
          notes?: string | null
          priority?: Database["public"]["Enums"]["task_priority"]
          recurrence?: Database["public"]["Enums"]["recurrence_kind"]
          source?: Database["public"]["Enums"]["source_key"]
          start_date?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      workspace_members: {
        Row: {
          created_at: string
          email: string
          id: string
          status: Database["public"]["Enums"]["member_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          status?: Database["public"]["Enums"]["member_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          status?: Database["public"]["Enums"]["member_status"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_logs: { Args: never; Returns: undefined }
      is_active_member: { Args: { _user_id: string }; Returns: boolean }
      luck_meeting_title_key: { Args: { _title: string }; Returns: string }
    }
    Enums: {
      member_status: "active" | "pending"
      recurrence_kind: "none" | "daily" | "weekly" | "monthly"
      source_key: "angi" | "devore" | "bruna" | "pessoal"
      task_priority: "alta" | "media" | "baixa"
      task_status: "todo" | "doing" | "onhold" | "done"
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
      member_status: ["active", "pending"],
      recurrence_kind: ["none", "daily", "weekly", "monthly"],
      source_key: ["angi", "devore", "bruna", "pessoal"],
      task_priority: ["alta", "media", "baixa"],
      task_status: ["todo", "doing", "onhold", "done"],
    },
  },
} as const
