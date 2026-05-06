-- Tronix memory, finance sync support, client source tracking, and private job card photos

-- Make Groq the live default for every AI route unless a super admin changes it later.
INSERT INTO public.app_settings (key, value)
VALUES
  ('ai_default_provider', 'groq'),
  ('ai_chat_provider', 'groq'),
  ('ai_analysis_provider', 'groq'),
  ('ai_image_provider', 'groq')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

-- Lightweight long-term memory for Tronix so profile facts can survive long chat histories.
CREATE TABLE IF NOT EXISTS public.tronix_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_key text NOT NULL,
  memory_value text NOT NULL,
  source text NOT NULL DEFAULT 'chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, memory_key)
);

CREATE INDEX IF NOT EXISTS idx_tronix_memories_user
  ON public.tronix_memories (user_id, updated_at DESC);

ALTER TABLE public.tronix_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read their own Tronix memories" ON public.tronix_memories;
CREATE POLICY "Users read their own Tronix memories"
  ON public.tronix_memories FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage their own Tronix memories" ON public.tronix_memories;
CREATE POLICY "Users manage their own Tronix memories"
  ON public.tronix_memories FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access tronix_memories" ON public.tronix_memories;
CREATE POLICY "Service role full access tronix_memories"
  ON public.tronix_memories FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

DROP TRIGGER IF EXISTS trg_tronix_memories_updated ON public.tronix_memories;
CREATE TRIGGER trg_tronix_memories_updated
BEFORE UPDATE ON public.tronix_memories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Job-level intake, payer, deposit, and bypass fields.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS lead_source text,
  ADD COLUMN IF NOT EXISTS lead_source_detail text,
  ADD COLUMN IF NOT EXISTS deposit_required numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payer_type text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS payer_name text,
  ADD COLUMN IF NOT EXISTS payment_bypass boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_bypass_reason text,
  ADD COLUMN IF NOT EXISTS payment_bypass_authorized_by text;

-- Mirror the same fields on generated billing documents.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payer_type text NOT NULL DEFAULT 'client',
  ADD COLUMN IF NOT EXISTS payer_name text,
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS is_payment_bypassed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_bypass_reason text,
  ADD COLUMN IF NOT EXISTS payment_bypass_authorized_by text;

-- Private job-card intake photos. Super admins are the only ones allowed to view them.
CREATE TABLE IF NOT EXISTS public.job_card_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid,
  is_private boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_card_photos_job
  ON public.job_card_photos (job_id, created_at DESC);

ALTER TABLE public.job_card_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins read job card photos" ON public.job_card_photos;
CREATE POLICY "Super admins read job card photos"
  ON public.job_card_photos FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Staff insert job card photos" ON public.job_card_photos;
CREATE POLICY "Staff insert job card photos"
  ON public.job_card_photos FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff update job card photos" ON public.job_card_photos;
CREATE POLICY "Staff update job card photos"
  ON public.job_card_photos FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Staff delete job card photos" ON public.job_card_photos;
CREATE POLICY "Staff delete job card photos"
  ON public.job_card_photos FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

INSERT INTO storage.buckets (id, name, public)
VALUES ('job-card-photos', 'job-card-photos', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Super admins read job-card-photos" ON storage.objects;
CREATE POLICY "Super admins read job-card-photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'job-card-photos'
    AND public.has_role(auth.uid(), 'super_admin')
  );

DROP POLICY IF EXISTS "Staff upload job-card-photos" ON storage.objects;
CREATE POLICY "Staff upload job-card-photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'job-card-photos');

DROP POLICY IF EXISTS "Staff update job-card-photos" ON storage.objects;
CREATE POLICY "Staff update job-card-photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'job-card-photos')
  WITH CHECK (bucket_id = 'job-card-photos');

DROP POLICY IF EXISTS "Staff delete job-card-photos" ON storage.objects;
CREATE POLICY "Staff delete job-card-photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'job-card-photos');

-- When an in-house part request is issued to a job, create the linked stock sale once.
CREATE OR REPLACE FUNCTION public.sync_issued_part_request_to_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_part_id uuid;
  v_loc_id uuid;
  v_job_no text;
  v_unit_cost numeric := 0;
  v_unit_price numeric := 0;
  v_reference text;
BEGIN
  IF NEW.kind <> 'part' OR NEW.source <> 'in_house' OR NEW.status <> 'issued' OR NEW.job_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_reference := 'part_request:' || NEW.id::text;

  IF EXISTS (
    SELECT 1
    FROM public.stock_movements
    WHERE reference = v_reference
  ) THEN
    RETURN NEW;
  END IF;

  SELECT p.id, COALESCE(p.unit_cost, 0), COALESCE(NULLIF(NEW.estimated_unit_price, 0), p.unit_price, 0)
    INTO v_part_id, v_unit_cost, v_unit_price
  FROM public.parts p
  WHERE lower(p.name) = lower(NEW.item_name)
  LIMIT 1;

  IF v_part_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id
    INTO v_loc_id
  FROM public.locations
  WHERE kind = 'garage_store'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_loc_id IS NULL THEN
    SELECT id
      INTO v_loc_id
    FROM public.locations
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;

  IF v_loc_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT job_no
    INTO v_job_no
  FROM public.jobs
  WHERE id = NEW.job_id;

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
    created_by,
    job_id
  )
  VALUES (
    v_part_id,
    v_loc_id,
    'sale',
    NEW.qty,
    v_unit_price,
    v_reference,
    COALESCE('Issued from request for ' || v_job_no, 'Issued from request'),
    v_unit_cost,
    v_unit_price,
    NEW.approved_by,
    NEW.job_id
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_part_request_issue_stock_sync ON public.part_requests;
CREATE TRIGGER trg_part_request_issue_stock_sync
AFTER INSERT OR UPDATE ON public.part_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_issued_part_request_to_stock();
