-- Harden duplicate-prone operational flows against retries / unstable connectivity.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS client_request_id text;

ALTER TABLE public.part_requests
  ADD COLUMN IF NOT EXISTS client_request_id text;

ALTER TABLE public.gate_pass_requests
  ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE OR REPLACE FUNCTION public.normalize_client_request_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.client_request_id := NULLIF(BTRIM(NEW.client_request_id), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS normalize_jobs_client_request_id ON public.jobs;
CREATE TRIGGER normalize_jobs_client_request_id
BEFORE INSERT OR UPDATE ON public.jobs
FOR EACH ROW
EXECUTE FUNCTION public.normalize_client_request_id();

DROP TRIGGER IF EXISTS normalize_part_requests_client_request_id ON public.part_requests;
CREATE TRIGGER normalize_part_requests_client_request_id
BEFORE INSERT OR UPDATE ON public.part_requests
FOR EACH ROW
EXECUTE FUNCTION public.normalize_client_request_id();

DROP TRIGGER IF EXISTS normalize_gate_pass_requests_client_request_id ON public.gate_pass_requests;
CREATE TRIGGER normalize_gate_pass_requests_client_request_id
BEFORE INSERT OR UPDATE ON public.gate_pass_requests
FOR EACH ROW
EXECUTE FUNCTION public.normalize_client_request_id();

UPDATE public.jobs
SET client_request_id = NULLIF(BTRIM(client_request_id), '')
WHERE client_request_id IS DISTINCT FROM NULLIF(BTRIM(client_request_id), '');

UPDATE public.part_requests
SET client_request_id = NULLIF(BTRIM(client_request_id), '')
WHERE client_request_id IS DISTINCT FROM NULLIF(BTRIM(client_request_id), '');

UPDATE public.gate_pass_requests
SET client_request_id = NULLIF(BTRIM(client_request_id), '')
WHERE client_request_id IS DISTINCT FROM NULLIF(BTRIM(client_request_id), '');

WITH ranked_jobs AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY client_request_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.jobs
  WHERE client_request_id IS NOT NULL
)
UPDATE public.jobs
SET client_request_id = NULL
WHERE id IN (
  SELECT id
  FROM ranked_jobs
  WHERE rn > 1
);

WITH ranked_part_requests AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY client_request_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.part_requests
  WHERE client_request_id IS NOT NULL
)
UPDATE public.part_requests
SET client_request_id = NULL
WHERE id IN (
  SELECT id
  FROM ranked_part_requests
  WHERE rn > 1
);

WITH ranked_gate_pass_requests AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY client_request_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.gate_pass_requests
  WHERE client_request_id IS NOT NULL
)
UPDATE public.gate_pass_requests
SET client_request_id = NULL
WHERE id IN (
  SELECT id
  FROM ranked_gate_pass_requests
  WHERE rn > 1
);

WITH ranked_tool_checkins AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tool_id, period
      ORDER BY checked_at DESC, id DESC
    ) AS rn
  FROM public.tool_checkins
)
DELETE FROM public.tool_checkins
WHERE id IN (
  SELECT id
  FROM ranked_tool_checkins
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_checkins_tool_id_period_unique
  ON public.tool_checkins (tool_id, period);

WITH ranked_job_card_photos AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY job_id, kind
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.job_card_photos
)
DELETE FROM public.job_card_photos
WHERE id IN (
  SELECT id
  FROM ranked_job_card_photos
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS job_card_photos_job_id_kind_unique
  ON public.job_card_photos (job_id, kind);

WITH ranked_gate_passes AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY job_id
      ORDER BY issued_at DESC, id DESC
    ) AS rn
  FROM public.gate_passes
)
DELETE FROM public.gate_passes
WHERE id IN (
  SELECT id
  FROM ranked_gate_passes
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS gate_passes_job_id_unique
  ON public.gate_passes (job_id);

DROP INDEX IF EXISTS public.jobs_client_request_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_client_request_id_unique
  ON public.jobs (client_request_id);

DROP INDEX IF EXISTS public.part_requests_client_request_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS part_requests_client_request_id_unique
  ON public.part_requests (client_request_id);

DROP INDEX IF EXISTS public.gate_pass_requests_client_request_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_requests_client_request_id_unique
  ON public.gate_pass_requests (client_request_id);
