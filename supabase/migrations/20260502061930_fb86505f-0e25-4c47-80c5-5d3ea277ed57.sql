
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS diagnosis_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS diagnosis_approval_rating integer,
  ADD COLUMN IF NOT EXISTS diagnosis_approval_comment text,
  ADD COLUMN IF NOT EXISTS parts_fit_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS parts_fit_approved_by uuid;

DROP FUNCTION IF EXISTS public.get_job_for_feedback(text);

CREATE OR REPLACE FUNCTION public.get_job_for_feedback(_token text)
 RETURNS TABLE(
   id uuid, job_no text, plate text, vehicle_label text, customer_name text,
   reported_problem text, work_performed text, status text, invoice_amount numeric,
   client_approved_at timestamptz, client_rating integer,
   ai_diagnostic_summary text, recommended_parts jsonb, estimate numeric,
   diagnosis_approved_at timestamptz
 )
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT id, job_no, plate, vehicle_label, customer_name, reported_problem,
         work_performed, status, invoice_amount, client_approved_at, client_rating,
         ai_diagnostic_summary, recommended_parts, estimate, diagnosis_approved_at
  FROM public.jobs
  WHERE client_feedback_token = _token
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.submit_diagnosis_approval(_token text, _rating integer, _comment text)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.jobs WHERE client_feedback_token = _token;
  IF v_id IS NULL THEN RETURN false; END IF;
  UPDATE public.jobs
     SET diagnosis_approved_at = now(),
         diagnosis_approval_rating = LEAST(GREATEST(COALESCE(_rating,5),1),5),
         diagnosis_approval_comment = _comment,
         status = CASE WHEN status = 'diagnosis_approval' THEN 'parts' ELSE status END
   WHERE id = v_id;
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_parts_for_fitting(_job_id uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (
    public.has_role(auth.uid(),'mechanic') OR
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'storekeeper')
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
$function$;
