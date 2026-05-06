-- Stop duplicate job-generated billing documents and stock issue rows,
-- then clean up any duplicates already created.

WITH ranked_invoices AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        CASE
          WHEN job_id IS NOT NULL THEN 'job:' || job_id::text || ':' || COALESCE(doc_type, '')
          WHEN NULLIF(BTRIM(invoice_no), '') IS NOT NULL THEN 'invoice:' || UPPER(BTRIM(invoice_no))
          WHEN NULLIF(BTRIM(plate), '') IS NOT NULL THEN 'plate:' || regexp_replace(UPPER(BTRIM(plate)), '\s+', '', 'g') || ':' || COALESCE(doc_type, '')
          ELSE 'row:' || id::text
        END
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS rn
  FROM public.invoices
)
DELETE FROM public.invoices
WHERE id IN (
  SELECT id
  FROM ranked_invoices
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS invoices_job_id_doc_type_unique
  ON public.invoices (job_id, doc_type)
  WHERE job_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_no_unique
  ON public.invoices ((UPPER(BTRIM(invoice_no))))
  WHERE NULLIF(BTRIM(invoice_no), '') IS NOT NULL;

WITH ranked_job_line_movements AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY reference
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.stock_movements
  WHERE reference LIKE 'job-line:%'
),
ranked_request_movements AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY reference
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.stock_movements
  WHERE reference LIKE 'part_request:%'
)
DELETE FROM public.stock_movements
WHERE id IN (
  SELECT id FROM ranked_job_line_movements WHERE rn > 1
  UNION ALL
  SELECT id FROM ranked_request_movements WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_generated_reference_unique
  ON public.stock_movements (reference)
  WHERE reference LIKE 'job-line:%' OR reference LIKE 'part_request:%';

DROP POLICY IF EXISTS "staff update movements" ON public.stock_movements;
CREATE POLICY "staff update movements"
  ON public.stock_movements FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'storekeeper')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'storekeeper')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  );
