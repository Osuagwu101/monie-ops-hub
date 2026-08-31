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
      agent_recommendations: {
        Row: {
          agent_kind: string
          assigned_to: string | null
          created_at: string
          evidence: Json
          evidence_snapshot_id: string | null
          id: string
          merchant_id: string | null
          operational_state: string | null
          plan_date: string
          rationale: string
          recommendation_kind: string
          report_id: string | null
          run_id: string
          score: number | null
          status: string
          suggested_task_type: Database["public"]["Enums"]["task_type"] | null
          talking_points: string | null
          terminal_id: string | null
          title: string
        }
        Insert: {
          agent_kind: string
          assigned_to?: string | null
          created_at?: string
          evidence?: Json
          evidence_snapshot_id?: string | null
          id?: string
          merchant_id?: string | null
          operational_state?: string | null
          plan_date: string
          rationale: string
          recommendation_kind: string
          report_id?: string | null
          run_id: string
          score?: number | null
          status?: string
          suggested_task_type?: Database["public"]["Enums"]["task_type"] | null
          talking_points?: string | null
          terminal_id?: string | null
          title: string
        }
        Update: {
          agent_kind?: string
          assigned_to?: string | null
          created_at?: string
          evidence?: Json
          evidence_snapshot_id?: string | null
          id?: string
          merchant_id?: string | null
          operational_state?: string | null
          plan_date?: string
          rationale?: string
          recommendation_kind?: string
          report_id?: string | null
          run_id?: string
          score?: number | null
          status?: string
          suggested_task_type?: Database["public"]["Enums"]["task_type"] | null
          talking_points?: string | null
          terminal_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_recommendations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_recommendations_evidence_snapshot_id_fkey"
            columns: ["evidence_snapshot_id"]
            isOneToOne: false
            referencedRelation: "terminal_performance_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_recommendations_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_recommendations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_recommendations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_recommendations_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_kind: string
          assistant_id: string | null
          completed_at: string | null
          created_at: string
          id: string
          input_snapshot: Json
          output_summary: Json
          plan_date: string
          report_id: string | null
          status: string
        }
        Insert: {
          agent_kind: string
          assistant_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          input_snapshot?: Json
          output_summary?: Json
          plan_date: string
          report_id?: string | null
          status?: string
        }
        Update: {
          agent_kind?: string
          assistant_id?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          input_snapshot?: Json
          output_summary?: Json
          plan_date?: string
          report_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_assistant_id_fkey"
            columns: ["assistant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_kind: string
          actor_user_id: string | null
          entity_id: string | null
          entity_type: string
          event_type: string
          id: number
          occurred_at: string
          payload: Json
        }
        Insert: {
          actor_kind: string
          actor_user_id?: string | null
          entity_id?: string | null
          entity_type: string
          event_type: string
          id?: never
          occurred_at?: string
          payload?: Json
        }
        Update: {
          actor_kind?: string
          actor_user_id?: string | null
          entity_id?: string | null
          entity_type?: string
          event_type?: string
          id?: never
          occurred_at?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_config: {
        Row: {
          allowed_domains: string[]
          auth_state: string
          auth_state_checked_at: string | null
          auth_state_message: string | null
          browser_profile_id: string | null
          created_at: string
          enabled: boolean
          evening_refresh_time: string
          id: boolean
          max_attempts: number
          max_steps: number
          moniepoint_login_url: string | null
          morning_audit_time: string
          morning_refresh_time: string
          poll_interval_minutes: number
          proxy_country_code: string | null
          retry_backoff_minutes: number
          updated_at: string
          updated_by: string | null
          worker_url: string
        }
        Insert: {
          allowed_domains?: string[]
          auth_state?: string
          auth_state_checked_at?: string | null
          auth_state_message?: string | null
          browser_profile_id?: string | null
          created_at?: string
          enabled?: boolean
          evening_refresh_time?: string
          id?: boolean
          max_attempts?: number
          max_steps?: number
          moniepoint_login_url?: string | null
          morning_audit_time?: string
          morning_refresh_time?: string
          poll_interval_minutes?: number
          proxy_country_code?: string | null
          retry_backoff_minutes?: number
          updated_at?: string
          updated_by?: string | null
          worker_url?: string
        }
        Update: {
          allowed_domains?: string[]
          auth_state?: string
          auth_state_checked_at?: string | null
          auth_state_message?: string | null
          browser_profile_id?: string | null
          created_at?: string
          enabled?: boolean
          evening_refresh_time?: string
          id?: boolean
          max_attempts?: number
          max_steps?: number
          moniepoint_login_url?: string | null
          morning_audit_time?: string
          morning_refresh_time?: string
          poll_interval_minutes?: number
          proxy_country_code?: string | null
          retry_backoff_minutes?: number
          updated_at?: string
          updated_by?: string | null
          worker_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          attempt_count: number
          browser_session_id: string | null
          browser_task_id: string | null
          completed_at: string | null
          created_at: string
          diagnostics: Json
          id: string
          last_error_code: string | null
          last_error_message: string | null
          last_http_request_id: number | null
          lease_expires_at: string | null
          next_attempt_at: string
          report_id: string | null
          scheduled_for: string
          source_sha256: string | null
          source_storage_path: string | null
          started_at: string | null
          status: string
          trigger_kind: string
          updated_at: string
          upload_nonce_hash: string | null
        }
        Insert: {
          attempt_count?: number
          browser_session_id?: string | null
          browser_task_id?: string | null
          completed_at?: string | null
          created_at?: string
          diagnostics?: Json
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_http_request_id?: number | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          report_id?: string | null
          scheduled_for?: string
          source_sha256?: string | null
          source_storage_path?: string | null
          started_at?: string | null
          status?: string
          trigger_kind: string
          updated_at?: string
          upload_nonce_hash?: string | null
        }
        Update: {
          attempt_count?: number
          browser_session_id?: string | null
          browser_task_id?: string | null
          completed_at?: string | null
          created_at?: string
          diagnostics?: Json
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          last_http_request_id?: number | null
          lease_expires_at?: string | null
          next_attempt_at?: string
          report_id?: string | null
          scheduled_for?: string
          source_sha256?: string | null
          source_storage_path?: string | null
          started_at?: string | null
          status?: string
          trigger_kind?: string
          updated_at?: string
          upload_nonce_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_verification_challenges: {
        Row: {
          browser_session_id: string | null
          browser_task_id: string | null
          challenge_type: string
          created_at: string
          expires_at: string
          id: string
          message: string | null
          requested_at: string
          resolution_reason: string | null
          resolved_at: string | null
          run_id: string
          status: string
          submitted_at: string | null
          updated_at: string
        }
        Insert: {
          browser_session_id?: string | null
          browser_task_id?: string | null
          challenge_type?: string
          created_at?: string
          expires_at: string
          id?: string
          message?: string | null
          requested_at?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          run_id: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Update: {
          browser_session_id?: string | null
          browser_task_id?: string | null
          challenge_type?: string
          created_at?: string
          expires_at?: string
          id?: string
          message?: string | null
          requested_at?: string
          resolution_reason?: string | null
          resolved_at?: string | null
          run_id?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_verification_challenges_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      bo_attention_queue: {
        Row: {
          created_at: string
          id: string
          merchant_id: string | null
          plan_date: string
          priority_score: number
          queue_rank: number
          report_id: string
          snapshot_id: string
          terminal_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          merchant_id?: string | null
          plan_date: string
          priority_score: number
          queue_rank: number
          report_id: string
          snapshot_id: string
          terminal_id: string
        }
        Update: {
          created_at?: string
          id?: string
          merchant_id?: string | null
          plan_date?: string
          priority_score?: number
          queue_rank?: number
          report_id?: string
          snapshot_id?: string
          terminal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bo_attention_queue_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bo_attention_queue_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bo_attention_queue_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "terminal_performance_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bo_attention_queue_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      business_contact_lookup_audit: {
        Row: {
          business_contact_id: string | null
          created_at: string
          details: Json
          id: string
          outcome: string
          requested_business_name: string
          source_reference: string | null
          source_report_date: string | null
          terminal_id: string
          terminal_serial: string
        }
        Insert: {
          business_contact_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          outcome: string
          requested_business_name: string
          source_reference?: string | null
          source_report_date?: string | null
          terminal_id: string
          terminal_serial: string
        }
        Update: {
          business_contact_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          outcome?: string
          requested_business_name?: string
          source_reference?: string | null
          source_report_date?: string | null
          terminal_id?: string
          terminal_serial?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_contact_lookup_audit_business_contact_id_fkey"
            columns: ["business_contact_id"]
            isOneToOne: false
            referencedRelation: "business_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      business_contact_terminal_links: {
        Row: {
          business_contact_id: string
          created_at: string
          crm_source_path: string | null
          id: string
          last_seen_at: string
          match_method: string
          pos_account_number: string
          source_report_date: string
          terminal_id: string
          terminal_serial: string
          verified_at: string
        }
        Insert: {
          business_contact_id: string
          created_at?: string
          crm_source_path?: string | null
          id?: string
          last_seen_at?: string
          match_method: string
          pos_account_number: string
          source_report_date: string
          terminal_id: string
          terminal_serial: string
          verified_at?: string
        }
        Update: {
          business_contact_id?: string
          created_at?: string
          crm_source_path?: string | null
          id?: string
          last_seen_at?: string
          match_method?: string
          pos_account_number?: string
          source_report_date?: string
          terminal_id?: string
          terminal_serial?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_contact_terminal_links_business_contact_id_fkey"
            columns: ["business_contact_id"]
            isOneToOne: false
            referencedRelation: "business_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      business_contacts: {
        Row: {
          canonical_name: string
          created_at: string
          id: string
          last_seen_at: string
          phone_number: string
          updated_at: string
          verification_status: string
          verified_at: string | null
        }
        Insert: {
          canonical_name: string
          created_at?: string
          id?: string
          last_seen_at?: string
          phone_number: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Update: {
          canonical_name?: string
          created_at?: string
          id?: string
          last_seen_at?: string
          phone_number?: string
          updated_at?: string
          verification_status?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      compensation_recommendations: {
        Row: {
          assistant_id: string
          created_at: string
          director_note: string | null
          evidence: Json
          id: string
          period_end: string
          period_start: string
          rationale: string
          recommendation_percent: number | null
          recommendation_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          scorecard_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assistant_id: string
          created_at?: string
          director_note?: string | null
          evidence?: Json
          id?: string
          period_end: string
          period_start: string
          rationale: string
          recommendation_percent?: number | null
          recommendation_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scorecard_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assistant_id?: string
          created_at?: string
          director_note?: string | null
          evidence?: Json
          id?: string
          period_end?: string
          period_start?: string
          rationale?: string
          recommendation_percent?: number | null
          recommendation_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scorecard_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compensation_recommendations_assistant_id_fkey"
            columns: ["assistant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compensation_recommendations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compensation_recommendations_scorecard_id_fkey"
            columns: ["scorecard_id"]
            isOneToOne: false
            referencedRelation: "performance_scorecards"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_bootstrap_runs: {
        Row: {
          batch_size: number
          browser_session_id: string | null
          browser_task_id: string | null
          completed_at: string | null
          created_at: string
          diagnostics: Json
          id: string
          last_error_code: string | null
          last_error_message: string | null
          next_offset: number
          not_found_count: number
          report_id: string
          review_count: number
          started_at: string | null
          status: string
          total_items: number
          updated_at: string
          verified_count: number
        }
        Insert: {
          batch_size?: number
          browser_session_id?: string | null
          browser_task_id?: string | null
          completed_at?: string | null
          created_at?: string
          diagnostics?: Json
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          next_offset?: number
          not_found_count?: number
          report_id: string
          review_count?: number
          started_at?: string | null
          status?: string
          total_items?: number
          updated_at?: string
          verified_count?: number
        }
        Update: {
          batch_size?: number
          browser_session_id?: string | null
          browser_task_id?: string | null
          completed_at?: string | null
          created_at?: string
          diagnostics?: Json
          id?: string
          last_error_code?: string | null
          last_error_message?: string | null
          next_offset?: number
          not_found_count?: number
          report_id?: string
          review_count?: number
          started_at?: string | null
          status?: string
          total_items?: number
          updated_at?: string
          verified_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "contact_bootstrap_runs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_mirror_snapshots: {
        Row: {
          automation_run_id: string | null
          captured_at: string
          created_at: string
          id: string
          payload: Json
          report_id: string | null
          source_url: string | null
        }
        Insert: {
          automation_run_id?: string | null
          captured_at?: string
          created_at?: string
          id?: string
          payload?: Json
          report_id?: string | null
          source_url?: string | null
        }
        Update: {
          automation_run_id?: string | null
          captured_at?: string
          created_at?: string
          id?: string
          payload?: Json
          report_id?: string | null
          source_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_mirror_snapshots_automation_run_id_fkey"
            columns: ["automation_run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_mirror_snapshots_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_notification_deliveries: {
        Row: {
          device_id: string
          expo_ticket_id: string | null
          id: string
          last_error: string | null
          notification_key: string
          occurrence_id: string
          queued_at: string
          sent_at: string | null
          sequence_no: number
          stage: string
          status: string
          updated_at: string
        }
        Insert: {
          device_id: string
          expo_ticket_id?: string | null
          id?: string
          last_error?: string | null
          notification_key: string
          occurrence_id: string
          queued_at?: string
          sent_at?: string | null
          sequence_no?: number
          stage: string
          status?: string
          updated_at?: string
        }
        Update: {
          device_id?: string
          expo_ticket_id?: string | null
          id?: string
          last_error?: string | null
          notification_key?: string
          occurrence_id?: string
          queued_at?: string
          sent_at?: string | null
          sequence_no?: number
          stage?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_notification_deliveries_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "mobile_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_notification_deliveries_occurrence_id_fkey"
            columns: ["occurrence_id"]
            isOneToOne: false
            referencedRelation: "meeting_occurrences"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_occurrences: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          series_id: string
          starts_at: string
          status: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          series_id: string
          starts_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          id?: string
          series_id?: string
          starts_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_occurrences_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_occurrences_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "meeting_series"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_series: {
        Row: {
          created_at: string
          created_by: string | null
          enabled: boolean
          escalation_after_minutes: number
          escalation_max_hours: number
          escalation_repeat_minutes: number
          id: string
          meeting_url: string | null
          month_ordinals: number[]
          name: string
          recurrence_kind: string
          reminder_10_minutes: boolean
          reminder_2_minutes: boolean
          slug: string
          start_time: string
          timezone: string
          updated_at: string
          updated_by: string | null
          weekday: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          escalation_after_minutes?: number
          escalation_max_hours?: number
          escalation_repeat_minutes?: number
          id?: string
          meeting_url?: string | null
          month_ordinals?: number[]
          name: string
          recurrence_kind: string
          reminder_10_minutes?: boolean
          reminder_2_minutes?: boolean
          slug: string
          start_time: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekday: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          escalation_after_minutes?: number
          escalation_max_hours?: number
          escalation_repeat_minutes?: number
          id?: string
          meeting_url?: string | null
          month_ordinals?: number[]
          name?: string
          recurrence_kind?: string
          reminder_10_minutes?: boolean
          reminder_2_minutes?: boolean
          slug?: string
          start_time?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "meeting_series_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_series_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      merchants: {
        Row: {
          account_number: string | null
          business_name: string
          contact_source: string | null
          contact_synced_at: string | null
          created_at: string
          external_business_ref: string | null
          id: string
          is_active: boolean
          phone_number: string | null
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          business_name: string
          contact_source?: string | null
          contact_synced_at?: string | null
          created_at?: string
          external_business_ref?: string | null
          id?: string
          is_active?: boolean
          phone_number?: string | null
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          business_name?: string
          contact_source?: string | null
          contact_synced_at?: string | null
          created_at?: string
          external_business_ref?: string | null
          id?: string
          is_active?: boolean
          phone_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      mobile_devices: {
        Row: {
          app_version: string | null
          created_at: string
          device_label: string | null
          enabled: boolean
          exact_alarm_capable: boolean
          expo_push_token: string
          id: string
          last_seen_at: string
          notifications_granted: boolean
          platform: string
          updated_at: string
          user_id: string
        }
        Insert: {
          app_version?: string | null
          created_at?: string
          device_label?: string | null
          enabled?: boolean
          exact_alarm_capable?: boolean
          expo_push_token: string
          id?: string
          last_seen_at?: string
          notifications_granted?: boolean
          platform: string
          updated_at?: string
          user_id: string
        }
        Update: {
          app_version?: string | null
          created_at?: string
          device_label?: string | null
          enabled?: boolean
          exact_alarm_capable?: boolean
          expo_push_token?: string
          id?: string
          last_seen_at?: string
          notifications_granted?: boolean
          platform?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mobile_devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_config: {
        Row: {
          assistant_shift_end: string
          assistant_shift_start: string
          bonus_percent: number
          bonus_streak_days: number
          bonus_threshold_percent: number
          company_target_percent: number
          critical_threshold_percent: number
          daily_call_target: number
          daily_contact_capacity: number
          id: boolean
          management_warning_threshold_percent: number
          monthly_loan_target: number
          next_day_verification_time: string
          penalty_trigger_percent: number
          rolling_weekly_ta_target_naira: number
          ta_call_share_max: number
          ta_call_share_min: number
          team_standard_percent: number
          updated_at: string
        }
        Insert: {
          assistant_shift_end?: string
          assistant_shift_start?: string
          bonus_percent?: number
          bonus_streak_days?: number
          bonus_threshold_percent?: number
          company_target_percent?: number
          critical_threshold_percent?: number
          daily_call_target?: number
          daily_contact_capacity?: number
          id?: boolean
          management_warning_threshold_percent?: number
          monthly_loan_target?: number
          next_day_verification_time?: string
          penalty_trigger_percent?: number
          rolling_weekly_ta_target_naira?: number
          ta_call_share_max?: number
          ta_call_share_min?: number
          team_standard_percent?: number
          updated_at?: string
        }
        Update: {
          assistant_shift_end?: string
          assistant_shift_start?: string
          bonus_percent?: number
          bonus_streak_days?: number
          bonus_threshold_percent?: number
          company_target_percent?: number
          critical_threshold_percent?: number
          daily_call_target?: number
          daily_contact_capacity?: number
          id?: boolean
          management_warning_threshold_percent?: number
          monthly_loan_target?: number
          next_day_verification_time?: string
          penalty_trigger_percent?: number
          rolling_weekly_ta_target_naira?: number
          ta_call_share_max?: number
          ta_call_share_min?: number
          team_standard_percent?: number
          updated_at?: string
        }
        Relationships: []
      }
      performance_scorecards: {
        Row: {
          amina_message: string
          created_at: string
          evidence: Json
          id: string
          individual_score_percent: number
          management_mode: string
          rating: string
          report_id: string
          scope_assistant_id: string
          score_date: string
          subject_key: string
          subject_kind: string
          subject_user_id: string | null
          team_performance_percent: number | null
          updated_at: string
        }
        Insert: {
          amina_message: string
          created_at?: string
          evidence?: Json
          id?: string
          individual_score_percent: number
          management_mode: string
          rating: string
          report_id: string
          scope_assistant_id: string
          score_date: string
          subject_key: string
          subject_kind: string
          subject_user_id?: string | null
          team_performance_percent?: number | null
          updated_at?: string
        }
        Update: {
          amina_message?: string
          created_at?: string
          evidence?: Json
          id?: string
          individual_score_percent?: number
          management_mode?: string
          rating?: string
          report_id?: string
          scope_assistant_id?: string
          score_date?: string
          subject_key?: string
          subject_kind?: string
          subject_user_id?: string | null
          team_performance_percent?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "performance_scorecards_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_scorecards_scope_assistant_id_fkey"
            columns: ["scope_assistant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performance_scorecards_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_performance_snapshots: {
        Row: {
          active_assigned_7_plus_days_count: number | null
          active_terminal_count: number | null
          assigned_7_plus_days_count: number | null
          assigned_terminal_count: number | null
          assigned_terminal_growth: number | null
          captured_at: string
          daily_target_met_count: number | null
          id: string
          parsed_daily_row_count: number | null
          parsed_non_transacting_row_count: number | null
          parsed_rolling_row_count: number | null
          payment_value: number | null
          payment_volume: number | null
          report_date: string
          report_id: string
          rolling_target_met_count: number | null
          terminal_activity_rate: number
          top_bo_retention_rate: number | null
          total_terminal_count: number | null
          transfer_value: number | null
          transfer_volume: number | null
          unassigned_terminal_count: number | null
        }
        Insert: {
          active_assigned_7_plus_days_count?: number | null
          active_terminal_count?: number | null
          assigned_7_plus_days_count?: number | null
          assigned_terminal_count?: number | null
          assigned_terminal_growth?: number | null
          captured_at?: string
          daily_target_met_count?: number | null
          id?: string
          parsed_daily_row_count?: number | null
          parsed_non_transacting_row_count?: number | null
          parsed_rolling_row_count?: number | null
          payment_value?: number | null
          payment_volume?: number | null
          report_date: string
          report_id: string
          rolling_target_met_count?: number | null
          terminal_activity_rate: number
          top_bo_retention_rate?: number | null
          total_terminal_count?: number | null
          transfer_value?: number | null
          transfer_volume?: number | null
          unassigned_terminal_count?: number | null
        }
        Update: {
          active_assigned_7_plus_days_count?: number | null
          active_terminal_count?: number | null
          assigned_7_plus_days_count?: number | null
          assigned_terminal_count?: number | null
          assigned_terminal_growth?: number | null
          captured_at?: string
          daily_target_met_count?: number | null
          id?: string
          parsed_daily_row_count?: number | null
          parsed_non_transacting_row_count?: number | null
          parsed_rolling_row_count?: number | null
          payment_value?: number | null
          payment_volume?: number | null
          report_date?: string
          report_id?: string
          rolling_target_met_count?: number | null
          terminal_activity_rate?: number
          top_bo_retention_rate?: number | null
          total_terminal_count?: number | null
          transfer_value?: number | null
          transfer_volume?: number | null
          unassigned_terminal_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "portfolio_performance_snapshots_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: true
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      readiness_audits: {
        Row: {
          created_at: string
          id: string
          overall_status: string
          run_by: string | null
          snapshot: Json
        }
        Insert: {
          created_at?: string
          id?: string
          overall_status: string
          run_by?: string | null
          snapshot: Json
        }
        Update: {
          created_at?: string
          id?: string
          overall_status?: string
          run_by?: string | null
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "readiness_audits_run_by_fkey"
            columns: ["run_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_contact_resolutions: {
        Row: {
          account_number: string | null
          business_name: string
          created_at: string
          id: string
          merchant_id: string | null
          phone_number: string | null
          report_id: string
          resolution_reason: string
          resolution_status: string
          task_created: boolean
          terminal_external_id: string
          terminal_id: string | null
          terminal_serial: string | null
          updated_at: string
        }
        Insert: {
          account_number?: string | null
          business_name: string
          created_at?: string
          id?: string
          merchant_id?: string | null
          phone_number?: string | null
          report_id: string
          resolution_reason: string
          resolution_status: string
          task_created?: boolean
          terminal_external_id: string
          terminal_id?: string | null
          terminal_serial?: string | null
          updated_at?: string
        }
        Update: {
          account_number?: string | null
          business_name?: string
          created_at?: string
          id?: string
          merchant_id?: string | null
          phone_number?: string | null
          report_id?: string
          resolution_reason?: string
          resolution_status?: string
          task_created?: boolean
          terminal_external_id?: string
          terminal_id?: string | null
          terminal_serial?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_contact_resolutions_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_contact_resolutions_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_contact_resolutions_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      report_imports: {
        Row: {
          brm_name: string | null
          id: string
          imported_at: string
          imported_by: string | null
          parsed_summary: Json
          parser_version: string | null
          processing_error: string | null
          processing_status: string
          report_date: string
          row_count: number | null
          source_filename: string
          source_kind: string
          source_sha256: string
          source_storage_path: string | null
        }
        Insert: {
          brm_name?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          parsed_summary?: Json
          parser_version?: string | null
          processing_error?: string | null
          processing_status?: string
          report_date: string
          row_count?: number | null
          source_filename: string
          source_kind?: string
          source_sha256: string
          source_storage_path?: string | null
        }
        Update: {
          brm_name?: string | null
          id?: string
          imported_at?: string
          imported_by?: string | null
          parsed_summary?: Json
          parser_version?: string | null
          processing_error?: string | null
          processing_status?: string
          report_date?: string
          row_count?: number | null
          source_filename?: string
          source_kind?: string
          source_sha256?: string
          source_storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "report_imports_imported_by_fkey"
            columns: ["imported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_terminal_rows: {
        Row: {
          business_name: string
          business_registration_date: string | null
          created_at: string
          days_since_last_transaction: number | null
          id: string
          last_transaction_date: string | null
          official_target_met: boolean | null
          official_target_value: number | null
          payment_value: number | null
          payment_volume: number | null
          period_end: string | null
          period_start: string | null
          raw_payload: Json
          report_id: string
          row_number: number
          section_kind: Database["public"]["Enums"]["report_terminal_section"]
          terminal_assignment_date: string | null
          terminal_external_id: string
          terminal_serial: string | null
          transfer_value: number | null
          transfer_volume: number | null
        }
        Insert: {
          business_name: string
          business_registration_date?: string | null
          created_at?: string
          days_since_last_transaction?: number | null
          id?: string
          last_transaction_date?: string | null
          official_target_met?: boolean | null
          official_target_value?: number | null
          payment_value?: number | null
          payment_volume?: number | null
          period_end?: string | null
          period_start?: string | null
          raw_payload?: Json
          report_id: string
          row_number: number
          section_kind: Database["public"]["Enums"]["report_terminal_section"]
          terminal_assignment_date?: string | null
          terminal_external_id: string
          terminal_serial?: string | null
          transfer_value?: number | null
          transfer_volume?: number | null
        }
        Update: {
          business_name?: string
          business_registration_date?: string | null
          created_at?: string
          days_since_last_transaction?: number | null
          id?: string
          last_transaction_date?: string | null
          official_target_met?: boolean | null
          official_target_value?: number | null
          payment_value?: number | null
          payment_volume?: number | null
          period_end?: string | null
          period_start?: string | null
          raw_payload?: Json
          report_id?: string
          row_number?: number
          section_kind?: Database["public"]["Enums"]["report_terminal_section"]
          terminal_assignment_date?: string | null
          terminal_external_id?: string
          terminal_serial?: string | null
          transfer_value?: number | null
          transfer_volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "report_terminal_rows_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_invites: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          created_at: string
          created_by: string
          email: string
          expires_at: string
          full_name: string
          id: string
          status: string
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          created_by: string
          email: string
          expires_at?: string
          full_name: string
          id?: string
          status?: string
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          created_at?: string
          created_by?: string
          email?: string
          expires_at?: string
          full_name?: string
          id?: string
          status?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_accepted_user_id_fkey"
            columns: ["accepted_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_outcomes: {
        Row: {
          assistant_id: string
          attempt_number: number
          callback_at: string | null
          commitment_received: boolean | null
          expected_amount: number | null
          expected_by: string | null
          id: string
          notes: string | null
          outcome_code: Database["public"]["Enums"]["task_outcome_code"] | null
          postponement_reason: string | null
          reached_merchant: boolean | null
          submitted_at: string
          task_id: string
        }
        Insert: {
          assistant_id: string
          attempt_number?: number
          callback_at?: string | null
          commitment_received?: boolean | null
          expected_amount?: number | null
          expected_by?: string | null
          id?: string
          notes?: string | null
          outcome_code?: Database["public"]["Enums"]["task_outcome_code"] | null
          postponement_reason?: string | null
          reached_merchant?: boolean | null
          submitted_at?: string
          task_id: string
        }
        Update: {
          assistant_id?: string
          attempt_number?: number
          callback_at?: string | null
          commitment_received?: boolean | null
          expected_amount?: number | null
          expected_by?: string | null
          id?: string
          notes?: string | null
          outcome_code?: Database["public"]["Enums"]["task_outcome_code"] | null
          postponement_reason?: string | null
          reached_merchant?: boolean | null
          submitted_at?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_outcomes_assistant_id_fkey"
            columns: ["assistant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_outcomes_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_verifications: {
        Row: {
          evidence_snapshot_id: string | null
          id: string
          rationale: string
          state: Database["public"]["Enums"]["verification_state"]
          task_id: string
          verified_against_report_id: string | null
          verified_at: string
          verified_by: string | null
        }
        Insert: {
          evidence_snapshot_id?: string | null
          id?: string
          rationale: string
          state: Database["public"]["Enums"]["verification_state"]
          task_id: string
          verified_against_report_id?: string | null
          verified_at?: string
          verified_by?: string | null
        }
        Update: {
          evidence_snapshot_id?: string | null
          id?: string
          rationale?: string
          state?: Database["public"]["Enums"]["verification_state"]
          task_id?: string
          verified_against_report_id?: string | null
          verified_at?: string
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_verifications_evidence_snapshot_id_fkey"
            columns: ["evidence_snapshot_id"]
            isOneToOne: false
            referencedRelation: "terminal_performance_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_verifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_verifications_verified_against_report_id_fkey"
            columns: ["verified_against_report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_verifications_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string
          auto_generated: boolean
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          merchant_id: string | null
          planning_report_id: string | null
          priority: number
          queue_rank: number | null
          reason: string
          recommended_talking_points: string | null
          rolled_from_task_id: string | null
          source_agent_recommendation_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_date: string
          task_type: Database["public"]["Enums"]["task_type"]
          terminal_id: string | null
          updated_at: string
        }
        Insert: {
          assigned_to: string
          auto_generated?: boolean
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          merchant_id?: string | null
          planning_report_id?: string | null
          priority?: number
          queue_rank?: number | null
          reason: string
          recommended_talking_points?: string | null
          rolled_from_task_id?: string | null
          source_agent_recommendation_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_date: string
          task_type: Database["public"]["Enums"]["task_type"]
          terminal_id?: string | null
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          auto_generated?: boolean
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          merchant_id?: string | null
          planning_report_id?: string | null
          priority?: number
          queue_rank?: number | null
          reason?: string
          recommended_talking_points?: string | null
          rolled_from_task_id?: string | null
          source_agent_recommendation_id?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          task_date?: string
          task_type?: Database["public"]["Enums"]["task_type"]
          terminal_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_planning_report_id_fkey"
            columns: ["planning_report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_rolled_from_task_id_fkey"
            columns: ["rolled_from_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_agent_recommendation_id_fkey"
            columns: ["source_agent_recommendation_id"]
            isOneToOne: false
            referencedRelation: "agent_recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      terminal_performance_snapshots: {
        Row: {
          created_at: string
          days_since_last_transaction: number
          id: string
          official_target_met: boolean
          official_target_value: number
          payment_value: number
          payment_volume: number
          period_end: string
          period_kind: string
          period_start: string
          report_date: string
          report_id: string
          source_row_id: string | null
          terminal_id: string
          transfer_value: number
          transfer_volume: number
        }
        Insert: {
          created_at?: string
          days_since_last_transaction?: number
          id?: string
          official_target_met?: boolean
          official_target_value?: number
          payment_value?: number
          payment_volume?: number
          period_end: string
          period_kind: string
          period_start: string
          report_date: string
          report_id: string
          source_row_id?: string | null
          terminal_id: string
          transfer_value?: number
          transfer_volume?: number
        }
        Update: {
          created_at?: string
          days_since_last_transaction?: number
          id?: string
          official_target_met?: boolean
          official_target_value?: number
          payment_value?: number
          payment_volume?: number
          period_end?: string
          period_kind?: string
          period_start?: string
          report_date?: string
          report_id?: string
          source_row_id?: string | null
          terminal_id?: string
          transfer_value?: number
          transfer_volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "terminal_performance_snapshots_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "report_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terminal_performance_snapshots_source_row_id_fkey"
            columns: ["source_row_id"]
            isOneToOne: false
            referencedRelation: "report_terminal_rows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terminal_performance_snapshots_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      terminals: {
        Row: {
          assigned_at: string | null
          created_at: string
          id: string
          is_faulty: boolean
          merchant_id: string | null
          serial_number: string | null
          terminal_id: string
          updated_at: string
        }
        Insert: {
          assigned_at?: string | null
          created_at?: string
          id?: string
          is_faulty?: boolean
          merchant_id?: string | null
          serial_number?: string | null
          terminal_id: string
          updated_at?: string
        }
        Update: {
          assigned_at?: string | null
          created_at?: string
          id?: string
          is_faulty?: boolean
          merchant_id?: string | null
          serial_number?: string | null
          terminal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "terminals_merchant_id_fkey"
            columns: ["merchant_id"]
            isOneToOne: false
            referencedRelation: "merchants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acknowledge_meeting_occurrence: {
        Args: { p_occurrence_id: string }
        Returns: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          id: string
          series_id: string
          starts_at: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "meeting_occurrences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      amina_management_mode: { Args: { p_percent: number }; Returns: string }
      amina_message_for: {
        Args: {
          p_individual_percent: number
          p_mode: string
          p_subject_name: string
          p_team_percent: number
        }
        Returns: string
      }
      amina_performance_rating: { Args: { p_percent: number }; Returns: string }
      apply_automation_schedule: { Args: never; Returns: undefined }
      apply_moniepoint_enrichment: {
        Args: {
          p_contacts: Json
          p_dashboard: Json
          p_run_id: string
          p_source_url?: string
          p_token: string
        }
        Returns: Json
      }
      automation_bridge_valid: { Args: { p_token: string }; Returns: boolean }
      automation_browser_session_context: {
        Args: { p_run_id: string; p_token: string }
        Returns: Json
      }
      automation_claim_run: {
        Args: { p_action: string; p_run_id: string; p_token: string }
        Returns: Json
      }
      automation_clear_verification_secret: {
        Args: { p_challenge_id: string }
        Returns: undefined
      }
      automation_complete_run: {
        Args: {
          p_metadata: Json
          p_rows: Json
          p_run_id: string
          p_token: string
          p_upload_nonce: string
        }
        Returns: Json
      }
      automation_consume_verification_challenge: {
        Args: { p_challenge_id: string; p_token: string }
        Returns: Json
      }
      automation_director_cancel_verification_challenge: {
        Args: { p_challenge_id: string; p_reason?: string }
        Returns: Json
      }
      automation_expire_verification_challenges: {
        Args: never
        Returns: number
      }
      automation_fail_run: {
        Args: {
          p_diagnostics?: Json
          p_error_code: string
          p_error_message: string
          p_retryable: boolean
          p_run_id: string
          p_token: string
        }
        Returns: Json
      }
      automation_fail_verification_challenge: {
        Args: {
          p_challenge_id: string
          p_error_message?: string
          p_token: string
        }
        Returns: Json
      }
      automation_mark_dispatched: {
        Args: {
          p_browser_session_id: string
          p_browser_task_id: string
          p_run_id: string
          p_token: string
        }
        Returns: Json
      }
      automation_mark_enrichment_dispatched: {
        Args: {
          p_browser_session_id: string
          p_browser_task_id: string
          p_run_id: string
          p_token: string
        }
        Returns: Json
      }
      automation_mark_pending: {
        Args: { p_diagnostics?: Json; p_run_id: string; p_token: string }
        Returns: Json
      }
      automation_open_verification_challenge: {
        Args: {
          p_browser_session_id?: string
          p_browser_task_id?: string
          p_challenge_type?: string
          p_message?: string
          p_run_id: string
          p_token: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      automation_resolve_verification_auth_state: {
        Args: { p_message: string; p_state: string }
        Returns: undefined
      }
      automation_run_context: {
        Args: { p_run_id: string; p_token: string }
        Returns: Json
      }
      automation_secret_name: { Args: { p_kind: string }; Returns: string }
      automation_secret_status: { Args: never; Returns: Json }
      automation_set_auth_state: {
        Args: { p_message?: string; p_state: string; p_token: string }
        Returns: Json
      }
      automation_set_browser_profile: {
        Args: { p_profile_id: string; p_token: string }
        Returns: Json
      }
      automation_stage_report: {
        Args: {
          p_metadata: Json
          p_rows: Json
          p_run_id: string
          p_token: string
          p_upload_nonce: string
        }
        Returns: Json
      }
      automation_submit_verification_code: {
        Args: { p_challenge_id: string; p_code: string }
        Returns: Json
      }
      automation_take_verification_code: {
        Args: { p_challenge_id: string; p_token: string }
        Returns: Json
      }
      automation_verification_challenge_status: { Args: never; Returns: Json }
      automation_verification_secret_name: {
        Args: { p_challenge_id: string }
        Returns: string
      }
      bootstrap_manual_report: {
        Args: { p_assigned_to?: string; p_report_id: string }
        Returns: Json
      }
      contact_bootstrap_apply_batch: {
        Args: { p_results: Json; p_run_id: string; p_token: string }
        Returns: Json
      }
      contact_bootstrap_batch: {
        Args: { p_limit: number; p_offset: number; p_report_id: string }
        Returns: Json
      }
      contact_bootstrap_claim: {
        Args: { p_action: string; p_run_id: string; p_token: string }
        Returns: Json
      }
      contact_bootstrap_fail_run: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_run_id: string
          p_token: string
        }
        Returns: undefined
      }
      contact_bootstrap_finalize: {
        Args: { p_run_id: string; p_token: string }
        Returns: Json
      }
      contact_bootstrap_mark_dispatched: {
        Args: {
          p_browser_session_id: string
          p_browser_task_id: string
          p_run_id: string
          p_token: string
        }
        Returns: undefined
      }
      contact_bootstrap_mark_pending: {
        Args: { p_diagnostics?: Json; p_run_id: string; p_token: string }
        Returns: undefined
      }
      create_staff_invite: {
        Args: { p_email: string; p_full_name: string }
        Returns: Json
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      dispatch_meeting_notification_worker: { Args: never; Returns: number }
      extend_human_support_queue: {
        Args: {
          p_assistant_id: string
          p_plan_date: string
          p_report_id: string
        }
        Returns: Json
      }
      finalize_moniepoint_enrichment: {
        Args: {
          p_contacts: Json
          p_dashboard: Json
          p_run_id: string
          p_source_url?: string
          p_token: string
        }
        Returns: Json
      }
      ingest_moniepoint_report: {
        Args: { p_metadata: Json; p_rows: Json }
        Returns: Json
      }
      is_director: { Args: never; Returns: boolean }
      is_valid_automation_upload_path: {
        Args: { p_name: string }
        Returns: boolean
      }
      lagos_time_to_cron: { Args: { p_time: string }; Returns: string }
      manual_report_bootstrap_status: { Args: never; Returns: Json }
      materialize_meeting_occurrences: {
        Args: { p_days?: number; p_start_date?: string }
        Returns: number
      }
      meeting_claim_notifications: {
        Args: { p_token: string }
        Returns: {
          body: string
          delivery_id: string
          expo_push_token: string
          meeting_url: string
          occurrence_id: string
          platform: string
          stage: string
          starts_at: string
          title: string
        }[]
      }
      meeting_complete_notification: {
        Args: {
          p_delivery_id: string
          p_disable_device?: boolean
          p_error: string
          p_status: string
          p_ticket_id: string
          p_token: string
        }
        Returns: undefined
      }
      meeting_date_matches: {
        Args: {
          p_date: string
          p_kind: string
          p_ordinals: number[]
          p_weekday: number
        }
        Returns: boolean
      }
      normalize_business_name: { Args: { p_name: string }; Returns: string }
      phase4_terminal_state: {
        Args: {
          p_days_since_last_transaction: number
          p_recovery_in_progress: boolean
          p_target_met: boolean
          p_target_value: number
          p_total_value: number
        }
        Returns: string
      }
      poll_automation_queue: { Args: never; Returns: number }
      queue_automation_run: { Args: { p_trigger_kind?: string }; Returns: Json }
      queue_automation_run_internal: {
        Args: {
          p_force?: boolean
          p_scheduled_for?: string
          p_trigger_kind: string
        }
        Returns: Json
      }
      queue_contact_bootstrap: {
        Args: { p_batch_size?: number; p_report_id?: string }
        Returns: Json
      }
      queue_contact_bootstrap_internal: {
        Args: { p_batch_size?: number; p_report_id: string }
        Returns: Json
      }
      reconcile_ta_tasks_for_report: {
        Args: { p_report_id: string }
        Returns: Json
      }
      refresh_amina_management_scores: {
        Args: { p_assistant_id: string; p_report_id: string }
        Returns: Json
      }
      refresh_bo_attention_queue: {
        Args: { p_plan_date?: string; p_report_id: string }
        Returns: Json
      }
      refresh_meeting_calendar: { Args: never; Returns: Json }
      register_mobile_device: {
        Args: {
          p_app_version: string
          p_device_label: string
          p_exact_alarm_capable: boolean
          p_expo_push_token: string
          p_notifications_granted: boolean
          p_platform: string
        }
        Returns: {
          app_version: string | null
          created_at: string
          device_label: string | null
          enabled: boolean
          exact_alarm_capable: boolean
          expo_push_token: string
          id: string
          last_seen_at: string
          notifications_granted: boolean
          platform: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "mobile_devices"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      review_compensation_recommendation: {
        Args: {
          p_director_note?: string
          p_recommendation_id: string
          p_status: string
        }
        Returns: {
          assistant_id: string
          created_at: string
          director_note: string | null
          evidence: Json
          id: string
          period_end: string
          period_start: string
          rationale: string
          recommendation_percent: number | null
          recommendation_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          scorecard_id: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "compensation_recommendations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rollover_task: {
        Args: { p_reason: string; p_target_date: string; p_task_id: string }
        Returns: {
          assigned_to: string
          auto_generated: boolean
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          merchant_id: string | null
          planning_report_id: string | null
          priority: number
          queue_rank: number | null
          reason: string
          recommended_talking_points: string | null
          rolled_from_task_id: string | null
          source_agent_recommendation_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_date: string
          task_type: Database["public"]["Enums"]["task_type"]
          terminal_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rotate_automation_bridge_token: { Args: never; Returns: Json }
      run_operations_team: {
        Args: {
          p_assistant_id: string
          p_plan_date?: string
          p_report_id?: string
        }
        Returns: Json
      }
      run_readiness_audit: {
        Args: never
        Returns: {
          created_at: string
          id: string
          overall_status: string
          run_by: string | null
          snapshot: Json
        }
        SetofOptions: {
          from: "*"
          to: "readiness_audits"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      run_scheduled_automation: {
        Args: { p_trigger_kind: string }
        Returns: Json
      }
      send_automation_worker: {
        Args: { p_action: string; p_run_id: string }
        Returns: number
      }
      send_contact_bootstrap_poll: {
        Args: { p_run_id: string }
        Returns: number
      }
      set_automation_secret: {
        Args: { p_kind: string; p_value: string }
        Returns: Json
      }
      set_my_task_status: {
        Args: {
          p_status: Database["public"]["Enums"]["task_status"]
          p_task_id: string
        }
        Returns: {
          assigned_to: string
          auto_generated: boolean
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          merchant_id: string | null
          planning_report_id: string | null
          priority: number
          queue_rank: number | null
          reason: string
          recommended_talking_points: string | null
          rolled_from_task_id: string | null
          source_agent_recommendation_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_date: string
          task_type: Database["public"]["Enums"]["task_type"]
          terminal_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_my_task_outcome: {
        Args: {
          p_callback_at?: string
          p_commitment_received?: boolean
          p_expected_amount?: number
          p_expected_by?: string
          p_final_status: Database["public"]["Enums"]["task_status"]
          p_notes?: string
          p_outcome_code: Database["public"]["Enums"]["task_outcome_code"]
          p_postponement_reason?: string
          p_reached_merchant?: boolean
          p_task_id: string
        }
        Returns: {
          assigned_to: string
          auto_generated: boolean
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          merchant_id: string | null
          planning_report_id: string | null
          priority: number
          queue_rank: number | null
          reason: string
          recommended_talking_points: string | null
          rolled_from_task_id: string | null
          source_agent_recommendation_id: string | null
          status: Database["public"]["Enums"]["task_status"]
          task_date: string
          task_type: Database["public"]["Enums"]["task_type"]
          terminal_id: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      system_readiness_snapshot: { Args: never; Returns: Json }
      update_automation_config: {
        Args: {
          p_allowed_domains: string[]
          p_enabled: boolean
          p_evening_refresh_time: string
          p_max_attempts: number
          p_max_steps: number
          p_moniepoint_login_url: string
          p_morning_audit_time: string
          p_morning_refresh_time: string
          p_proxy_country_code: string
          p_retry_backoff_minutes: number
        }
        Returns: {
          allowed_domains: string[]
          auth_state: string
          auth_state_checked_at: string | null
          auth_state_message: string | null
          browser_profile_id: string | null
          created_at: string
          enabled: boolean
          evening_refresh_time: string
          id: boolean
          max_attempts: number
          max_steps: number
          moniepoint_login_url: string | null
          morning_audit_time: string
          morning_refresh_time: string
          poll_interval_minutes: number
          proxy_country_code: string | null
          retry_backoff_minutes: number
          updated_at: string
          updated_by: string | null
          worker_url: string
        }
        SetofOptions: {
          from: "*"
          to: "automation_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_meeting_series: {
        Args: {
          p_enabled: boolean
          p_escalation_after_minutes: number
          p_escalation_repeat_minutes: number
          p_id: string
          p_meeting_url: string
          p_reminder_10_minutes: boolean
          p_reminder_2_minutes: boolean
          p_start_time: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          enabled: boolean
          escalation_after_minutes: number
          escalation_max_hours: number
          escalation_repeat_minutes: number
          id: string
          meeting_url: string | null
          month_ordinals: number[]
          name: string
          recurrence_kind: string
          reminder_10_minutes: boolean
          reminder_2_minutes: boolean
          slug: string
          start_time: string
          timezone: string
          updated_at: string
          updated_by: string | null
          weekday: number
        }
        SetofOptions: {
          from: "*"
          to: "meeting_series"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_agent_performance_scorecard: {
        Args: {
          p_agent_kind: string
          p_assistant_id: string
          p_evidence: Json
          p_individual_score: number
          p_report_id: string
          p_score_date: string
          p_team_percent: number
        }
        Returns: string
      }
      upsert_verified_business_contacts: {
        Args: {
          p_contacts: Json
          p_source_reference?: string
          p_source_report_date: string
        }
        Returns: Json
      }
    }
    Enums: {
      app_role: "director" | "assistant"
      report_terminal_section: "daily" | "rolling_7_day" | "non_transacting"
      task_outcome_code:
        | "reached_commitment"
        | "reached_no_commitment"
        | "callback_requested"
        | "no_answer"
        | "merchant_busy"
        | "terminal_issue"
        | "merchant_declined"
        | "loan_interest"
        | "escalation_required"
        | "loan_disbursed"
      task_status:
        | "assigned"
        | "in_progress"
        | "postponed"
        | "completed"
        | "pending_verification"
        | "verified"
        | "discrepancy"
        | "deferred"
        | "unverifiable"
      task_type: "TA" | "LOAN" | "FOLLOW_UP"
      verification_state:
        | "verified"
        | "discrepancy"
        | "deferred"
        | "unverifiable"
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
      app_role: ["director", "assistant"],
      report_terminal_section: ["daily", "rolling_7_day", "non_transacting"],
      task_outcome_code: [
        "reached_commitment",
        "reached_no_commitment",
        "callback_requested",
        "no_answer",
        "merchant_busy",
        "terminal_issue",
        "merchant_declined",
        "loan_interest",
        "escalation_required",
        "loan_disbursed",
      ],
      task_status: [
        "assigned",
        "in_progress",
        "postponed",
        "completed",
        "pending_verification",
        "verified",
        "discrepancy",
        "deferred",
        "unverifiable",
      ],
      task_type: ["TA", "LOAN", "FOLLOW_UP"],
      verification_state: [
        "verified",
        "discrepancy",
        "deferred",
        "unverifiable",
      ],
    },
  },
} as const
