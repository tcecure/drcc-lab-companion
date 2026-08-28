export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          organization: string;
          phone: string | null;
          account_status: "pending" | "active" | "suspended" | "disabled";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string;
          organization?: string;
          phone?: string | null;
          account_status?: "pending" | "active" | "suspended" | "disabled";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          full_name?: string;
          organization?: string;
          phone?: string | null;
          account_status?: "pending" | "active" | "suspended" | "disabled";
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      roles: {
        Row: {
          id: string;
          role_name: "student" | "approver" | "admin";
          description: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          role_name: Database["public"]["Tables"]["roles"]["Row"]["role_name"];
          description?: string;
          created_at?: string;
        };
        Update: {
          role_name?: Database["public"]["Tables"]["roles"]["Row"]["role_name"];
          description?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role_id: string;
          assigned_by: string | null;
          assigned_at: string;
          expires_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          role_id: string;
          assigned_by?: string | null;
          assigned_at?: string;
          expires_at?: string | null;
        };
        Update: {
          assigned_by?: string | null;
          expires_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_roles_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          previous_value: Json | null;
          new_value: Json | null;
          source_ip: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          action: string;
          entity_type: string;
          entity_id?: string | null;
          previous_value?: Json | null;
          new_value?: Json | null;
          source_ip?: string | null;
          created_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      access_requests: {
        Row: {
          id: string;
          user_id: string;
          request_type:
            | "cmmc_level_1_training"
            | "hands_on_lab"
            | "student_resources"
            | "instructor_access"
            | "customer_delivery_zone"
            | "administrative_access";
          requested_program: string;
          reason: string;
          experience_level:
            "beginner" | "intermediate" | "advanced" | "professional";
          school_or_organization: string;
          availability_notes: string | null;
          status:
            | "draft"
            | "submitted"
            | "under_review"
            | "more_information_required"
            | "approved"
            | "denied"
            | "withdrawn";
          reviewer_id: string | null;
          decision_notes: string | null;
          internal_notes: string | null;
          submitted_at: string | null;
          reviewed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          request_type: Database["public"]["Tables"]["access_requests"]["Row"]["request_type"];
          requested_program: string;
          reason: string;
          experience_level: Database["public"]["Tables"]["access_requests"]["Row"]["experience_level"];
          school_or_organization: string;
          availability_notes?: string | null;
          status?: Database["public"]["Tables"]["access_requests"]["Row"]["status"];
          reviewer_id?: string | null;
          decision_notes?: string | null;
          internal_notes?: string | null;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          request_type?: Database["public"]["Tables"]["access_requests"]["Row"]["request_type"];
          requested_program?: string;
          reason?: string;
          experience_level?: Database["public"]["Tables"]["access_requests"]["Row"]["experience_level"];
          school_or_organization?: string;
          availability_notes?: string | null;
          status?: Database["public"]["Tables"]["access_requests"]["Row"]["status"];
          reviewer_id?: string | null;
          decision_notes?: string | null;
          internal_notes?: string | null;
          submitted_at?: string | null;
          reviewed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "access_requests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "access_requests_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          notification_type: string;
          title: string;
          message: string;
          action_url: string | null;
          read_at: string | null;
          sent_email_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          notification_type: string;
          title: string;
          message: string;
          action_url?: string | null;
          read_at?: string | null;
          sent_email_at?: string | null;
          created_at?: string;
        };
        Update: {
          read_at?: string | null;
          sent_email_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      email_jobs: {
        Row: {
          id: string;
          user_id: string | null;
          template_name: string;
          recipient: string;
          subject: string;
          payload: Json;
          rendered_text: string | null;
          rendered_html: string | null;
          status: "queued" | "sending" | "sent" | "failed" | "cancelled";
          attempts: number;
          error_message: string | null;
          requested_at: string;
          sent_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          template_name: string;
          recipient: string;
          subject: string;
          payload?: Json;
          rendered_text?: string | null;
          rendered_html?: string | null;
          status?: Database["public"]["Tables"]["email_jobs"]["Row"]["status"];
          attempts?: number;
          error_message?: string | null;
          requested_at?: string;
          sent_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string | null;
          template_name?: string;
          recipient?: string;
          subject?: string;
          payload?: Json;
          rendered_text?: string | null;
          rendered_html?: string | null;
          status?: Database["public"]["Tables"]["email_jobs"]["Row"]["status"];
          attempts?: number;
          error_message?: string | null;
          requested_at?: string;
          sent_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "email_jobs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      pre_registration_interests: {
        Row: {
          id: string;
          name: string;
          email: string;
          organization: string;
          interest:
            | "cmmc_level_1_training"
            | "hands_on_lab"
            | "student_resources"
            | "customer_delivery_zone";
          message: string;
          status: "new" | "contacted" | "converted" | "closed";
          created_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          email: string;
          organization: string;
          interest: Database["public"]["Tables"]["pre_registration_interests"]["Row"]["interest"];
          message: string;
          status?: Database["public"]["Tables"]["pre_registration_interests"]["Row"]["status"];
          created_at?: string;
        };
        Update: {
          status?: Database["public"]["Tables"]["pre_registration_interests"]["Row"]["status"];
        };
        Relationships: [];
      };
      resources: {
        Row: {
          id: string;
          title: string;
          slug: string;
          description: string;
          resource_type:
            | "student_guide"
            | "lab_guide"
            | "video"
            | "policy"
            | "checklist"
            | "faq"
            | "troubleshooting"
            | "cmmc_reference"
            | "template"
            | "instructor_resource"
            | "customer_delivery_resource"
            | "announcement";
          program_area: string;
          audience: "public" | "student" | "approver" | "admin";
          required_role: "student" | "approver" | "admin" | null;
          lab_track_id: string | null;
          file_path: string | null;
          external_url: string | null;
          version: string;
          status: "draft" | "in_review" | "published" | "archived";
          effective_date: string | null;
          expiration_date: string | null;
          owner_id: string | null;
          reviewed_at: string | null;
          review_due_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          title: string;
          slug: string;
          description: string;
          resource_type: Database["public"]["Tables"]["resources"]["Row"]["resource_type"];
          program_area: string;
          audience?: Database["public"]["Tables"]["resources"]["Row"]["audience"];
          required_role?: Database["public"]["Tables"]["resources"]["Row"]["required_role"];
          lab_track_id?: string | null;
          file_path?: string | null;
          external_url?: string | null;
          version?: string;
          status?: Database["public"]["Tables"]["resources"]["Row"]["status"];
          effective_date?: string | null;
          expiration_date?: string | null;
          owner_id?: string | null;
          reviewed_at?: string | null;
          review_due_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          slug?: string;
          description?: string;
          resource_type?: Database["public"]["Tables"]["resources"]["Row"]["resource_type"];
          program_area?: string;
          audience?: Database["public"]["Tables"]["resources"]["Row"]["audience"];
          required_role?: Database["public"]["Tables"]["resources"]["Row"]["required_role"];
          lab_track_id?: string | null;
          file_path?: string | null;
          external_url?: string | null;
          version?: string;
          status?: Database["public"]["Tables"]["resources"]["Row"]["status"];
          effective_date?: string | null;
          expiration_date?: string | null;
          owner_id?: string | null;
          reviewed_at?: string | null;
          review_due_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "resources_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      resource_tags: {
        Row: {
          id: string;
          name: string;
          slug: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      resource_tag_links: {
        Row: {
          resource_id: string;
          tag_id: string;
        };
        Insert: {
          resource_id: string;
          tag_id: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "resource_tag_links_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "resources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resource_tag_links_tag_id_fkey";
            columns: ["tag_id"];
            isOneToOne: false;
            referencedRelation: "resource_tags";
            referencedColumns: ["id"];
          },
        ];
      };
      moodle_courses: {
        Row: {
          id: string;
          moodle_course_id: number;
          course_name: string;
          course_short_name: string;
          description: string;
          required_for_lab: boolean;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          moodle_course_id: number;
          course_name: string;
          course_short_name: string;
          description?: string;
          required_for_lab?: boolean;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          moodle_course_id?: number;
          course_name?: string;
          course_short_name?: string;
          description?: string;
          required_for_lab?: boolean;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      moodle_enrollments: {
        Row: {
          id: string;
          user_id: string;
          moodle_user_id: number | null;
          moodle_course_id: number;
          enrollment_status:
            | "pending"
            | "provisioning"
            | "enrolled"
            | "not_started"
            | "in_progress"
            | "completed"
            | "expired"
            | "suspended"
            | "failed";
          progress_percentage: number;
          enrolled_at: string | null;
          completed_at: string | null;
          last_activity_at: string | null;
          last_synced_at: string | null;
          error_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          moodle_user_id?: number | null;
          moodle_course_id: number;
          enrollment_status?: Database["public"]["Tables"]["moodle_enrollments"]["Row"]["enrollment_status"];
          progress_percentage?: number;
          enrolled_at?: string | null;
          completed_at?: string | null;
          last_activity_at?: string | null;
          last_synced_at?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          moodle_user_id?: number | null;
          moodle_course_id?: number;
          enrollment_status?: Database["public"]["Tables"]["moodle_enrollments"]["Row"]["enrollment_status"];
          progress_percentage?: number;
          enrolled_at?: string | null;
          completed_at?: string | null;
          last_activity_at?: string | null;
          last_synced_at?: string | null;
          error_message?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "moodle_enrollments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      integration_jobs: {
        Row: {
          id: string;
          integration_type: "moodle";
          job_type: string;
          user_id: string | null;
          entity_type: string;
          entity_id: string | null;
          payload: Json;
          status: "pending" | "running" | "completed" | "failed" | "retrying";
          external_job_id: string | null;
          attempts: number;
          error_message: string | null;
          requested_at: string;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          integration_type: "moodle";
          job_type: string;
          user_id?: string | null;
          entity_type: string;
          entity_id?: string | null;
          payload?: Json;
          status?: Database["public"]["Tables"]["integration_jobs"]["Row"]["status"];
          external_job_id?: string | null;
          attempts?: number;
          error_message?: string | null;
          requested_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          status?: Database["public"]["Tables"]["integration_jobs"]["Row"]["status"];
          external_job_id?: string | null;
          attempts?: number;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "integration_jobs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      lab_tracks: {
        Row: {
          id: string;
          name: string;
          slug: string;
          description: string;
          capacity: number;
          standard_duration_days: number;
          prerequisite_course_id: number | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          description?: string;
          capacity?: number;
          standard_duration_days?: number;
          prerequisite_course_id?: number | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          name?: string;
          slug?: string;
          description?: string;
          capacity?: number;
          standard_duration_days?: number;
          prerequisite_course_id?: number | null;
          active?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      lab_requests: {
        Row: {
          id: string;
          user_id: string;
          lab_track_id: string;
          preferred_start_date: string | null;
          weekly_availability: string;
          experience_level:
            "beginner" | "intermediate" | "advanced" | "professional";
          accessibility_needs: string | null;
          acceptable_use_accepted_at: string | null;
          connectivity_confirmed_at: string | null;
          eligibility_verified: boolean;
          status:
            | "draft"
            | "submitted"
            | "ineligible"
            | "queued"
            | "on_hold"
            | "withdrawn"
            | "reserved"
            | "provisioning"
            | "active"
            | "completed"
            | "expired"
            | "revoked";
          requested_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          lab_track_id: string;
          preferred_start_date?: string | null;
          weekly_availability: string;
          experience_level: Database["public"]["Tables"]["lab_requests"]["Row"]["experience_level"];
          accessibility_needs?: string | null;
          acceptable_use_accepted_at?: string | null;
          connectivity_confirmed_at?: string | null;
          eligibility_verified?: boolean;
          status?: Database["public"]["Tables"]["lab_requests"]["Row"]["status"];
          requested_at?: string | null;
          updated_at?: string;
        };
        Update: {
          lab_track_id?: string;
          preferred_start_date?: string | null;
          weekly_availability?: string;
          experience_level?: Database["public"]["Tables"]["lab_requests"]["Row"]["experience_level"];
          accessibility_needs?: string | null;
          acceptable_use_accepted_at?: string | null;
          connectivity_confirmed_at?: string | null;
          eligibility_verified?: boolean;
          status?: Database["public"]["Tables"]["lab_requests"]["Row"]["status"];
          requested_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lab_requests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lab_requests_lab_track_id_fkey";
            columns: ["lab_track_id"];
            isOneToOne: false;
            referencedRelation: "lab_tracks";
            referencedColumns: ["id"];
          },
        ];
      };
      lab_queue_entries: {
        Row: {
          id: string;
          lab_request_id: string;
          user_id: string;
          lab_track_id: string;
          priority_group: number;
          queue_status:
            | "waiting"
            | "readiness_requested"
            | "ready"
            | "reservation_offered"
            | "reserved"
            | "provisioning"
            | "active"
            | "paused"
            | "removed"
            | "completed";
          eligibility_date: string;
          request_date: string;
          ready_confirmed_at: string | null;
          confirmation_expires_at: string | null;
          reserved_at: string | null;
          assigned_lab_instance_id: string | null;
          manual_priority: number;
          override_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lab_request_id: string;
          user_id: string;
          lab_track_id: string;
          priority_group?: number;
          queue_status?: Database["public"]["Tables"]["lab_queue_entries"]["Row"]["queue_status"];
          eligibility_date?: string;
          request_date?: string;
          ready_confirmed_at?: string | null;
          confirmation_expires_at?: string | null;
          reserved_at?: string | null;
          assigned_lab_instance_id?: string | null;
          manual_priority?: number;
          override_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          priority_group?: number;
          queue_status?: Database["public"]["Tables"]["lab_queue_entries"]["Row"]["queue_status"];
          ready_confirmed_at?: string | null;
          confirmation_expires_at?: string | null;
          reserved_at?: string | null;
          assigned_lab_instance_id?: string | null;
          manual_priority?: number;
          override_reason?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lab_queue_entries_lab_request_id_fkey";
            columns: ["lab_request_id"];
            isOneToOne: true;
            referencedRelation: "lab_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lab_queue_entries_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lab_queue_entries_lab_track_id_fkey";
            columns: ["lab_track_id"];
            isOneToOne: false;
            referencedRelation: "lab_tracks";
            referencedColumns: ["id"];
          },
        ];
      };
      lab_instances: {
        Row: {
          id: string;
          lab_track_id: string;
          pod_name: string;
          environment_identifier: string;
          status:
            | "available"
            | "reserved"
            | "provisioning"
            | "active"
            | "expiring"
            | "resetting"
            | "maintenance"
            | "disabled";
          assigned_user_id: string | null;
          assigned_at: string | null;
          expires_at: string | null;
          last_reset_at: string | null;
          maintenance_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lab_track_id: string;
          pod_name: string;
          environment_identifier: string;
          status?: Database["public"]["Tables"]["lab_instances"]["Row"]["status"];
          assigned_user_id?: string | null;
          assigned_at?: string | null;
          expires_at?: string | null;
          last_reset_at?: string | null;
          maintenance_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          lab_track_id?: string;
          pod_name?: string;
          environment_identifier?: string;
          status?: Database["public"]["Tables"]["lab_instances"]["Row"]["status"];
          assigned_user_id?: string | null;
          assigned_at?: string | null;
          expires_at?: string | null;
          last_reset_at?: string | null;
          maintenance_notes?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      lab_assignments: {
        Row: {
          id: string;
          user_id: string;
          lab_instance_id: string;
          queue_entry_id: string;
          status:
            | "reservation_offered"
            | "reserved"
            | "declined"
            | "provisioning"
            | "active"
            | "completed"
            | "expired"
            | "revoked";
          reserved_at: string | null;
          starts_at: string | null;
          expires_at: string | null;
          extended_until: string | null;
          completed_at: string | null;
          revoked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          lab_instance_id: string;
          queue_entry_id: string;
          status?: Database["public"]["Tables"]["lab_assignments"]["Row"]["status"];
          reserved_at?: string | null;
          starts_at?: string | null;
          expires_at?: string | null;
          extended_until?: string | null;
          completed_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: Database["public"]["Tables"]["lab_assignments"]["Row"]["status"];
          reserved_at?: string | null;
          starts_at?: string | null;
          expires_at?: string | null;
          extended_until?: string | null;
          completed_at?: string | null;
          revoked_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      lab_capacity_settings: {
        Row: {
          id: string;
          lab_track_id: string | null;
          maximum_active: number;
          maximum_reserved: number;
          confirmation_window_hours: number;
          inactivity_warning_hours: number;
          standard_duration_days: number;
          maximum_extension_days: number;
          automatic_expiration_enabled: boolean;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lab_track_id?: string | null;
          maximum_active?: number;
          maximum_reserved?: number;
          confirmation_window_hours?: number;
          inactivity_warning_hours?: number;
          standard_duration_days?: number;
          maximum_extension_days?: number;
          automatic_expiration_enabled?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Update: {
          lab_track_id?: string | null;
          maximum_active?: number;
          maximum_reserved?: number;
          confirmation_window_hours?: number;
          inactivity_warning_hours?: number;
          standard_duration_days?: number;
          maximum_extension_days?: number;
          automatic_expiration_enabled?: boolean;
          updated_by?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      lab_status_snapshots: {
        Row: {
          id: number;
          checked_at: string;
          source: string;
          nodes: Json;
          resources: Json;
          created_at: string;
        };
        Insert: {
          id?: number;
          checked_at?: string;
          source?: string;
          nodes?: Json;
          resources?: Json;
          created_at?: string;
        };
        Update: {
          checked_at?: string;
          source?: string;
          nodes?: Json;
          resources?: Json;
        };
        Relationships: [];
      };
      provisioning_jobs: {
        Row: {
          id: string;
          user_id: string;
          lab_assignment_id: string | null;
          job_type:
            | "create_student_account"
            | "enable_student_account"
            | "assign_student_to_pod"
            | "provision_guacamole_access"
            | "provision_vpn_access"
            | "seed_lab"
            | "verify_lab"
            | "disable_student_access"
            | "reset_lab"
            | "release_pod"
            | "reset_student_password";
          status:
            | "pending_approval"
            | "approved"
            | "queued"
            | "claimed"
            | "running"
            | "successful"
            | "failed"
            | "cancelled";
          requested_by: string | null;
          approved_by: string | null;
          claimed_by: string | null;
          external_job_id: string | null;
          request_payload: Json;
          result_payload: Json;
          attempts: number;
          error_message: string | null;
          requested_at: string;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          lab_assignment_id?: string | null;
          job_type: Database["public"]["Tables"]["provisioning_jobs"]["Row"]["job_type"];
          status?: Database["public"]["Tables"]["provisioning_jobs"]["Row"]["status"];
          requested_by?: string | null;
          approved_by?: string | null;
          claimed_by?: string | null;
          external_job_id?: string | null;
          request_payload?: Json;
          result_payload?: Json;
          attempts?: number;
          error_message?: string | null;
          requested_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          lab_assignment_id?: string | null;
          status?: Database["public"]["Tables"]["provisioning_jobs"]["Row"]["status"];
          requested_by?: string | null;
          approved_by?: string | null;
          claimed_by?: string | null;
          external_job_id?: string | null;
          request_payload?: Json;
          result_payload?: Json;
          attempts?: number;
          error_message?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "provisioning_jobs_lab_assignment_id_fkey";
            columns: ["lab_assignment_id"];
            isOneToOne: false;
            referencedRelation: "lab_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "provisioning_jobs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      provisioning_job_events: {
        Row: {
          id: string;
          provisioning_job_id: string;
          bridge_id: string | null;
          from_status: string | null;
          to_status: string;
          message: string | null;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          provisioning_job_id: string;
          bridge_id?: string | null;
          from_status?: string | null;
          to_status: string;
          message?: string | null;
          payload?: Json;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "provisioning_job_events_provisioning_job_id_fkey";
            columns: ["provisioning_job_id"];
            isOneToOne: false;
            referencedRelation: "provisioning_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      lab_verifications: {
        Row: {
          id: string;
          lab_assignment_id: string;
          user_id: string;
          verification_type: "check_progress" | "verify_lab";
          status:
            | "not_started"
            | "queued"
            | "running"
            | "passed"
            | "failed"
            | "error";
          score: number | null;
          results: Json;
          external_job_id: string | null;
          requested_at: string;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          lab_assignment_id: string;
          user_id: string;
          verification_type?: Database["public"]["Tables"]["lab_verifications"]["Row"]["verification_type"];
          status?: Database["public"]["Tables"]["lab_verifications"]["Row"]["status"];
          score?: number | null;
          results?: Json;
          external_job_id?: string | null;
          requested_at?: string;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          verification_type?: Database["public"]["Tables"]["lab_verifications"]["Row"]["verification_type"];
          status?: Database["public"]["Tables"]["lab_verifications"]["Row"]["status"];
          score?: number | null;
          results?: Json;
          external_job_id?: string | null;
          completed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lab_verifications_lab_assignment_id_fkey";
            columns: ["lab_assignment_id"];
            isOneToOne: false;
            referencedRelation: "lab_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lab_verifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      support_requests: {
        Row: {
          id: string;
          user_id: string | null;
          lab_assignment_id: string | null;
          category:
            | "account_access"
            | "connectivity"
            | "guacamole"
            | "vpn"
            | "lab_guide"
            | "verification"
            | "course_platform"
            | "other";
          subject: string;
          description: string;
          priority: "low" | "normal" | "high" | "urgent";
          status:
            | "open"
            | "in_progress"
            | "waiting_on_student"
            | "resolved"
            | "closed";
          assigned_to: string | null;
          requester_name: string | null;
          requester_email: string | null;
          lab_family: "AC" | "IA" | "SI" | "SC" | "MP" | "PE" | null;
          pod_name: string | null;
          last_message_at: string;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          lab_assignment_id?: string | null;
          category: Database["public"]["Tables"]["support_requests"]["Row"]["category"];
          subject: string;
          description: string;
          priority?: Database["public"]["Tables"]["support_requests"]["Row"]["priority"];
          status?: Database["public"]["Tables"]["support_requests"]["Row"]["status"];
          assigned_to?: string | null;
          requester_name?: string | null;
          requester_email?: string | null;
          lab_family?: Database["public"]["Tables"]["support_requests"]["Row"]["lab_family"];
          pod_name?: string | null;
          last_message_at?: string;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          lab_assignment_id?: string | null;
          category?: Database["public"]["Tables"]["support_requests"]["Row"]["category"];
          subject?: string;
          description?: string;
          priority?: Database["public"]["Tables"]["support_requests"]["Row"]["priority"];
          status?: Database["public"]["Tables"]["support_requests"]["Row"]["status"];
          assigned_to?: string | null;
          requester_name?: string | null;
          requester_email?: string | null;
          lab_family?: Database["public"]["Tables"]["support_requests"]["Row"]["lab_family"];
          pod_name?: string | null;
          last_message_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "support_requests_lab_assignment_id_fkey";
            columns: ["lab_assignment_id"];
            isOneToOne: false;
            referencedRelation: "lab_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "support_requests_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      support_messages: {
        Row: {
          id: string;
          support_request_id: string;
          author_user_id: string | null;
          author_role: "requester" | "staff" | "system";
          body: string;
          is_internal: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          support_request_id: string;
          author_user_id?: string | null;
          author_role: Database["public"]["Tables"]["support_messages"]["Row"]["author_role"];
          body: string;
          is_internal?: boolean;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "support_messages_support_request_id_fkey";
            columns: ["support_request_id"];
            isOneToOne: false;
            referencedRelation: "support_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      support_attachments: {
        Row: {
          id: string;
          support_message_id: string;
          uploaded_by: string | null;
          storage_path: string;
          file_name: string;
          mime_type: "image/jpeg" | "image/png" | "image/webp";
          size_bytes: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          support_message_id: string;
          uploaded_by?: string | null;
          storage_path: string;
          file_name: string;
          mime_type: Database["public"]["Tables"]["support_attachments"]["Row"]["mime_type"];
          size_bytes: number;
          created_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "support_attachments_support_message_id_fkey";
            columns: ["support_message_id"];
            isOneToOne: false;
            referencedRelation: "support_messages";
            referencedColumns: ["id"];
          },
        ];
      };
      student_cohort_assignments: {
        Row: {
          id: string;
          user_id: string;
          source: string;
          lab_username: string | null;
          pod_name: string | null;
          cohort_number: number;
          seat_number: number | null;
          access_starts_at: string;
          access_ends_at: string;
          notification_send_at: string;
          status: "queued" | "notified" | "active" | "completed" | "cancelled";
          credential_status: string;
          credential_version: number;
          credential_ready_at: string | null;
          last_progress_synced_at: string | null;
          notified_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source?: string;
          lab_username: string | null;
          pod_name: string | null;
          cohort_number: number;
          seat_number: number | null;
          access_starts_at: string;
          access_ends_at: string;
          notification_send_at: string;
          status?: Database["public"]["Tables"]["student_cohort_assignments"]["Row"]["status"];
          credential_status?: string;
          credential_version?: number;
          credential_ready_at?: string | null;
          last_progress_synced_at?: string | null;
          notified_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          source?: string;
          lab_username?: string | null;
          pod_name?: string | null;
          cohort_number?: number;
          seat_number?: number | null;
          access_starts_at?: string;
          access_ends_at?: string;
          notification_send_at?: string;
          status?: Database["public"]["Tables"]["student_cohort_assignments"]["Row"]["status"];
          credential_status?: string;
          credential_version?: number;
          credential_ready_at?: string | null;
          last_progress_synced_at?: string | null;
          notified_at?: string | null;
          created_by?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_cohort_assignments_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_engagements: {
        Row: {
          id: string;
          engagement_name: string;
          customer_display_name: string;
          engagement_type:
            | "readiness_support"
            | "assessment_prep"
            | "vulnerability_review"
            | "secure_collaboration"
            | "other";
          status: "planning" | "active" | "paused" | "completed" | "archived";
          start_date: string | null;
          end_date: string | null;
          owner_id: string | null;
          internal_workspace_url: string | null;
          classification_notice: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          engagement_name: string;
          customer_display_name: string;
          engagement_type: Database["public"]["Tables"]["customer_engagements"]["Row"]["engagement_type"];
          status?: Database["public"]["Tables"]["customer_engagements"]["Row"]["status"];
          start_date?: string | null;
          end_date?: string | null;
          owner_id?: string | null;
          internal_workspace_url?: string | null;
          classification_notice?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          engagement_name?: string;
          customer_display_name?: string;
          engagement_type?: Database["public"]["Tables"]["customer_engagements"]["Row"]["engagement_type"];
          status?: Database["public"]["Tables"]["customer_engagements"]["Row"]["status"];
          start_date?: string | null;
          end_date?: string | null;
          owner_id?: string | null;
          internal_workspace_url?: string | null;
          classification_notice?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      customer_engagement_members: {
        Row: {
          id: string;
          engagement_id: string;
          user_id: string;
          engagement_role: "viewer" | "analyst" | "lead" | "reviewer" | "owner";
          approved_by: string | null;
          access_starts_at: string;
          access_expires_at: string | null;
          last_reviewed_at: string | null;
          status: "active" | "suspended" | "expired" | "revoked";
          created_at: string;
        };
        Insert: {
          id?: string;
          engagement_id: string;
          user_id: string;
          engagement_role: Database["public"]["Tables"]["customer_engagement_members"]["Row"]["engagement_role"];
          approved_by?: string | null;
          access_starts_at?: string;
          access_expires_at?: string | null;
          last_reviewed_at?: string | null;
          status?: Database["public"]["Tables"]["customer_engagement_members"]["Row"]["status"];
          created_at?: string;
        };
        Update: {
          engagement_role?: Database["public"]["Tables"]["customer_engagement_members"]["Row"]["engagement_role"];
          approved_by?: string | null;
          access_starts_at?: string;
          access_expires_at?: string | null;
          last_reviewed_at?: string | null;
          status?: Database["public"]["Tables"]["customer_engagement_members"]["Row"]["status"];
        };
        Relationships: [
          {
            foreignKeyName: "customer_engagement_members_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "customer_engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_engagement_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_access_reviews: {
        Row: {
          id: string;
          engagement_id: string;
          user_id: string;
          reviewer_id: string | null;
          review_status: "approved" | "revoked" | "needs_review";
          review_notes: string | null;
          reviewed_at: string;
        };
        Insert: {
          id?: string;
          engagement_id: string;
          user_id: string;
          reviewer_id?: string | null;
          review_status: Database["public"]["Tables"]["customer_access_reviews"]["Row"]["review_status"];
          review_notes?: string | null;
          reviewed_at?: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "customer_access_reviews_engagement_id_fkey";
            columns: ["engagement_id"];
            isOneToOne: false;
            referencedRelation: "customer_engagements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_access_reviews_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_runs: {
        Row: {
          id: string;
          support_request_id: string;
          requested_by: string;
          status:
            | "queued"
            | "running"
            | "paused"
            | "awaiting_approval"
            | "succeeded"
            | "failed"
            | "cancelled"
            | "timed_out"
            | "budget_exhausted"
            | "rate_limited"
            | "provider_error";
          title: string;
          sanitized_context: Json;
          agent_conversation_id: string | null;
          model: string;
          provider: string;
          token_budget: number;
          wallclock_limit_seconds: number;
          failure_reason: string | null;
          findings: string | null;
          resolution: string | null;
          started_at: string | null;
          ended_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          support_request_id: string;
          requested_by: string;
          status?: Database["public"]["Tables"]["ai_runs"]["Row"]["status"];
          title: string;
          sanitized_context?: Json;
          agent_conversation_id?: string | null;
          model: string;
          provider: string;
          token_budget: number;
          wallclock_limit_seconds: number;
          failure_reason?: string | null;
          findings?: string | null;
          resolution?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
        };
        Update: {
          status?: Database["public"]["Tables"]["ai_runs"]["Row"]["status"];
          agent_conversation_id?: string | null;
          failure_reason?: string | null;
          findings?: string | null;
          resolution?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_runs_support_request_id_fkey";
            columns: ["support_request_id"];
            isOneToOne: false;
            referencedRelation: "support_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_runs_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_run_events: {
        Row: {
          id: number;
          run_id: string;
          seq: number;
          kind: string;
          payload: Json;
          created_at: string;
        };
        Insert: {
          run_id: string;
          seq: number;
          kind: string;
          payload?: Json;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "ai_run_events_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_messages: {
        Row: {
          id: number;
          run_id: string;
          role: "system" | "user" | "assistant" | "tool";
          content: string;
          created_at: string;
        };
        Insert: {
          run_id: string;
          role: Database["public"]["Tables"]["ai_messages"]["Row"]["role"];
          content: string;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "ai_messages_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_tool_actions: {
        Row: {
          id: number;
          run_id: string;
          tool: string;
          target: string | null;
          is_write: boolean;
          outcome: "allowed" | "denied" | "failed" | "succeeded";
          request: Json;
          response_summary: string | null;
          created_at: string;
        };
        Insert: {
          run_id: string;
          tool: string;
          target?: string | null;
          is_write?: boolean;
          outcome: Database["public"]["Tables"]["ai_tool_actions"]["Row"]["outcome"];
          request?: Json;
          response_summary?: string | null;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "ai_tool_actions_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_approval_requests: {
        Row: {
          id: string;
          run_id: string;
          requested_by: string;
          action_kind: string;
          action_payload: Json;
          status: "pending" | "approved" | "rejected" | "expired";
          decided_by: string | null;
          decided_at: string | null;
          decision_note: string | null;
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          run_id: string;
          requested_by: string;
          action_kind: string;
          action_payload?: Json;
          status?: Database["public"]["Tables"]["ai_approval_requests"]["Row"]["status"];
          expires_at?: string;
        };
        Update: {
          status?: Database["public"]["Tables"]["ai_approval_requests"]["Row"]["status"];
          decided_by?: string | null;
          decided_at?: string | null;
          decision_note?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_approval_requests_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_model_usage: {
        Row: {
          id: number;
          run_id: string;
          provider: string;
          model: string;
          prompt_tokens: number;
          completion_tokens: number;
          cost_usd: number;
          created_at: string;
        };
        Insert: {
          run_id: string;
          provider: string;
          model: string;
          prompt_tokens?: number;
          completion_tokens?: number;
          cost_usd?: number;
        };
        Update: never;
        Relationships: [
          {
            foreignKeyName: "ai_model_usage_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "ai_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_integration_health: {
        Row: {
          integration: string;
          status: "ok" | "degraded" | "down" | "unconfigured";
          detail: string | null;
          checked_at: string;
        };
        Insert: {
          integration: string;
          status: Database["public"]["Tables"]["ai_integration_health"]["Row"]["status"];
          detail?: string | null;
          checked_at?: string;
        };
        Update: {
          status?: Database["public"]["Tables"]["ai_integration_health"]["Row"]["status"];
          detail?: string | null;
          checked_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_user_has_role: {
        Args: { required_role: string };
        Returns: boolean;
      };
      current_user_has_any_role: {
        Args: { required_roles: string[] };
        Returns: boolean;
      };
      user_completed_required_moodle_training: {
        Args: { check_user_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
