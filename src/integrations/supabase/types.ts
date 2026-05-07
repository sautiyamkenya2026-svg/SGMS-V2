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
      ai_keys: {
        Row: {
          active: boolean
          api_key: string
          created_at: string
          failure_count: number
          id: string
          label: string
          last_used_at: string | null
          provider: string
        }
        Insert: {
          active?: boolean
          api_key: string
          created_at?: string
          failure_count?: number
          id?: string
          label: string
          last_used_at?: string | null
          provider?: string
        }
        Update: {
          active?: boolean
          api_key?: string
          created_at?: string
          failure_count?: number
          id?: string
          label?: string
          last_used_at?: string | null
          provider?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          address: string | null
          contact_method: string | null
          created_at: string
          email: string | null
          id: string
          marketing_consent: boolean
          name: string
          notes: string | null
          occupation: string | null
          phone_alt: string | null
          phone_primary: string | null
          referred_by: string | null
          source: string | null
          source_detail: string | null
          updated_at: string
          value_rating: string | null
        }
        Insert: {
          address?: string | null
          contact_method?: string | null
          created_at?: string
          email?: string | null
          id?: string
          marketing_consent?: boolean
          name: string
          notes?: string | null
          occupation?: string | null
          phone_alt?: string | null
          phone_primary?: string | null
          referred_by?: string | null
          source?: string | null
          source_detail?: string | null
          updated_at?: string
          value_rating?: string | null
        }
        Update: {
          address?: string | null
          contact_method?: string | null
          created_at?: string
          email?: string | null
          id?: string
          marketing_consent?: boolean
          name?: string
          notes?: string | null
          occupation?: string | null
          phone_alt?: string | null
          phone_primary?: string | null
          referred_by?: string | null
          source?: string | null
          source_detail?: string | null
          updated_at?: string
          value_rating?: string | null
        }
        Relationships: []
      }
      client_portal_accounts: {
        Row: {
          client_id: string | null
          created_at: string
          phone: string | null
          plate: string
          updated_at: string
          user_id: string
          vehicle_id: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          phone?: string | null
          plate: string
          updated_at?: string
          user_id: string
          vehicle_id?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          phone?: string | null
          plate?: string
          updated_at?: string
          user_id?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_portal_accounts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_portal_accounts_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_pass_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          arrived_early_at: string | null
          created_at: string
          destination: string | null
          expected_return: string | null
          id: string
          is_final_release: boolean
          job_id: string | null
          late_notified_at: string | null
          notes: string | null
          plate: string | null
          reason: string
          reason_detail: string | null
          released_at: string | null
          released_by: string | null
          requested_by: string | null
          returned_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          arrived_early_at?: string | null
          created_at?: string
          destination?: string | null
          expected_return?: string | null
          id?: string
          is_final_release?: boolean
          job_id?: string | null
          late_notified_at?: string | null
          notes?: string | null
          plate?: string | null
          reason: string
          reason_detail?: string | null
          released_at?: string | null
          released_by?: string | null
          requested_by?: string | null
          returned_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          arrived_early_at?: string | null
          created_at?: string
          destination?: string | null
          expected_return?: string | null
          id?: string
          is_final_release?: boolean
          job_id?: string | null
          late_notified_at?: string | null
          notes?: string | null
          plate?: string | null
          reason?: string
          reason_detail?: string | null
          released_at?: string | null
          released_by?: string | null
          requested_by?: string | null
          returned_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate_pass_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      gate_passes: {
        Row: {
          id: string
          issued_at: string
          issued_by: string | null
          job_id: string
          message: string | null
          notes: string | null
          pass_no: string
        }
        Insert: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          job_id: string
          message?: string | null
          notes?: string | null
          pass_no?: string
        }
        Update: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          job_id?: string
          message?: string | null
          notes?: string | null
          pass_no?: string
        }
        Relationships: [
          {
            foreignKeyName: "gate_passes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_findings: {
        Row: {
          action_required: string | null
          assigned_technician: string | null
          category: string | null
          client_authorized: boolean
          created_at: string
          estimated_cost: number | null
          id: string
          inspection_id: string
          last_service: string | null
          next_due: string | null
          note: string | null
          part: string
          photo_url: string | null
          severity: string | null
          status: string
          subpart: string | null
          system: string
          time_estimate_minutes: number | null
        }
        Insert: {
          action_required?: string | null
          assigned_technician?: string | null
          category?: string | null
          client_authorized?: boolean
          created_at?: string
          estimated_cost?: number | null
          id?: string
          inspection_id: string
          last_service?: string | null
          next_due?: string | null
          note?: string | null
          part: string
          photo_url?: string | null
          severity?: string | null
          status?: string
          subpart?: string | null
          system: string
          time_estimate_minutes?: number | null
        }
        Update: {
          action_required?: string | null
          assigned_technician?: string | null
          category?: string | null
          client_authorized?: boolean
          created_at?: string
          estimated_cost?: number | null
          id?: string
          inspection_id?: string
          last_service?: string | null
          next_due?: string | null
          note?: string | null
          part?: string
          photo_url?: string | null
          severity?: string | null
          status?: string
          subpart?: string | null
          system?: string
          time_estimate_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_findings_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          accessories: string[] | null
          client_id: string | null
          created_at: string
          created_by: string | null
          customer_complaint: string | null
          fuel_level: string | null
          id: string
          job_id: string | null
          job_ref: string
          manual_done: boolean
          mileage_in: number | null
          obd_done: boolean
          plate: string | null
          status: string
          technician_diagnosis: string | null
          updated_at: string
          valuables_declared: string | null
          vehicle: string | null
          vehicle_id: string | null
        }
        Insert: {
          accessories?: string[] | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_complaint?: string | null
          fuel_level?: string | null
          id?: string
          job_id?: string | null
          job_ref: string
          manual_done?: boolean
          mileage_in?: number | null
          obd_done?: boolean
          plate?: string | null
          status?: string
          technician_diagnosis?: string | null
          updated_at?: string
          valuables_declared?: string | null
          vehicle?: string | null
          vehicle_id?: string | null
        }
        Update: {
          accessories?: string[] | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          customer_complaint?: string | null
          fuel_level?: string | null
          id?: string
          job_id?: string | null
          job_ref?: string
          manual_done?: boolean
          mileage_in?: number | null
          obd_done?: boolean
          plate?: string | null
          status?: string
          technician_diagnosis?: string | null
          updated_at?: string
          valuables_declared?: string | null
          vehicle?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspections_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          created_at: string
          description: string
          id: string
          invoice_id: string
          kind: string
          qty: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          kind?: string
          qty?: number
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          kind?: string
          qty?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          amount_paid: number
          client_id: string | null
          created_at: string
          customer_phone: string | null
          date: string
          discount: number
          discount_by: string | null
          doc_type: string
          id: string
          is_payment_bypassed: boolean
          invoice_book_no: string | null
          invoice_no: string | null
          job_id: string | null
          notes: string | null
          parts_source: string | null
          payer_name: string | null
          payer_type: string
          payment_bypass_authorized_by: string | null
          payment_bypass_reason: string | null
          payment_mode: string
          payment_reference: string | null
          plate: string | null
          service_type: string | null
          status: string
          technicians: string | null
          time_in: string | null
          time_out: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          amount?: number
          amount_paid?: number
          client_id?: string | null
          created_at?: string
          customer_phone?: string | null
          date?: string
          discount?: number
          discount_by?: string | null
          doc_type?: string
          id?: string
          is_payment_bypassed?: boolean
          invoice_book_no?: string | null
          invoice_no?: string | null
          job_id?: string | null
          notes?: string | null
          parts_source?: string | null
          payer_name?: string | null
          payer_type?: string
          payment_bypass_authorized_by?: string | null
          payment_bypass_reason?: string | null
          payment_mode?: string
          payment_reference?: string | null
          plate?: string | null
          service_type?: string | null
          status?: string
          technicians?: string | null
          time_in?: string | null
          time_out?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          amount?: number
          amount_paid?: number
          client_id?: string | null
          created_at?: string
          customer_phone?: string | null
          date?: string
          discount?: number
          discount_by?: string | null
          doc_type?: string
          id?: string
          is_payment_bypassed?: boolean
          invoice_book_no?: string | null
          invoice_no?: string | null
          job_id?: string | null
          notes?: string | null
          parts_source?: string | null
          payer_name?: string | null
          payer_type?: string
          payment_bypass_authorized_by?: string | null
          payment_bypass_reason?: string | null
          payment_mode?: string
          payment_reference?: string | null
          plate?: string | null
          service_type?: string | null
          status?: string
          technicians?: string | null
          time_in?: string | null
          time_out?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_line_items: {
        Row: {
          created_at: string
          description: string
          id: string
          job_id: string
          kind: string
          part_id: string | null
          part_request_id: string | null
          position: number
          qty: number
          source: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          job_id: string
          kind?: string
          part_id?: string | null
          part_request_id?: string | null
          position?: number
          qty?: number
          source?: string
          unit_price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          job_id?: string
          kind?: string
          part_id?: string | null
          part_request_id?: string | null
          position?: number
          qty?: number
          source?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      job_mechanics: {
        Row: {
          created_at: string
          id: string
          job_id: string
          mechanic_id: string
          role_on_job: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          mechanic_id: string
          role_on_job?: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          mechanic_id?: string
          role_on_job?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          ai_diagnostic_summary: string | null
          assigned_mechanic_id: string | null
          client_approved_at: string | null
          client_feedback_token: string | null
          client_id: string | null
          client_rating: number | null
          closed_at: string | null
          complaint: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_feedback: string | null
          customer_name: string | null
          customer_phone: string | null
          diagnosis_approval_code: string | null
          diagnosis_approval_comment: string | null
          diagnosis_approval_rating: number | null
          diagnosis_approved_at: string | null
          diagnosis_sent_at: string | null
          deposit_paid: number
          deposit_required: number
          discount_amount: number
          discount_reason: string | null
          estimate: number
          feedback_rating: number | null
          financial_summary: string | null
          fuel_type: string | null
          gate_pass_issued: boolean
          has_insurance: boolean
          id: string
          insurance_company: string | null
          insurance_policy_no: string | null
          invoice_amount: number
          job_no: string
          lead_source: string | null
          lead_source_detail: string | null
          mechanic: string | null
          notes: string | null
          paid_at: string | null
          paint_color_code: string | null
          payer_name: string | null
          payer_type: string
          payment_bypass: boolean
          payment_bypass_authorized_by: string | null
          payment_bypass_reason: string | null
          parts_fit_approved_at: string | null
          parts_fit_approved_by: string | null
          plate: string
          previous_job_id: string | null
          quotation_amount: number
          receipt_amount: number
          recommended_parts: Json
          reported_problem: string | null
          return_visit_notes: string | null
          return_visit_type: string | null
          requires_internal_parts_approval: boolean
          service_type: string | null
          service_types: string[]
          started_at: string
          status: string
          updated_at: string
          vehicle_id: string | null
          vehicle_color: string | null
          vehicle_label: string | null
          work_performed: string | null
        }
        Insert: {
          ai_diagnostic_summary?: string | null
          assigned_mechanic_id?: string | null
          client_approved_at?: string | null
          client_feedback_token?: string | null
          client_id?: string | null
          client_rating?: number | null
          closed_at?: string | null
          complaint?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_feedback?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          diagnosis_approval_code?: string | null
          diagnosis_approval_comment?: string | null
          diagnosis_approval_rating?: number | null
          diagnosis_approved_at?: string | null
          diagnosis_sent_at?: string | null
          deposit_paid?: number
          deposit_required?: number
          discount_amount?: number
          discount_reason?: string | null
          estimate?: number
          feedback_rating?: number | null
          financial_summary?: string | null
          fuel_type?: string | null
          gate_pass_issued?: boolean
          has_insurance?: boolean
          id?: string
          insurance_company?: string | null
          insurance_policy_no?: string | null
          invoice_amount?: number
          job_no?: string
          lead_source?: string | null
          lead_source_detail?: string | null
          mechanic?: string | null
          notes?: string | null
          paid_at?: string | null
          paint_color_code?: string | null
          payer_name?: string | null
          payer_type?: string
          payment_bypass?: boolean
          payment_bypass_authorized_by?: string | null
          payment_bypass_reason?: string | null
          parts_fit_approved_at?: string | null
          parts_fit_approved_by?: string | null
          plate: string
          previous_job_id?: string | null
          quotation_amount?: number
          receipt_amount?: number
          recommended_parts?: Json
          reported_problem?: string | null
          return_visit_notes?: string | null
          return_visit_type?: string | null
          requires_internal_parts_approval?: boolean
          service_type?: string | null
          service_types?: string[]
          started_at?: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_color?: string | null
          vehicle_label?: string | null
          work_performed?: string | null
        }
        Update: {
          ai_diagnostic_summary?: string | null
          assigned_mechanic_id?: string | null
          client_approved_at?: string | null
          client_feedback_token?: string | null
          client_id?: string | null
          client_rating?: number | null
          closed_at?: string | null
          complaint?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_feedback?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          diagnosis_approval_code?: string | null
          diagnosis_approval_comment?: string | null
          diagnosis_approval_rating?: number | null
          diagnosis_approved_at?: string | null
          diagnosis_sent_at?: string | null
          deposit_paid?: number
          deposit_required?: number
          discount_amount?: number
          discount_reason?: string | null
          estimate?: number
          feedback_rating?: number | null
          financial_summary?: string | null
          fuel_type?: string | null
          gate_pass_issued?: boolean
          has_insurance?: boolean
          id?: string
          insurance_company?: string | null
          insurance_policy_no?: string | null
          invoice_amount?: number
          job_no?: string
          lead_source?: string | null
          lead_source_detail?: string | null
          mechanic?: string | null
          notes?: string | null
          paid_at?: string | null
          paint_color_code?: string | null
          payer_name?: string | null
          payer_type?: string
          payment_bypass?: boolean
          payment_bypass_authorized_by?: string | null
          payment_bypass_reason?: string | null
          parts_fit_approved_at?: string | null
          parts_fit_approved_by?: string | null
          plate?: string
          previous_job_id?: string | null
          quotation_amount?: number
          receipt_amount?: number
          recommended_parts?: Json
          reported_problem?: string | null
          return_visit_notes?: string | null
          return_visit_type?: string | null
          requires_internal_parts_approval?: boolean
          service_type?: string | null
          service_types?: string[]
          started_at?: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_color?: string | null
          vehicle_label?: string | null
          work_performed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_previous_job_id_fkey"
            columns: ["previous_job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          address: string | null
          created_at: string
          id: string
          is_supplier: boolean
          kind: string
          name: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          is_supplier?: boolean
          kind: string
          name: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          is_supplier?: boolean
          kind?: string
          name?: string
        }
        Relationships: []
      }
      mechanics: {
        Row: {
          active: boolean
          created_at: string
          id: string
          level: string
          name: string
          other_specialisations: string | null
          phone: string | null
          roles: string[]
          specialties: string[]
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          level?: string
          name: string
          other_specialisations?: string | null
          phone?: string | null
          roles?: string[]
          specialties?: string[]
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          level?: string
          name?: string
          other_specialisations?: string | null
          phone?: string | null
          roles?: string[]
          specialties?: string[]
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      obd_codes: {
        Row: {
          code: string
          id: string
          meaning: string
          scan_id: string
          severity: string
          system: string | null
        }
        Insert: {
          code: string
          id?: string
          meaning: string
          scan_id: string
          severity?: string
          system?: string | null
        }
        Update: {
          code?: string
          id?: string
          meaning?: string
          scan_id?: string
          severity?: string
          system?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "obd_codes_scan_id_fkey"
            columns: ["scan_id"]
            isOneToOne: false
            referencedRelation: "obd_scans"
            referencedColumns: ["id"]
          },
        ]
      }
      obd_scans: {
        Row: {
          id: string
          inspection_id: string
          scanned_at: string
          source: string
        }
        Insert: {
          id?: string
          inspection_id: string
          scanned_at?: string
          source?: string
        }
        Update: {
          id?: string
          inspection_id?: string
          scanned_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "obd_scans_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      part_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          delivered_at: string | null
          estimated_unit_price: number
          id: string
          in_delivery_at: string | null
          internal_approved_at: string | null
          internal_approved_by: string | null
          is_major: boolean
          item_name: string
          job_id: string | null
          kind: string
          mechanic_name: string | null
          notes: string | null
          ordered_at: string | null
          qty: number
          requested_by: string | null
          return_note: string | null
          returned_at: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          delivered_at?: string | null
          estimated_unit_price?: number
          id?: string
          in_delivery_at?: string | null
          internal_approved_at?: string | null
          internal_approved_by?: string | null
          is_major?: boolean
          item_name: string
          job_id?: string | null
          kind?: string
          mechanic_name?: string | null
          notes?: string | null
          ordered_at?: string | null
          qty?: number
          requested_by?: string | null
          return_note?: string | null
          returned_at?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          delivered_at?: string | null
          estimated_unit_price?: number
          id?: string
          in_delivery_at?: string | null
          internal_approved_at?: string | null
          internal_approved_by?: string | null
          is_major?: boolean
          item_name?: string
          job_id?: string | null
          kind?: string
          mechanic_name?: string | null
          notes?: string | null
          ordered_at?: string | null
          qty?: number
          requested_by?: string | null
          return_note?: string | null
          returned_at?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "part_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      part_stock: {
        Row: {
          id: string
          location_id: string
          part_id: string
          qty: number
          updated_at: string
        }
        Insert: {
          id?: string
          location_id: string
          part_id: string
          qty?: number
          updated_at?: string
        }
        Update: {
          id?: string
          location_id?: string
          part_id?: string
          qty?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "part_stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "part_stock_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      parts: {
        Row: {
          category: string | null
          created_at: string
          id: string
          min_stock: number
          name: string
          sku: string
          unit_cost: number
          unit_price: number
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          min_stock?: number
          name: string
          sku: string
          unit_cost?: number
          unit_price?: number
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          min_stock?: number
          name?: string
          sku?: string
          unit_cost?: number
          unit_price?: number
        }
        Relationships: []
      }
      petty_cash_entries: {
        Row: {
          amount: number
          contact: string | null
          created_at: string
          created_by: string | null
          date: string
          details: string | null
          id: string
          job_id: string | null
          payee: string | null
          payment_mode: string
          payment_reference: string | null
          transaction_time: string | null
          transaction_cost: number
          type: string
        }
        Insert: {
          amount?: number
          contact?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          details?: string | null
          id?: string
          job_id?: string | null
          payee?: string | null
          payment_mode?: string
          payment_reference?: string | null
          transaction_time?: string | null
          transaction_cost?: number
          type?: string
        }
        Update: {
          amount?: number
          contact?: string | null
          created_at?: string
          created_by?: string | null
          date?: string
          details?: string | null
          id?: string
          job_id?: string | null
          payee?: string | null
          payment_mode?: string
          payment_reference?: string | null
          transaction_time?: string | null
          transaction_cost?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "petty_cash_entries_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          avatar_url: string | null
          biometric_credential_id: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          last_seen_at: string | null
          national_id: string | null
          notes: string | null
          phone: string | null
        }
        Insert: {
          address?: string | null
          avatar_url?: string | null
          biometric_credential_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          last_seen_at?: string | null
          national_id?: string | null
          notes?: string | null
          phone?: string | null
        }
        Update: {
          address?: string | null
          avatar_url?: string | null
          biometric_credential_id?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          last_seen_at?: string | null
          national_id?: string | null
          notes?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      staff_attendance: {
        Row: {
          created_at: string
          device_label: string | null
          event: string
          id: string
          method: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          event: string
          id?: string
          method?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string | null
          event?: string
          id?: string
          method?: string
          user_id?: string
        }
        Relationships: []
      }
      stock_daily: {
        Row: {
          additional: number
          day: string
          id: string
          location_id: string
          opening: number
          part_id: string
          sales: number
        }
        Insert: {
          additional?: number
          day?: string
          id?: string
          location_id: string
          opening?: number
          part_id: string
          sales?: number
        }
        Update: {
          additional?: number
          day?: string
          id?: string
          location_id?: string
          opening?: number
          part_id?: string
          sales?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_daily_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_daily_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          buy_price: number | null
          created_at: string
          created_by: string | null
          id: string
          job_id: string | null
          location_id: string
          note: string | null
          part_id: string
          qty: number
          reference: string | null
          sell_price: number | null
          type: Database["public"]["Enums"]["movement_type"]
          unit_price: number | null
        }
        Insert: {
          buy_price?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          location_id: string
          note?: string | null
          part_id: string
          qty: number
          reference?: string | null
          sell_price?: number | null
          type: Database["public"]["Enums"]["movement_type"]
          unit_price?: number | null
        }
        Update: {
          buy_price?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          location_id?: string
          note?: string | null
          part_id?: string
          qty?: number
          reference?: string | null
          sell_price?: number | null
          type?: Database["public"]["Enums"]["movement_type"]
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_ledger: {
        Row: {
          amount: number
          buy_price: number | null
          created_at: string
          created_by: string | null
          date: string
          id: string
          job_id: string | null
          location_id: string | null
          note: string | null
          part_id: string | null
          qty: number | null
          reference: string | null
          sell_price: number | null
          supplier_id: string
          type: string
        }
        Insert: {
          amount?: number
          buy_price?: number | null
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          job_id?: string | null
          location_id?: string | null
          note?: string | null
          part_id?: string | null
          qty?: number | null
          reference?: string | null
          sell_price?: number | null
          supplier_id: string
          type: string
        }
        Update: {
          amount?: number
          buy_price?: number | null
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          job_id?: string | null
          location_id?: string | null
          note?: string | null
          part_id?: string | null
          qty?: number | null
          reference?: string | null
          sell_price?: number | null
          supplier_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_ledger_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_ledger_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_ledger_part_id_fkey"
            columns: ["part_id"]
            isOneToOne: false
            referencedRelation: "parts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_ledger_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          created_at: string
          description: string | null
          email: string | null
          id: string
          kind: string
          location: string | null
          name: string
          notes: string | null
          phone: string | null
          purpose: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          kind?: string
          location?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          purpose?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          email?: string | null
          id?: string
          kind?: string
          location?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          purpose?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tool_assignments: {
        Row: {
          assigned_at: string
          created_by: string | null
          id: string
          job_id: string | null
          mechanic_id: string
          note: string | null
          returned_at: string | null
          tool_id: string
        }
        Insert: {
          assigned_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          mechanic_id: string
          note?: string | null
          returned_at?: string | null
          tool_id: string
        }
        Update: {
          assigned_at?: string
          created_by?: string | null
          id?: string
          job_id?: string | null
          mechanic_id?: string
          note?: string | null
          returned_at?: string | null
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_assignments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_assignments_mechanic_id_fkey"
            columns: ["mechanic_id"]
            isOneToOne: false
            referencedRelation: "mechanics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_assignments_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_checkins: {
        Row: {
          checked_at: string
          checked_by: string | null
          id: string
          mechanic_id: string | null
          notes: string | null
          period: string
          photo_url: string | null
          status: string
          tool_id: string
        }
        Insert: {
          checked_at?: string
          checked_by?: string | null
          id?: string
          mechanic_id?: string | null
          notes?: string | null
          period: string
          photo_url?: string | null
          status?: string
          tool_id: string
        }
        Update: {
          checked_at?: string
          checked_by?: string | null
          id?: string
          mechanic_id?: string | null
          notes?: string | null
          period?: string
          photo_url?: string | null
          status?: string
          tool_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_checkins_mechanic_id_fkey"
            columns: ["mechanic_id"]
            isOneToOne: false
            referencedRelation: "mechanics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_checkins_tool_id_fkey"
            columns: ["tool_id"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
        ]
      }
      tools: {
        Row: {
          category: string | null
          code: string
          condition: string
          created_at: string
          id: string
          name: string
          notes: string | null
          photo_url: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          code: string
          condition?: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          code?: string
          condition?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      job_card_photos: {
        Row: {
          created_at: string
          id: string
          is_private: boolean
          job_id: string
          kind: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_private?: boolean
          job_id: string
          kind: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_private?: boolean
          job_id?: string
          kind?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_card_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      tronix_memories: {
        Row: {
          created_at: string
          id: string
          memory_key: string
          memory_value: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          memory_key: string
          memory_value: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          memory_key?: string
          memory_value?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      tronix_messages: {
        Row: {
          content: string
          created_at: string
          has_image: boolean
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          has_image?: boolean
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          has_image?: boolean
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicle_models: {
        Row: {
          body_style: string | null
          id: string
          make: string
          model: string
        }
        Insert: {
          body_style?: string | null
          id?: string
          make: string
          model: string
        }
        Update: {
          body_style?: string | null
          id?: string
          make?: string
          model?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          client_id: string | null
          color: string | null
          created_at: string
          detected_by_ai: boolean
          engine_no: string | null
          fuel_type: string | null
          id: string
          make: string | null
          mileage: number | null
          model: string | null
          notes: string | null
          plate: string
          transmission: string | null
          updated_at: string
          vin: string | null
          year: number | null
        }
        Insert: {
          client_id?: string | null
          color?: string | null
          created_at?: string
          detected_by_ai?: boolean
          engine_no?: string | null
          fuel_type?: string | null
          id?: string
          make?: string | null
          mileage?: number | null
          model?: string | null
          notes?: string | null
          plate: string
          transmission?: string | null
          updated_at?: string
          vin?: string | null
          year?: number | null
        }
        Update: {
          client_id?: string | null
          color?: string | null
          created_at?: string
          detected_by_ai?: boolean
          engine_no?: string | null
          fuel_type?: string | null
          id?: string
          make?: string | null
          mileage?: number | null
          model?: string | null
          notes?: string | null
          plate?: string
          transmission?: string | null
          updated_at?: string
          vin?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      webauthn_credentials: {
        Row: {
          credential_id: string
          device_label: string | null
          enrolled_at: string
          enrolled_by: string | null
          id: string
          last_used_at: string | null
          public_key: string | null
          user_id: string
        }
        Insert: {
          credential_id: string
          device_label?: string | null
          enrolled_at?: string
          enrolled_by?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string | null
          user_id: string
        }
        Update: {
          credential_id?: string
          device_label?: string | null
          enrolled_at?: string
          enrolled_by?: string | null
          id?: string
          last_used_at?: string | null
          public_key?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_parts_for_fitting: { Args: { _job_id: string }; Returns: boolean }
      get_job_for_feedback: {
        Args: { _token: string }
        Returns: {
          ai_diagnostic_summary: string
          client_approved_at: string
          client_rating: number
          customer_name: string
          diagnosis_approval_code: string
          diagnosis_approved_at: string
          estimate: number
          id: string
          invoice_amount: number
          job_no: string
          plate: string
          recommended_parts: Json
          reported_problem: string
          status: string
          vehicle_label: string
          vehicle_make: string
          vehicle_model: string
          work_performed: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      set_user_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      submit_client_feedback: {
        Args: { _comment: string; _rating: number; _token: string }
        Returns: boolean
      }
      submit_diagnosis_approval: {
        Args: { _comment: string; _rating: number; _token: string }
        Returns: boolean
      }
      verify_diagnosis_code: {
        Args: { _code: string; _job_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "reception"
        | "mechanic"
        | "storekeeper"
        | "super_admin"
        | "gateman"
        | "manager"
        | "director"
        | "client"
      movement_type:
        | "restock"
        | "sale"
        | "transfer_out"
        | "transfer_in"
        | "adjustment"
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
      app_role: [
        "admin",
        "reception",
        "mechanic",
        "storekeeper",
        "super_admin",
        "gateman",
        "manager",
        "director",
        "client",
      ],
      movement_type: [
        "restock",
        "sale",
        "transfer_out",
        "transfer_in",
        "adjustment",
      ],
    },
  },
} as const
