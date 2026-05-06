-- Return-visit tracking, richer petty cash metadata, and admin access to intake photos

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS return_visit_type text,
  ADD COLUMN IF NOT EXISTS return_visit_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jobs_return_visit_type_check'
  ) THEN
    ALTER TABLE public.jobs
      ADD CONSTRAINT jobs_return_visit_type_check
      CHECK (
        return_visit_type IS NULL
        OR return_visit_type IN ('same_problem', 'related_problem', 'new_problem')
      );
  END IF;
END $$;

ALTER TABLE public.petty_cash_entries
  ADD COLUMN IF NOT EXISTS contact text,
  ADD COLUMN IF NOT EXISTS transaction_time text;

DROP POLICY IF EXISTS "Super admins read job card photos" ON public.job_card_photos;
DROP POLICY IF EXISTS "Admins read job card photos" ON public.job_card_photos;
CREATE POLICY "Admins read job card photos"
  ON public.job_card_photos FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'director')
    OR public.has_role(auth.uid(), 'manager')
  );

DROP POLICY IF EXISTS "Super admins read job-card-photos" ON storage.objects;
DROP POLICY IF EXISTS "Admins read job-card-photos" ON storage.objects;
CREATE POLICY "Admins read job-card-photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'job-card-photos'
    AND (
      public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'director')
      OR public.has_role(auth.uid(), 'manager')
    )
  );
