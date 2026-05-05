-- 1) Mechanic specialties (multi-tag)
ALTER TABLE public.mechanics
  ADD COLUMN IF NOT EXISTS specialties text[] NOT NULL DEFAULT '{}'::text[];

-- 2) Jobs: assigned mechanic id + client feedback token + rating
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS assigned_mechanic_id uuid,
  ADD COLUMN IF NOT EXISTS client_feedback_token text UNIQUE
    DEFAULT encode(gen_random_bytes(12), 'hex'),
  ADD COLUMN IF NOT EXISTS client_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_rating int;

-- Backfill tokens for existing jobs that don't have one
UPDATE public.jobs
SET client_feedback_token = encode(gen_random_bytes(12), 'hex')
WHERE client_feedback_token IS NULL;

-- 3) Link part_requests to a job_line_items row (so we can auto-sync)
ALTER TABLE public.job_line_items
  ADD COLUMN IF NOT EXISTS part_request_id uuid;

CREATE INDEX IF NOT EXISTS idx_jli_part_request ON public.job_line_items(part_request_id);

-- 4) Trigger: when a part_request is inserted as 'pending' OR moves to approved/issued,
--    upsert a corresponding line item on the job. When deleted/rejected, remove it.
CREATE OR REPLACE FUNCTION public.sync_part_request_to_line_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_part_id uuid;
  v_unit_price numeric := 0;
  v_pos int;
  v_existing uuid;
BEGIN
  IF NEW.job_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- skip tools - financial summary is for parts only
  IF NEW.kind <> 'part' THEN
    RETURN NEW;
  END IF;

  -- if rejected, remove any existing linked line
  IF NEW.status = 'rejected' THEN
    DELETE FROM public.job_line_items WHERE part_request_id = NEW.id;
    RETURN NEW;
  END IF;

  -- try to match the requested item to a stocked part by name
  SELECT id, unit_price INTO v_part_id, v_unit_price
  FROM public.parts
  WHERE lower(name) = lower(NEW.item_name)
  LIMIT 1;

  -- existing line for this request?
  SELECT id INTO v_existing FROM public.job_line_items WHERE part_request_id = NEW.id LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.job_line_items
       SET description = NEW.item_name,
           qty = NEW.qty,
           part_id = v_part_id,
           unit_price = COALESCE(NULLIF(unit_price,0), v_unit_price, 0),
           updated_at = now()
     WHERE id = v_existing;
  ELSE
    SELECT COALESCE(MAX(position),0)+1 INTO v_pos FROM public.job_line_items WHERE job_id = NEW.job_id;
    INSERT INTO public.job_line_items (job_id, kind, source, position, description, qty, unit_price, part_id, part_request_id)
    VALUES (NEW.job_id, 'part', 'request', v_pos, NEW.item_name, NEW.qty, COALESCE(v_unit_price,0), v_part_id, NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_part_request_ai ON public.part_requests;
CREATE TRIGGER trg_sync_part_request_ai
AFTER INSERT OR UPDATE ON public.part_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_part_request_to_line_item();

-- When request deleted, remove its line
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
DROP TRIGGER IF EXISTS trg_sync_part_request_del ON public.part_requests;
CREATE TRIGGER trg_sync_part_request_del
AFTER DELETE ON public.part_requests
FOR EACH ROW EXECUTE FUNCTION public.cleanup_part_request_line();

-- 5) Public read policy for client feedback page (token-protected app side)
-- We allow anon read of a single job by token via an RPC instead of broad RLS.
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
  client_rating int
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, job_no, plate, vehicle_label, customer_name, reported_problem,
         work_performed, status, invoice_amount, client_approved_at, client_rating
  FROM public.jobs
  WHERE client_feedback_token = _token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.submit_client_feedback(
  _token text, _rating int, _comment text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.jobs WHERE client_feedback_token = _token;
  IF v_id IS NULL THEN RETURN false; END IF;
  UPDATE public.jobs
     SET client_rating = LEAST(GREATEST(_rating,1),5),
         customer_feedback = _comment,
         client_approved_at = now(),
         feedback_rating = LEAST(GREATEST(_rating,1),5),
         status = CASE WHEN status = 'awaiting_approval' THEN 'completed' ELSE status END
   WHERE id = v_id;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_job_for_feedback(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_client_feedback(text, int, text) TO anon, authenticated;