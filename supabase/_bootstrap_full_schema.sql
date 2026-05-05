-- =====================================================================
-- FULL DATABASE BOOTSTRAP - Golden Automotive Solutions
-- Paste this whole file into the Supabase SQL Editor of a NEW project.
-- It creates the final schema, triggers, RLS policies, storage buckets,
-- seed reference data, and RPCs used by the app.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'app_role'
  ) THEN
    CREATE TYPE public.app_role AS ENUM (
      'admin',
      'reception',
      'mechanic',
      'storekeeper',
      'super_admin',
      'gateman',
      'manager',
      'director'
    );
  END IF;
END
$$;

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gateman';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'director';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'movement_type'
  ) THEN
    CREATE TYPE public.movement_type AS ENUM (
      'restock',
      'sale',
      'transfer_out',
      'transfer_in',
      'adjustment'
    );
  END IF;
END
$$;

CREATE SEQUENCE IF NOT EXISTS public.job_no_seq START WITH 1 INCREMENT BY 1;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  email text,
  avatar_url text,
  phone text,
  national_id text,
  address text,
  notes text,
  biometric_credential_id text,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone_primary text,
  phone_alt text,
  email text,
  address text,
  contact_method text,
  occupation text,
  source text,
  source_detail text,
  referred_by text,
  marketing_consent boolean NOT NULL DEFAULT false,
  value_rating text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  plate text NOT NULL,
  make text,
  model text,
  year integer,
  engine_no text,
  vin text,
  fuel_type text,
  transmission text,
  mileage integer,
  color text,
  notes text,
  detected_by_ai boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('shop', 'garage_store')),
  address text,
  is_supplier boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  min_stock integer NOT NULL DEFAULT 0,
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_no text NOT NULL UNIQUE DEFAULT ('JOB-' || lpad(nextval('public.job_no_seq')::text, 4, '0')),
  plate text NOT NULL,
  vehicle_id uuid,
  client_id uuid,
  customer_name text,
  customer_phone text,
  vehicle_label text,
  complaint text,
  mechanic text,
  estimate numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'diagnosis',
  service_type text,
  paint_color_code text,
  previous_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_feedback text,
  feedback_rating integer,
  gate_pass_issued boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  paid_at timestamptz,
  closed_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  has_insurance boolean NOT NULL DEFAULT false,
  insurance_company text,
  insurance_policy_no text,
  reported_problem text,
  work_performed text,
  ai_diagnostic_summary text,
  recommended_parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  financial_summary text,
  quotation_amount numeric NOT NULL DEFAULT 0,
  invoice_amount numeric NOT NULL DEFAULT 0,
  receipt_amount numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  discount_reason text,
  assigned_mechanic_id uuid,
  client_feedback_token text,
  client_approved_at timestamptz,
  client_rating integer,
  diagnosis_approved_at timestamptz,
  diagnosis_approval_rating integer,
  diagnosis_approval_comment text,
  parts_fit_approved_at timestamptz,
  parts_fit_approved_by uuid,
  diagnosis_approval_code text,
  diagnosis_sent_at timestamptz,
  requires_internal_parts_approval boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.part_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  qty integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (part_id, location_id)
);

CREATE TABLE IF NOT EXISTS public.stock_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT CURRENT_DATE,
  opening integer NOT NULL DEFAULT 0,
  additional integer NOT NULL DEFAULT 0,
  sales integer NOT NULL DEFAULT 0,
  UNIQUE (part_id, location_id, day)
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id uuid NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  type public.movement_type NOT NULL,
  qty integer NOT NULL,
  unit_price numeric(12,2),
  reference text,
  note text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  buy_price numeric,
  sell_price numeric
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  kind text NOT NULL DEFAULT 'external',
  location text,
  purpose text,
  description text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mechanics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  active boolean NOT NULL DEFAULT true,
  specialties text[] NOT NULL DEFAULT '{}'::text[],
  level text NOT NULL DEFAULT 'junior',
  roles text[] NOT NULL DEFAULT '{}'::text[],
  other_specialisations text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category text,
  condition text NOT NULL DEFAULT 'good',
  photo_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicle_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  model text NOT NULL,
  body_style text,
  UNIQUE (make, model)
);

CREATE TABLE IF NOT EXISTS public.supplier_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  type text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  reference text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  part_id uuid REFERENCES public.parts(id),
  qty integer,
  buy_price numeric,
  sell_price numeric,
  location_id uuid REFERENCES public.locations(id)
);

CREATE TABLE IF NOT EXISTS public.inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_ref text NOT NULL,
  plate text,
  vehicle text,
  status text NOT NULL DEFAULT 'in_progress',
  manual_done boolean NOT NULL DEFAULT false,
  obd_done boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  fuel_level text,
  valuables_declared text,
  accessories text[],
  mileage_in integer,
  customer_complaint text,
  technician_diagnosis text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.inspection_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  category text,
  system text NOT NULL,
  part text NOT NULL,
  subpart text,
  status text NOT NULL DEFAULT 'ok',
  severity text,
  last_service text,
  next_due text,
  note text,
  action_required text,
  estimated_cost numeric,
  assigned_technician text,
  time_estimate_minutes integer,
  client_authorized boolean NOT NULL DEFAULT false,
  photo_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.obd_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'simulated',
  scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.obd_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.obd_scans(id) ON DELETE CASCADE,
  code text NOT NULL,
  meaning text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  system text
);

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text,
  invoice_book_no text,
  plate text,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  service_type text,
  parts_source text,
  time_in timestamptz,
  time_out timestamptz,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  discount_by text,
  amount_paid numeric NOT NULL DEFAULT 0,
  technicians text,
  customer_phone text,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  doc_type text NOT NULL DEFAULT 'invoice'
);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'part',
  description text NOT NULL,
  qty numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.petty_cash_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  type text NOT NULL DEFAULT 'payment',
  payee text,
  details text,
  amount numeric NOT NULL DEFAULT 0,
  transaction_cost numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  payment_mode text NOT NULL DEFAULT 'cash',
  payment_reference text
);

CREATE TABLE IF NOT EXISTS public.tool_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id uuid NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  mechanic_id uuid NOT NULL REFERENCES public.mechanics(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz,
  note text,
  created_by uuid,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.tool_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id uuid NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  mechanic_id uuid REFERENCES public.mechanics(id) ON DELETE SET NULL,
  period text NOT NULL,
  status text NOT NULL DEFAULT 'present',
  notes text,
  photo_url text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by uuid
);

CREATE TABLE IF NOT EXISTS public.gate_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  pass_no text NOT NULL DEFAULT ('GP-' || to_char(now(), 'YYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 4)),
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  message text,
  notes text
);

CREATE TABLE IF NOT EXISTS public.part_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  requested_by uuid,
  mechanic_name text,
  kind text NOT NULL DEFAULT 'part',
  item_name text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_at timestamptz,
  returned_at timestamptz,
  return_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL DEFAULT 'in_house',
  is_major boolean NOT NULL DEFAULT false,
  estimated_unit_price numeric NOT NULL DEFAULT 0,
  ordered_at timestamptz,
  in_delivery_at timestamptz,
  delivered_at timestamptz,
  internal_approved_at timestamptz,
  internal_approved_by uuid
);

CREATE TABLE IF NOT EXISTS public.gate_pass_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  plate text,
  reason text NOT NULL,
  reason_detail text,
  destination text,
  expected_return timestamptz,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  released_by uuid,
  released_at timestamptz,
  returned_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_final_release boolean NOT NULL DEFAULT false,
  late_notified_at timestamptz,
  arrived_early_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.job_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'part',
  description text NOT NULL,
  part_id uuid,
  qty numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual',
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  part_request_id uuid
);

CREATE TABLE IF NOT EXISTS public.ai_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'gemini',
  label text NOT NULL,
  api_key text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event text NOT NULL,
  method text NOT NULL DEFAULT 'webauthn',
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_mechanics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  mechanic_id uuid NOT NULL,
  role_on_job text NOT NULL DEFAULT 'lead',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, mechanic_id)
);

CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  credential_id text NOT NULL UNIQUE,
  public_key text,
  device_label text,
  enrolled_by uuid,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  title text NOT NULL,
  body text,
  link text,
  kind text NOT NULL DEFAULT 'info',
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tronix_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  has_image boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Legacy alignment for safe re-runs
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS biometric_credential_id text,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS detected_by_ai boolean NOT NULL DEFAULT false;

ALTER TABLE public.stock_movements
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS buy_price numeric,
  ADD COLUMN IF NOT EXISTS sell_price numeric;

ALTER TABLE public.tool_assignments
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.petty_cash_entries
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_reference text;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'invoice';

ALTER TABLE public.supplier_ledger
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS part_id uuid REFERENCES public.parts(id),
  ADD COLUMN IF NOT EXISTS qty integer,
  ADD COLUMN IF NOT EXISTS buy_price numeric,
  ADD COLUMN IF NOT EXISTS sell_price numeric,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS fuel_level text,
  ADD COLUMN IF NOT EXISTS valuables_declared text,
  ADD COLUMN IF NOT EXISTS accessories text[],
  ADD COLUMN IF NOT EXISTS mileage_in integer,
  ADD COLUMN IF NOT EXISTS customer_complaint text,
  ADD COLUMN IF NOT EXISTS technician_diagnosis text,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.inspection_findings
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS last_service text,
  ADD COLUMN IF NOT EXISTS next_due text,
  ADD COLUMN IF NOT EXISTS action_required text,
  ADD COLUMN IF NOT EXISTS estimated_cost numeric,
  ADD COLUMN IF NOT EXISTS assigned_technician text,
  ADD COLUMN IF NOT EXISTS time_estimate_minutes integer,
  ADD COLUMN IF NOT EXISTS client_authorized boolean NOT NULL DEFAULT false;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS has_insurance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS insurance_company text,
  ADD COLUMN IF NOT EXISTS insurance_policy_no text,
  ADD COLUMN IF NOT EXISTS reported_problem text,
  ADD COLUMN IF NOT EXISTS work_performed text,
  ADD COLUMN IF NOT EXISTS ai_diagnostic_summary text,
  ADD COLUMN IF NOT EXISTS recommended_parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS financial_summary text,
  ADD COLUMN IF NOT EXISTS quotation_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason text,
  ADD COLUMN IF NOT EXISTS assigned_mechanic_id uuid,
  ADD COLUMN IF NOT EXISTS client_feedback_token text,
  ADD COLUMN IF NOT EXISTS client_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_rating integer,
  ADD COLUMN IF NOT EXISTS diagnosis_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS diagnosis_approval_rating integer,
  ADD COLUMN IF NOT EXISTS diagnosis_approval_comment text,
  ADD COLUMN IF NOT EXISTS parts_fit_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS parts_fit_approved_by uuid,
  ADD COLUMN IF NOT EXISTS diagnosis_approval_code text,
  ADD COLUMN IF NOT EXISTS diagnosis_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS requires_internal_parts_approval boolean NOT NULL DEFAULT false;

ALTER TABLE public.jobs
  ALTER COLUMN client_feedback_token SET DEFAULT encode(gen_random_bytes(12), 'hex');

ALTER TABLE public.part_requests
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'in_house',
  ADD COLUMN IF NOT EXISTS is_major boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_unit_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS in_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS internal_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS internal_approved_by uuid;

ALTER TABLE public.gate_pass_requests
  ADD COLUMN IF NOT EXISTS is_final_release boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS late_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrived_early_at timestamptz;

ALTER TABLE public.job_line_items
  ADD COLUMN IF NOT EXISTS part_request_id uuid;

ALTER TABLE public.mechanics
  ADD COLUMN IF NOT EXISTS specialties text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'junior',
  ADD COLUMN IF NOT EXISTS roles text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS other_specialisations text;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS description text;

UPDATE public.jobs
   SET reported_problem = complaint
 WHERE reported_problem IS NULL
   AND complaint IS NOT NULL;

UPDATE public.suppliers
   SET description = purpose
 WHERE description IS NULL
   AND purpose IS NOT NULL;

UPDATE public.jobs
   SET client_feedback_token = encode(gen_random_bytes(12), 'hex')
 WHERE client_feedback_token IS NULL;

UPDATE public.jobs
   SET diagnosis_approval_code = lpad((floor(random() * 1000000))::integer::text, 6, '0')
 WHERE diagnosis_approval_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_client_feedback_token_unique
  ON public.jobs (client_feedback_token)
  WHERE client_feedback_token IS NOT NULL;

-- ---------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON public.vehicles (plate);
CREATE INDEX IF NOT EXISTS idx_jobs_plate ON public.jobs (plate);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_job_no ON public.jobs (job_no);
CREATE INDEX IF NOT EXISTS idx_stock_movements_job ON public.stock_movements (job_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON public.supplier_ledger (supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_job ON public.supplier_ledger (job_id);
CREATE INDEX IF NOT EXISTS idx_inspections_job_ref ON public.inspections (job_ref);
CREATE INDEX IF NOT EXISTS idx_inspections_job ON public.inspections (job_id);
CREATE INDEX IF NOT EXISTS idx_findings_inspection ON public.inspection_findings (inspection_id);
CREATE INDEX IF NOT EXISTS idx_obd_codes_scan ON public.obd_codes (scan_id);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON public.invoices (job_id);
CREATE INDEX IF NOT EXISTS idx_petty_date ON public.petty_cash_entries (date);
CREATE INDEX IF NOT EXISTS idx_petty_job ON public.petty_cash_entries (job_id);
CREATE INDEX IF NOT EXISTS idx_tool_assignments_open ON public.tool_assignments (tool_id) WHERE returned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tool_assignments_job ON public.tool_assignments (job_id);
CREATE INDEX IF NOT EXISTS idx_tool_checkins_period ON public.tool_checkins (period);
CREATE INDEX IF NOT EXISTS idx_job_line_items_job ON public.job_line_items (job_id);
CREATE INDEX IF NOT EXISTS idx_jli_part_request ON public.job_line_items (part_request_id);
CREATE INDEX IF NOT EXISTS idx_attendance_user_day ON public.staff_attendance (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_mechanics_job ON public.job_mechanics (job_id);
CREATE INDEX IF NOT EXISTS idx_job_mechanics_mech ON public.job_mechanics (mechanic_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_user ON public.webauthn_credentials (user_id);
CREATE INDEX IF NOT EXISTS idx_tronix_messages_user_created ON public.tronix_messages (user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN (
        'super_admin',
        'admin',
        'director',
        'manager',
        'reception',
        'mechanic',
        'storekeeper',
        'gateman'
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'reception')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_previous_job()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.previous_job_id IS NULL AND NEW.plate IS NOT NULL THEN
    SELECT id
      INTO NEW.previous_job_id
    FROM public.jobs
    WHERE plate = NEW.plate
      AND id <> NEW.id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  delta integer;
  current_qty integer;
  add_col integer := 0;
  sale_col integer := 0;
BEGIN
  IF NEW.type IN ('restock', 'transfer_in') THEN
    delta := NEW.qty;
  ELSIF NEW.type IN ('sale', 'transfer_out') THEN
    delta := -NEW.qty;
  ELSE
    delta := NEW.qty;
  END IF;

  SELECT qty
    INTO current_qty
  FROM public.part_stock
  WHERE part_id = NEW.part_id
    AND location_id = NEW.location_id;

  IF current_qty IS NULL THEN
    current_qty := 0;
  END IF;

  INSERT INTO public.part_stock (part_id, location_id, qty)
  VALUES (NEW.part_id, NEW.location_id, current_qty + delta)
  ON CONFLICT (part_id, location_id)
  DO UPDATE
    SET qty = public.part_stock.qty + delta,
        updated_at = now();

  IF NEW.type IN ('restock', 'transfer_in') THEN
    add_col := NEW.qty;
  ELSIF NEW.type IN ('sale', 'transfer_out') THEN
    sale_col := NEW.qty;
  END IF;

  INSERT INTO public.stock_daily (part_id, location_id, day, opening, additional, sales)
  VALUES (NEW.part_id, NEW.location_id, CURRENT_DATE, current_qty, add_col, sale_col)
  ON CONFLICT (part_id, location_id, day)
  DO UPDATE
    SET additional = public.stock_daily.additional + add_col,
        sales = public.stock_daily.sales + sale_col;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.suppress_super_admin_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'super_admin') THEN
    BEGIN NEW.created_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.requested_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.approved_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.issued_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.released_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.checked_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.supplier_charge_to_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_loc uuid;
BEGIN
  IF NEW.type <> 'charge'
     OR NEW.part_id IS NULL
     OR NEW.qty IS NULL
     OR NEW.qty <= 0
  THEN
    RETURN NEW;
  END IF;

  v_loc := COALESCE(
    NEW.location_id,
    (SELECT id FROM public.locations WHERE kind = 'garage_store' LIMIT 1),
    (SELECT id FROM public.locations LIMIT 1)
  );

  IF v_loc IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.parts
     SET unit_cost = COALESCE(NEW.buy_price, unit_cost),
         unit_price = COALESCE(NEW.sell_price, unit_price)
   WHERE id = NEW.part_id;

  INSERT INTO public.stock_movements (
    part_id,
    location_id,
    type,
    qty,
    unit_price,
    reference,
    note,
    buy_price,
    sell_price,
    created_by
  )
  VALUES (
    NEW.part_id,
    v_loc,
    'restock',
    NEW.qty,
    NEW.buy_price,
    NEW.reference,
    COALESCE(NEW.note, 'Supplier charge'),
    NEW.buy_price,
    NEW.sell_price,
    NEW.created_by
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_part_request_to_line_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_part_id uuid;
  v_unit_price numeric := 0;
  v_pos integer;
  v_existing uuid;
BEGIN
  IF NEW.job_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.kind <> 'part' THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'rejected' THEN
    DELETE FROM public.job_line_items WHERE part_request_id = NEW.id;
    RETURN NEW;
  END IF;

  SELECT id, unit_price
    INTO v_part_id, v_unit_price
  FROM public.parts
  WHERE lower(name) = lower(NEW.item_name)
  LIMIT 1;

  SELECT id
    INTO v_existing
  FROM public.job_line_items
  WHERE part_request_id = NEW.id
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.job_line_items
       SET description = NEW.item_name,
           qty = NEW.qty,
           part_id = v_part_id,
           unit_price = COALESCE(NULLIF(unit_price, 0), v_unit_price, 0),
           updated_at = now()
     WHERE id = v_existing;
  ELSE
    SELECT COALESCE(MAX(position), 0) + 1
      INTO v_pos
    FROM public.job_line_items
    WHERE job_id = NEW.job_id;

    INSERT INTO public.job_line_items (
      job_id,
      kind,
      source,
      position,
      description,
      qty,
      unit_price,
      part_id,
      part_request_id
    )
    VALUES (
      NEW.job_id,
      'part',
      'request',
      v_pos,
      NEW.item_name,
      NEW.qty,
      COALESCE(v_unit_price, 0),
      v_part_id,
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_part_request_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.job_line_items WHERE part_request_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP FUNCTION IF EXISTS public.get_job_for_feedback(text);
CREATE OR REPLACE FUNCTION public.get_job_for_feedback(_token text)
RETURNS TABLE (
  id uuid,
  job_no text,
  plate text,
  vehicle_label text,
  customer_name text,
  reported_problem text,
  work_performed text,
  status text,
  invoice_amount numeric,
  client_approved_at timestamptz,
  client_rating integer,
  ai_diagnostic_summary text,
  recommended_parts jsonb,
  estimate numeric,
  diagnosis_approved_at timestamptz,
  diagnosis_approval_code text,
  vehicle_make text,
  vehicle_model text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    j.id,
    j.job_no,
    j.plate,
    j.vehicle_label,
    j.customer_name,
    j.reported_problem,
    j.work_performed,
    j.status,
    j.invoice_amount,
    j.client_approved_at,
    j.client_rating,
    j.ai_diagnostic_summary,
    j.recommended_parts,
    j.estimate,
    j.diagnosis_approved_at,
    j.diagnosis_approval_code,
    v.make AS vehicle_make,
    v.model AS vehicle_model
  FROM public.jobs j
  LEFT JOIN public.vehicles v
    ON v.id = j.vehicle_id
  WHERE j.client_feedback_token = _token
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.submit_client_feedback(
  _token text,
  _rating integer,
  _comment text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id
    INTO v_id
  FROM public.jobs
  WHERE client_feedback_token = _token;

  IF v_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.jobs
     SET client_rating = LEAST(GREATEST(_rating, 1), 5),
         customer_feedback = _comment,
         client_approved_at = now(),
         feedback_rating = LEAST(GREATEST(_rating, 1), 5),
         status = CASE WHEN status = 'awaiting_approval' THEN 'completed' ELSE status END
   WHERE id = v_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_diagnosis_approval(
  _token text,
  _rating integer,
  _comment text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id
    INTO v_id
  FROM public.jobs
  WHERE client_feedback_token = _token;

  IF v_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.jobs
     SET diagnosis_approved_at = now(),
         diagnosis_approval_rating = LEAST(GREATEST(COALESCE(_rating, 5), 1), 5),
         diagnosis_approval_comment = _comment,
         status = CASE WHEN status = 'diagnosis_approval' THEN 'parts' ELSE status END
   WHERE id = v_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_parts_for_fitting(_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'mechanic')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'storekeeper')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.jobs
     SET parts_fit_approved_at = now(),
         parts_fit_approved_by = auth.uid(),
         status = CASE WHEN status = 'parts_approval' THEN 'repair' ELSE status END
   WHERE id = _job_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_diagnosis_code(_job_id uuid, _code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'reception')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT diagnosis_approval_code
    INTO v_code
  FROM public.jobs
  WHERE id = _job_id;

  IF v_code IS NULL OR _code IS NULL OR trim(_code) <> v_code THEN
    RETURN false;
  END IF;

  UPDATE public.jobs
     SET diagnosis_approved_at = COALESCE(diagnosis_approved_at, now()),
         status = CASE WHEN status = 'diagnosis_approval' THEN 'parts' ELSE status END
   WHERE id = _job_id;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_flag_major_part_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thresh numeric;
BEGIN
  SELECT COALESCE(value::numeric, 20000)
    INTO v_thresh
  FROM public.app_settings
  WHERE key = 'major_part_threshold_ksh';

  IF NEW.is_major IS NOT TRUE
     AND NEW.kind = 'part'
     AND COALESCE(NEW.estimated_unit_price, 0) * COALESCE(NEW.qty, 1) >= COALESCE(v_thresh, 20000)
  THEN
    NEW.is_major := true;
  END IF;

  IF NEW.is_major IS TRUE AND NEW.job_id IS NOT NULL THEN
    UPDATE public.jobs
       SET requires_internal_parts_approval = true
     WHERE id = NEW.job_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _role = 'super_admin' AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
END;
$$;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS trg_clients_upd ON public.clients;
CREATE TRIGGER trg_clients_upd
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_vehicles_upd ON public.vehicles;
CREATE TRIGGER trg_vehicles_upd
BEFORE UPDATE ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_app_settings_updated ON public.app_settings;
CREATE TRIGGER trg_app_settings_updated
BEFORE UPDATE ON public.app_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_invoices_upd ON public.invoices;
CREATE TRIGGER trg_invoices_upd
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_suppliers_upd ON public.suppliers;
CREATE TRIGGER trg_suppliers_upd
BEFORE UPDATE ON public.suppliers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_tools_updated_at ON public.tools;
CREATE TRIGGER update_tools_updated_at
BEFORE UPDATE ON public.tools
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON public.jobs;
CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_jobs_link_previous ON public.jobs;
CREATE TRIGGER trg_jobs_link_previous
BEFORE INSERT ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.link_previous_job();

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

DROP TRIGGER IF EXISTS part_requests_updated ON public.part_requests;
CREATE TRIGGER part_requests_updated
BEFORE UPDATE ON public.part_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS gate_pass_requests_updated ON public.gate_pass_requests;
CREATE TRIGGER gate_pass_requests_updated
BEFORE UPDATE ON public.gate_pass_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_job_line_items_updated ON public.job_line_items;
CREATE TRIGGER trg_job_line_items_updated
BEFORE UPDATE ON public.job_line_items
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS supplier_charge_stock_trg ON public.supplier_ledger;
CREATE TRIGGER supplier_charge_stock_trg
AFTER INSERT ON public.supplier_ledger
FOR EACH ROW EXECUTE FUNCTION public.supplier_charge_to_stock();

DROP TRIGGER IF EXISTS trg_sync_part_request_ai ON public.part_requests;
CREATE TRIGGER trg_sync_part_request_ai
AFTER INSERT OR UPDATE ON public.part_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_part_request_to_line_item();

DROP TRIGGER IF EXISTS trg_sync_part_request_del ON public.part_requests;
CREATE TRIGGER trg_sync_part_request_del
AFTER DELETE ON public.part_requests
FOR EACH ROW EXECUTE FUNCTION public.cleanup_part_request_line();

DROP TRIGGER IF EXISTS trg_auto_flag_major ON public.part_requests;
CREATE TRIGGER trg_auto_flag_major
BEFORE INSERT OR UPDATE OF qty, estimated_unit_price, is_major
ON public.part_requests
FOR EACH ROW EXECUTE FUNCTION public.auto_flag_major_part_request();

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'jobs',
      'invoices',
      'invoice_items',
      'petty_cash_entries',
      'stock_movements',
      'supplier_ledger',
      'tool_assignments',
      'tool_checkins',
      'gate_passes',
      'part_requests',
      'gate_pass_requests',
      'inspections',
      'inspection_findings'
    ])
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS suppress_super_admin_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER suppress_super_admin_%I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.suppress_super_admin_audit()',
      t,
      t
    );
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mechanics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspection_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obd_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.obd_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gate_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gate_pass_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_mechanics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tronix_messages ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "own profile read" ON public.profiles;
CREATE POLICY "own profile read"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "own profile update" ON public.profiles;
CREATE POLICY "own profile update"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "admins read all profiles" ON public.profiles;
CREATE POLICY "admins read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'reception')
    OR public.has_role(auth.uid(), 'gateman')
  );

DROP POLICY IF EXISTS "admins update all profiles" ON public.profiles;
CREATE POLICY "admins update all profiles"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "own roles read" ON public.user_roles;
CREATE POLICY "own roles read"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "staff read all roles" ON public.user_roles;
CREATE POLICY "staff read all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "admins manage roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "super_admin read app_settings" ON public.app_settings;
CREATE POLICY "super_admin read app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "auth read app_settings" ON public.app_settings;
CREATE POLICY "auth read app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR key = 'major_part_threshold_ksh'
  );

DROP POLICY IF EXISTS "super_admin insert app_settings" ON public.app_settings;
CREATE POLICY "super_admin insert app_settings"
  ON public.app_settings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "super_admin update app_settings" ON public.app_settings;
CREATE POLICY "super_admin update app_settings"
  ON public.app_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "super_admin delete app_settings" ON public.app_settings;
CREATE POLICY "super_admin delete app_settings"
  ON public.app_settings FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "auth read clients" ON public.clients;
CREATE POLICY "auth read clients"
  ON public.clients FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write clients" ON public.clients;
CREATE POLICY "auth write clients"
  ON public.clients FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth read vehicles" ON public.vehicles;
CREATE POLICY "auth read vehicles"
  ON public.vehicles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write vehicles" ON public.vehicles;
CREATE POLICY "auth write vehicles"
  ON public.vehicles FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth read locations" ON public.locations;
CREATE POLICY "auth read locations"
  ON public.locations FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff manage locations" ON public.locations;
CREATE POLICY "staff manage locations"
  ON public.locations FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read parts" ON public.parts;
CREATE POLICY "auth read parts"
  ON public.parts FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff manage parts" ON public.parts;
CREATE POLICY "staff manage parts"
  ON public.parts FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read jobs" ON public.jobs;
CREATE POLICY "auth read jobs"
  ON public.jobs FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth insert jobs" ON public.jobs;
CREATE POLICY "auth insert jobs"
  ON public.jobs FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth update jobs" ON public.jobs;
CREATE POLICY "auth update jobs"
  ON public.jobs FOR UPDATE
  TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin delete jobs" ON public.jobs;
CREATE POLICY "admin delete jobs"
  ON public.jobs FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "auth read part_stock" ON public.part_stock;
CREATE POLICY "auth read part_stock"
  ON public.part_stock FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff manage part_stock" ON public.part_stock;
CREATE POLICY "staff manage part_stock"
  ON public.part_stock FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read stock_daily" ON public.stock_daily;
CREATE POLICY "auth read stock_daily"
  ON public.stock_daily FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff manage stock_daily" ON public.stock_daily;
CREATE POLICY "staff manage stock_daily"
  ON public.stock_daily FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read movements" ON public.stock_movements;
CREATE POLICY "auth read movements"
  ON public.stock_movements FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff insert movements" ON public.stock_movements;
CREATE POLICY "staff insert movements"
  ON public.stock_movements FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read suppliers" ON public.suppliers;
CREATE POLICY "auth read suppliers"
  ON public.suppliers FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write suppliers" ON public.suppliers;
CREATE POLICY "auth write suppliers"
  ON public.suppliers FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth read supplier_ledger" ON public.supplier_ledger;
CREATE POLICY "auth read supplier_ledger"
  ON public.supplier_ledger FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write supplier_ledger" ON public.supplier_ledger;
CREATE POLICY "auth write supplier_ledger"
  ON public.supplier_ledger FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth read mechanics" ON public.mechanics;
CREATE POLICY "auth read mechanics"
  ON public.mechanics FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff manage mechanics" ON public.mechanics;
CREATE POLICY "staff manage mechanics"
  ON public.mechanics FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read tools" ON public.tools;
CREATE POLICY "auth read tools"
  ON public.tools FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff manage tools" ON public.tools;
CREATE POLICY "staff manage tools"
  ON public.tools FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read models" ON public.vehicle_models;
CREATE POLICY "auth read models"
  ON public.vehicle_models FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admin manage models" ON public.vehicle_models;
CREATE POLICY "admin manage models"
  ON public.vehicle_models FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "auth read inspections" ON public.inspections;
CREATE POLICY "auth read inspections"
  ON public.inspections FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write inspections" ON public.inspections;
CREATE POLICY "auth write inspections"
  ON public.inspections FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth update inspections" ON public.inspections;
CREATE POLICY "auth update inspections"
  ON public.inspections FOR UPDATE
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth read findings" ON public.inspection_findings;
CREATE POLICY "auth read findings"
  ON public.inspection_findings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write findings" ON public.inspection_findings;
CREATE POLICY "auth write findings"
  ON public.inspection_findings FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth all obd_scans" ON public.obd_scans;
CREATE POLICY "auth all obd_scans"
  ON public.obd_scans FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth all obd_codes" ON public.obd_codes;
CREATE POLICY "auth all obd_codes"
  ON public.obd_codes FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth read invoices" ON public.invoices;
CREATE POLICY "auth read invoices"
  ON public.invoices FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write invoices" ON public.invoices;
CREATE POLICY "auth write invoices"
  ON public.invoices FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth read invoice_items" ON public.invoice_items;
CREATE POLICY "auth read invoice_items"
  ON public.invoice_items FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write invoice_items" ON public.invoice_items;
CREATE POLICY "auth write invoice_items"
  ON public.invoice_items FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "auth read petty" ON public.petty_cash_entries;
CREATE POLICY "auth read petty"
  ON public.petty_cash_entries FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth insert petty" ON public.petty_cash_entries;
CREATE POLICY "auth insert petty"
  ON public.petty_cash_entries FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin update petty" ON public.petty_cash_entries;
CREATE POLICY "admin update petty"
  ON public.petty_cash_entries FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "admin delete petty" ON public.petty_cash_entries;
CREATE POLICY "admin delete petty"
  ON public.petty_cash_entries FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "auth read tool_assignments" ON public.tool_assignments;
CREATE POLICY "auth read tool_assignments"
  ON public.tool_assignments FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff manage tool_assignments" ON public.tool_assignments;
CREATE POLICY "staff manage tool_assignments"
  ON public.tool_assignments FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read tool_checkins" ON public.tool_checkins;
CREATE POLICY "auth read tool_checkins"
  ON public.tool_checkins FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff manage tool_checkins" ON public.tool_checkins;
CREATE POLICY "staff manage tool_checkins"
  ON public.tool_checkins FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read gate_passes" ON public.gate_passes;
CREATE POLICY "auth read gate_passes"
  ON public.gate_passes FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth issue gate_passes" ON public.gate_passes;
CREATE POLICY "auth issue gate_passes"
  ON public.gate_passes FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read part_requests" ON public.part_requests;
CREATE POLICY "auth read part_requests"
  ON public.part_requests FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "staff insert part_requests" ON public.part_requests;
CREATE POLICY "staff insert part_requests"
  ON public.part_requests FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff update part_requests" ON public.part_requests;
CREATE POLICY "staff update part_requests"
  ON public.part_requests FOR UPDATE
  TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read gpr" ON public.gate_pass_requests;
CREATE POLICY "auth read gpr"
  ON public.gate_pass_requests FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth insert gpr" ON public.gate_pass_requests;
CREATE POLICY "auth insert gpr"
  ON public.gate_pass_requests FOR INSERT
  TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff update gpr" ON public.gate_pass_requests;
CREATE POLICY "staff update gpr"
  ON public.gate_pass_requests FOR UPDATE
  TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth read job_line_items" ON public.job_line_items;
CREATE POLICY "auth read job_line_items"
  ON public.job_line_items FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write job_line_items" ON public.job_line_items;
CREATE POLICY "auth write job_line_items"
  ON public.job_line_items FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "super_admin manage ai_keys" ON public.ai_keys;
CREATE POLICY "super_admin manage ai_keys"
  ON public.ai_keys FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "auth read attendance" ON public.staff_attendance;
CREATE POLICY "auth read attendance"
  ON public.staff_attendance FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth insert own attendance" ON public.staff_attendance;
DROP POLICY IF EXISTS "auth insert attendance" ON public.staff_attendance;
CREATE POLICY "auth insert attendance"
  ON public.staff_attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'reception')
    OR public.has_role(auth.uid(), 'gateman')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "auth read job_mechanics" ON public.job_mechanics;
CREATE POLICY "auth read job_mechanics"
  ON public.job_mechanics FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "auth write job_mechanics" ON public.job_mechanics;
CREATE POLICY "auth write job_mechanics"
  ON public.job_mechanics FOR ALL
  TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "own or admin read webauthn" ON public.webauthn_credentials;
CREATE POLICY "own or admin read webauthn"
  ON public.webauthn_credentials FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "own or admin insert webauthn" ON public.webauthn_credentials;
CREATE POLICY "own or admin insert webauthn"
  ON public.webauthn_credentials FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "own or admin delete webauthn" ON public.webauthn_credentials;
CREATE POLICY "own or admin delete webauthn"
  ON public.webauthn_credentials FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "own update webauthn last_used" ON public.webauthn_credentials;
CREATE POLICY "own update webauthn last_used"
  ON public.webauthn_credentials FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "notif read" ON public.notifications;
CREATE POLICY "notif read"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "notif insert" ON public.notifications;
CREATE POLICY "notif insert"
  ON public.notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "notif update own" ON public.notifications;
CREATE POLICY "notif update own"
  ON public.notifications FOR UPDATE
  TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "Users read their own Tronix history" ON public.tronix_messages;
CREATE POLICY "Users read their own Tronix history"
  ON public.tronix_messages FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert their own Tronix history" ON public.tronix_messages;
CREATE POLICY "Users insert their own Tronix history"
  ON public.tronix_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete their own Tronix history" ON public.tronix_messages;
CREATE POLICY "Users delete their own Tronix history"
  ON public.tronix_messages FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access tronix_messages" ON public.tronix_messages;
CREATE POLICY "Service role full access tronix_messages"
  ON public.tronix_messages FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ---------------------------------------------------------------------
-- Storage buckets and storage policies
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('inspection-photos', 'inspection-photos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public read inspection photos" ON storage.objects;
CREATE POLICY "public read inspection photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'inspection-photos');

DROP POLICY IF EXISTS "auth upload inspection photos" ON storage.objects;
CREATE POLICY "auth upload inspection photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'inspection-photos');

DROP POLICY IF EXISTS "auth update inspection photos" ON storage.objects;
CREATE POLICY "auth update inspection photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'inspection-photos');

DROP POLICY IF EXISTS "avatars public read" ON storage.objects;
CREATE POLICY "avatars public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars auth upload" ON storage.objects;
CREATE POLICY "avatars auth upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars auth update" ON storage.objects;
CREATE POLICY "avatars auth update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars auth delete" ON storage.objects;
CREATE POLICY "avatars auth delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'avatars');

-- ---------------------------------------------------------------------
-- Function privileges
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.apply_stock_movement() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.link_previous_job() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.suppress_super_admin_audit() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.supplier_charge_to_stock() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.sync_part_request_to_line_item() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.cleanup_part_request_line() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.auto_flag_major_part_request() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) FROM public;
GRANT EXECUTE ON FUNCTION public.set_user_role(uuid, public.app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.verify_diagnosis_code(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_diagnosis_code(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_parts_for_fitting(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_parts_for_fitting(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_job_for_feedback(text) FROM public;
GRANT EXECUTE ON FUNCTION public.get_job_for_feedback(text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_client_feedback(text, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_client_feedback(text, integer, text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.submit_diagnosis_approval(text, integer, text) FROM public;
GRANT EXECUTE ON FUNCTION public.submit_diagnosis_approval(text, integer, text) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------
INSERT INTO public.locations (name, kind, address, is_supplier)
VALUES
  ('Nairobi Shop', 'shop', 'Nairobi CBD', true),
  ('Garage Store', 'garage_store', 'Garage premises', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.parts (sku, name, unit_price, unit_cost, min_stock, category)
VALUES
  ('BP-FR-001', 'Brake Pads (Front)', 3500, 2400, 10, 'Brakes'),
  ('EO-5W30-4', 'Engine Oil 5W-30 4L', 4200, 2800, 12, 'Fluids'),
  ('AF-202', 'Air Filter', 1200, 700, 8, 'Filters'),
  ('RD-UNI-7', 'Radiator (Universal)', 12500, 9000, 4, 'Cooling'),
  ('BT-60AH', 'Battery 60Ah', 11000, 8500, 5, 'Electrical'),
  ('SP-SET-4', 'Spark Plugs (set)', 1800, 1100, 20, 'Engine'),
  ('AC-COMP-1', 'AC Compressor', 28500, 21000, 2, 'AC'),
  ('TR-END-2', 'Tie Rod End', 2400, 1500, 6, 'Steering')
ON CONFLICT (sku) DO NOTHING;

INSERT INTO public.part_stock (part_id, location_id, qty)
SELECT p.id, l.id,
       CASE l.kind WHEN 'shop' THEN 30 ELSE 10 END
FROM public.parts p
CROSS JOIN public.locations l
WHERE p.sku IN (
  'BP-FR-001',
  'EO-5W30-4',
  'AF-202',
  'RD-UNI-7',
  'BT-60AH',
  'SP-SET-4',
  'AC-COMP-1',
  'TR-END-2'
)
ON CONFLICT (part_id, location_id) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('major_part_threshold_ksh', '20000')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.profiles (id, display_name, email)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'display_name', u.email),
  u.email
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'reception'::public.app_role
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_roles ur
  WHERE ur.user_id = u.id
)
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO public.vehicle_models (make, model, body_style)
VALUES
  ('Mazda', 'Demio', 'hatchback'),
  ('Mazda', 'Axela', 'sedan'),
  ('Mazda', 'Atenza', 'sedan'),
  ('Mazda', 'CX-3', 'suv'),
  ('Mazda', 'CX-5', 'suv'),
  ('Mazda', 'CX-7', 'suv'),
  ('Mazda', 'CX-8', 'suv'),
  ('Mazda', 'CX-9', 'suv'),
  ('Mazda', 'MX-5', 'convertible'),
  ('Mazda', 'BT-50', 'pickup'),
  ('Mazda', 'Premacy', 'minivan'),
  ('Mazda', 'Bongo', 'van'),
  ('Mazda', 'Mazda2', 'hatchback'),
  ('Mazda', 'Mazda3', 'sedan'),
  ('Mazda', 'Mazda6', 'sedan'),
  ('Mazda', 'Tribute', 'suv'),
  ('Mazda', 'RX-8', 'coupe'),
  ('Mazda', 'Verisa', 'hatchback'),
  ('Mazda', 'Carol', 'kei'),
  ('Mazda', 'Familia', 'sedan'),
  ('Mazda', 'Roadster', 'convertible')
ON CONFLICT (make, model) DO NOTHING;

INSERT INTO public.parts (sku, name, category, unit_cost, unit_price, min_stock)
VALUES
  ('MZ-OF-DEMIO', 'Mazda Demio Oil Filter', 'Filters', 350, 650, 3),
  ('MZ-OF-AXELA', 'Mazda Axela Oil Filter', 'Filters', 400, 750, 3),
  ('MZ-OF-CX5', 'Mazda CX-5 Oil Filter', 'Filters', 550, 950, 3),
  ('MZ-AF-DEMIO', 'Mazda Demio Air Filter', 'Filters', 650, 1100, 2),
  ('MZ-AF-CX5', 'Mazda CX-5 Air Filter', 'Filters', 900, 1500, 2),
  ('MZ-BP-FRONT-DEMIO', 'Mazda Demio Front Brake Pads', 'Brakes', 2200, 3800, 2),
  ('MZ-BP-FRONT-CX5', 'Mazda CX-5 Front Brake Pads', 'Brakes', 3800, 6500, 2),
  ('MZ-BP-REAR-DEMIO', 'Mazda Demio Rear Brake Pads', 'Brakes', 1800, 3200, 2),
  ('MZ-SP-IRIDIUM', 'Mazda Iridium Spark Plug (NGK ILKAR7B11)', 'Ignition', 850, 1500, 4),
  ('MZ-TB-AXELA', 'Mazda Axela Timing Chain Kit', 'Engine', 8500, 14500, 1),
  ('MZ-WS-FRONT', 'Mazda Front Wiper Set', 'Wipers', 650, 1200, 4),
  ('MZ-CB-12V', 'Mazda 12V Battery NS70', 'Electrical', 8500, 12500, 2),
  ('MZ-COIL-MZR', 'Mazda MZR Ignition Coil', 'Ignition', 4200, 6800, 2),
  ('MZ-TR-LH', 'Mazda Tie Rod End LH', 'Suspension', 1800, 3200, 2),
  ('MZ-TR-RH', 'Mazda Tie Rod End RH', 'Suspension', 1800, 3200, 2)
ON CONFLICT (sku) DO NOTHING;

-- Keep the job number sequence aligned on re-runs.
DO $$
DECLARE
  v_max integer;
BEGIN
  SELECT max((regexp_match(job_no, '^JOB-(\d+)$'))[1]::integer)
    INTO v_max
  FROM public.jobs
  WHERE job_no ~ '^JOB-\d+$';

  IF v_max IS NULL THEN
    PERFORM setval('public.job_no_seq', 1, false);
  ELSE
    PERFORM setval('public.job_no_seq', v_max, true);
  END IF;
END
$$;

-- ---------------------------------------------------------------------
-- Post-bootstrap notes
-- ---------------------------------------------------------------------
-- 1. Create your first auth user through the app or Auth dashboard.
-- 2. Make that user a super admin:
--      INSERT INTO public.user_roles (user_id, role)
--      VALUES ('<user-uuid>', 'super_admin')
--      ON CONFLICT (user_id, role) DO NOTHING;
-- 3. Set Gemini keys later from the Users page or as deployment secrets.
-- 4. Redeploy the edge functions after the database is ready.
