-- Harden duplicate-prone operational flows against retries / unstable connectivity.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS client_request_id text;

ALTER TABLE public.part_requests
  ADD COLUMN IF NOT EXISTS client_request_id text;

ALTER TABLE public.gate_pass_requests
  ADD COLUMN IF NOT EXISTS client_request_id text;

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

CREATE UNIQUE INDEX IF NOT EXISTS jobs_client_request_id_unique
  ON public.jobs (client_request_id)
  WHERE NULLIF(BTRIM(client_request_id), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS part_requests_client_request_id_unique
  ON public.part_requests (client_request_id)
  WHERE NULLIF(BTRIM(client_request_id), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_requests_client_request_id_unique
  ON public.gate_pass_requests (client_request_id)
  WHERE NULLIF(BTRIM(client_request_id), '') IS NOT NULL;
