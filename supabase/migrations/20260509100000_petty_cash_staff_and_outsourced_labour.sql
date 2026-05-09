ALTER TABLE public.petty_cash_entries
  ADD COLUMN IF NOT EXISTS staff_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_petty_cash_staff_user_date
  ON public.petty_cash_entries (staff_user_id, date DESC);

ALTER TABLE public.job_line_items
  ADD COLUMN IF NOT EXISTS labour_source text NOT NULL DEFAULT 'inhouse',
  ADD COLUMN IF NOT EXISTS labour_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS labour_charge_to text NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS labour_payment_mode text,
  ADD COLUMN IF NOT EXISTS labour_payment_reference text;

CREATE INDEX IF NOT EXISTS idx_job_line_items_labour_supplier
  ON public.job_line_items (labour_supplier_id);

UPDATE public.job_line_items
SET
  labour_source = COALESCE(NULLIF(labour_source, ''), 'inhouse'),
  labour_charge_to = COALESCE(NULLIF(labour_charge_to, ''), 'company')
WHERE kind = 'labour';

WITH staff_candidates AS (
  SELECT DISTINCT ON (entry_id)
    entry_id,
    profile_id
  FROM (
    SELECT
      entry.id AS entry_id,
      profile.id AS profile_id,
      CASE
        WHEN entry_phone <> '' AND entry_name <> '' AND entry_phone = profile_phone AND entry_name = profile_name THEN 0
        WHEN entry_phone <> '' AND entry_phone = profile_phone THEN 1
        WHEN entry_name <> '' AND entry_name = profile_name THEN 2
        ELSE 9
      END AS match_rank
    FROM (
      SELECT
        p.id,
        LOWER(REGEXP_REPLACE(COALESCE(p.payee, ''), '[^a-z0-9]+', '', 'g')) AS entry_name,
        RIGHT(REGEXP_REPLACE(COALESCE(p.contact, ''), '\D', '', 'g'), 9) AS entry_phone
      FROM public.petty_cash_entries p
      WHERE p.type = 'payment'
        AND p.staff_user_id IS NULL
    ) entry
    JOIN (
      SELECT
        profile.id,
        LOWER(REGEXP_REPLACE(COALESCE(profile.display_name, ''), '[^a-z0-9]+', '', 'g')) AS profile_name,
        RIGHT(REGEXP_REPLACE(COALESCE(profile.phone, ''), '\D', '', 'g'), 9) AS profile_phone
      FROM public.profiles profile
      WHERE EXISTS (
        SELECT 1
        FROM public.user_roles role
        WHERE role.user_id = profile.id
          AND role.role <> 'client'
      )
    ) profile
      ON (
        (entry.entry_phone <> '' AND entry.entry_phone = profile.profile_phone)
        OR (entry.entry_name <> '' AND entry.entry_name = profile.profile_name)
      )
    WHERE (
      (entry.entry_phone <> '' AND entry.entry_phone = profile.profile_phone)
      OR (entry.entry_name <> '' AND entry.entry_name = profile.profile_name)
    )
  ) ranked
  WHERE match_rank < 9
  ORDER BY entry_id, match_rank, profile_id
)
UPDATE public.petty_cash_entries entry
SET staff_user_id = candidate.profile_id
FROM staff_candidates candidate
WHERE entry.id = candidate.entry_id
  AND entry.staff_user_id IS NULL;
