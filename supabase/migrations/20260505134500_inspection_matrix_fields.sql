ALTER TABLE public.inspection_findings
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS action_required TEXT,
  ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC,
  ADD COLUMN IF NOT EXISTS assigned_technician TEXT,
  ADD COLUMN IF NOT EXISTS time_estimate_minutes INT,
  ADD COLUMN IF NOT EXISTS client_authorized BOOLEAN NOT NULL DEFAULT false;

UPDATE public.inspection_findings
SET category = CASE
  WHEN system IN ('underhood', 'road-test', 'brakes-suspension', 'wheels') THEN 'mechanical'
  WHEN system IN ('lights', 'electrical') THEN 'electrical'
  WHEN system IN ('exterior', 'body-panels', 'doors', 'interior') THEN 'bodywork'
  ELSE category
END
WHERE category IS NULL;
