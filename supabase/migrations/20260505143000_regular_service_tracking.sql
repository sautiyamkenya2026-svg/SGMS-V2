ALTER TABLE public.inspection_findings
  ADD COLUMN IF NOT EXISTS last_service TEXT,
  ADD COLUMN IF NOT EXISTS next_due TEXT;
