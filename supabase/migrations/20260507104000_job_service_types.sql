-- Allow check-in to tag a job with several service types while keeping the
-- legacy single service_type column for primary classification.
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS service_types text[] NOT NULL DEFAULT ARRAY[]::text[];

UPDATE public.jobs
SET service_types = ARRAY[service_type]
WHERE COALESCE(array_length(service_types, 1), 0) = 0
  AND NULLIF(BTRIM(service_type), '') IS NOT NULL;
