
-- 1) Add new roles to enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'director';

-- 2) Job: diagnosis approval code (6 digits) + flags
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS diagnosis_approval_code text,
  ADD COLUMN IF NOT EXISTS diagnosis_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS requires_internal_parts_approval boolean NOT NULL DEFAULT false;

-- Backfill codes for existing jobs lacking one
UPDATE public.jobs
   SET diagnosis_approval_code = lpad((floor(random()*1000000))::int::text, 6, '0')
 WHERE diagnosis_approval_code IS NULL;

-- 3) Part requests: source + pipeline status (we keep the existing status column,
--    but extend the allowed values informally — UI will use these new values)
ALTER TABLE public.part_requests
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'in_house',
  ADD COLUMN IF NOT EXISTS is_major boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS estimated_unit_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ordered_at timestamptz,
  ADD COLUMN IF NOT EXISTS in_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS internal_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS internal_approved_by uuid;

-- 4) App settings default for major-part threshold
INSERT INTO public.app_settings(key, value)
VALUES ('major_part_threshold_ksh', '20000')
ON CONFLICT (key) DO NOTHING;

-- 5) Allow everyone authenticated to read settings (so client UI can read threshold)
DROP POLICY IF EXISTS "auth read app_settings" ON public.app_settings;
CREATE POLICY "auth read app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (true);

-- 6) Verify diagnosis code RPC — staff enters the code the client gave them
CREATE OR REPLACE FUNCTION public.verify_diagnosis_code(_job_id uuid, _code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_code text; v_status text;
BEGIN
  IF NOT (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'reception') OR
    public.has_role(auth.uid(),'manager') OR
    public.has_role(auth.uid(),'director')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT diagnosis_approval_code, status INTO v_code, v_status
    FROM public.jobs WHERE id = _job_id;
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

-- 7) Update approve_parts_for_fitting to also accept manager/director
CREATE OR REPLACE FUNCTION public.approve_parts_for_fitting(_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(),'mechanic') OR
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'storekeeper') OR
    public.has_role(auth.uid(),'manager') OR
    public.has_role(auth.uid(),'director')
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

-- 8) Auto-flag major when estimated price * qty exceeds threshold
CREATE OR REPLACE FUNCTION public.auto_flag_major_part_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_thresh numeric;
BEGIN
  SELECT COALESCE(value::numeric, 20000) INTO v_thresh
    FROM public.app_settings WHERE key = 'major_part_threshold_ksh';
  IF NEW.is_major IS NOT TRUE
     AND NEW.kind = 'part'
     AND COALESCE(NEW.estimated_unit_price,0) * COALESCE(NEW.qty,1) >= COALESCE(v_thresh, 20000)
  THEN
    NEW.is_major := true;
  END IF;
  -- bubble flag to job: any major part forces internal parts approval gate
  IF NEW.is_major IS TRUE AND NEW.job_id IS NOT NULL THEN
    UPDATE public.jobs SET requires_internal_parts_approval = true WHERE id = NEW.job_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_flag_major ON public.part_requests;
CREATE TRIGGER trg_auto_flag_major
BEFORE INSERT OR UPDATE OF qty, estimated_unit_price, is_major
ON public.part_requests
FOR EACH ROW EXECUTE FUNCTION public.auto_flag_major_part_request();

-- 9) Update get_job_for_feedback to also expose code (so the client view can show it)
DROP FUNCTION IF EXISTS public.get_job_for_feedback(text);
CREATE OR REPLACE FUNCTION public.get_job_for_feedback(_token text)
 RETURNS TABLE(id uuid, job_no text, plate text, vehicle_label text, customer_name text,
   reported_problem text, work_performed text, status text, invoice_amount numeric,
   client_approved_at timestamptz, client_rating integer, ai_diagnostic_summary text,
   recommended_parts jsonb, estimate numeric, diagnosis_approved_at timestamptz,
   diagnosis_approval_code text, vehicle_make text, vehicle_model text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $$
  SELECT j.id, j.job_no, j.plate, j.vehicle_label, j.customer_name, j.reported_problem,
         j.work_performed, j.status, j.invoice_amount, j.client_approved_at, j.client_rating,
         j.ai_diagnostic_summary, j.recommended_parts, j.estimate, j.diagnosis_approved_at,
         j.diagnosis_approval_code,
         null::text as vehicle_make, null::text as vehicle_model
  FROM public.jobs j
  WHERE j.client_feedback_token = _token
  LIMIT 1;
$$;
