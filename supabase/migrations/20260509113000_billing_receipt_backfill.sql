-- Align legacy billing documents with job-card financial snapshots
-- and ensure every billed / paid job has a receipt row.

WITH job_finance AS (
  SELECT
    j.id,
    j.job_no,
    j.plate,
    j.vehicle_id,
    j.client_id,
    j.service_type,
    j.started_at,
    j.completed_at,
    j.paid_at,
    j.customer_phone,
    j.mechanic,
    j.reported_problem,
    j.complaint,
    j.work_performed,
    j.status,
    j.discount_reason,
    j.payer_type,
    j.payer_name,
    j.payment_bypass,
    j.payment_bypass_reason,
    j.payment_bypass_authorized_by,
    GREATEST(COALESCE(j.quotation_amount, 0), 0) AS quotation_amount,
    GREATEST(COALESCE(j.invoice_amount, 0), 0) AS invoice_amount,
    GREATEST(COALESCE(j.receipt_amount, 0), 0) AS receipt_amount,
    GREATEST(COALESCE(j.discount_amount, 0), 0) AS discount_amount,
    CASE
      WHEN COALESCE(j.payment_bypass, false) THEN 0
      WHEN COALESCE(j.receipt_amount, 0) > 0 THEN GREATEST(COALESCE(j.receipt_amount, 0), 0)
      WHEN j.status = 'closed' OR j.paid_at IS NOT NULL
        THEN GREATEST(COALESCE(j.invoice_amount, 0), COALESCE(j.quotation_amount, 0), COALESCE(j.estimate, 0), 0)
      ELSE 0
    END AS receipt_total
  FROM public.jobs j
)
UPDATE public.invoices i
SET
  plate = jf.plate,
  vehicle_id = jf.vehicle_id,
  client_id = jf.client_id,
  service_type = COALESCE(jf.service_type, i.service_type, 'service'),
  parts_source = COALESCE(i.parts_source, 'job_card'),
  time_in = jf.started_at,
  time_out = CASE
    WHEN i.doc_type = 'quotation' THEN NULL
    WHEN i.doc_type = 'deposit_invoice' THEN NULL
    WHEN i.doc_type = 'receipt' THEN COALESCE(jf.paid_at, jf.completed_at, i.time_out)
    ELSE COALESCE(jf.completed_at, jf.paid_at, i.time_out)
  END,
  date = CASE
    WHEN i.doc_type = 'quotation' THEN COALESCE(jf.started_at::date, i.date)
    WHEN i.doc_type = 'deposit_invoice' THEN COALESCE(jf.started_at::date, i.date)
    WHEN i.doc_type = 'receipt' THEN COALESCE(jf.paid_at::date, jf.completed_at::date, i.date)
    ELSE COALESCE(jf.completed_at::date, jf.started_at::date, i.date)
  END,
  amount = CASE
    WHEN i.doc_type = 'quotation' THEN jf.quotation_amount
    WHEN i.doc_type = 'invoice' THEN jf.invoice_amount + jf.discount_amount
    WHEN i.doc_type = 'receipt' THEN jf.receipt_total
    ELSE i.amount
  END,
  discount = CASE
    WHEN i.doc_type IN ('quotation', 'invoice') THEN jf.discount_amount
    WHEN i.doc_type = 'receipt' THEN 0
    ELSE i.discount
  END,
  discount_by = CASE
    WHEN i.doc_type IN ('quotation', 'invoice') THEN NULLIF(BTRIM(COALESCE(jf.discount_reason, '')), '')
    WHEN i.doc_type = 'receipt' THEN NULL
    ELSE i.discount_by
  END,
  amount_paid = CASE
    WHEN i.doc_type = 'invoice' THEN CASE WHEN jf.payment_bypass THEN 0 ELSE jf.receipt_amount END
    WHEN i.doc_type = 'receipt' THEN jf.receipt_total
    ELSE i.amount_paid
  END,
  technicians = COALESCE(jf.mechanic, i.technicians),
  customer_phone = COALESCE(jf.customer_phone, i.customer_phone),
  status = CASE
    WHEN i.doc_type = 'quotation' THEN CASE WHEN jf.status <> 'diagnosis' THEN 'issued' ELSE 'draft' END
    WHEN i.doc_type = 'invoice' THEN CASE
      WHEN jf.payment_bypass THEN 'bypassed'
      WHEN jf.receipt_amount >= jf.invoice_amount AND jf.invoice_amount > 0 THEN 'paid'
      WHEN jf.invoice_amount > 0 THEN 'issued'
      ELSE 'draft'
    END
    WHEN i.doc_type = 'receipt' THEN CASE WHEN jf.receipt_total > 0 THEN 'paid' ELSE i.status END
    ELSE i.status
  END,
  notes = CASE
    WHEN i.doc_type = 'receipt' THEN COALESCE(NULLIF(BTRIM(jf.work_performed), ''), NULLIF(BTRIM(jf.reported_problem), ''), NULLIF(BTRIM(jf.complaint), ''), 'Customer payment received.')
    WHEN i.doc_type IN ('quotation', 'invoice') THEN COALESCE(NULLIF(BTRIM(jf.work_performed), ''), NULLIF(BTRIM(jf.reported_problem), ''), NULLIF(BTRIM(jf.complaint), ''), i.notes)
    ELSE i.notes
  END,
  payer_type = COALESCE(NULLIF(BTRIM(COALESCE(jf.payer_type, '')), ''), i.payer_type, 'client'),
  payer_name = COALESCE(NULLIF(BTRIM(COALESCE(jf.payer_name, '')), ''), i.payer_name),
  is_payment_bypassed = CASE WHEN i.doc_type = 'invoice' THEN COALESCE(jf.payment_bypass, false) ELSE COALESCE(i.is_payment_bypassed, false) END,
  payment_bypass_reason = CASE WHEN i.doc_type = 'invoice' AND jf.payment_bypass THEN jf.payment_bypass_reason ELSE i.payment_bypass_reason END,
  payment_bypass_authorized_by = CASE WHEN i.doc_type = 'invoice' AND jf.payment_bypass THEN jf.payment_bypass_authorized_by ELSE i.payment_bypass_authorized_by END
FROM job_finance jf
WHERE i.job_id = jf.id
  AND i.doc_type IN ('quotation', 'invoice', 'receipt');

INSERT INTO public.invoices (
  invoice_no,
  plate,
  vehicle_id,
  client_id,
  service_type,
  parts_source,
  time_in,
  time_out,
  date,
  amount,
  discount,
  discount_by,
  amount_paid,
  technicians,
  customer_phone,
  status,
  notes,
  job_id,
  doc_type,
  payer_type,
  payer_name,
  payment_mode,
  is_payment_bypassed,
  payment_bypass_reason,
  payment_bypass_authorized_by
)
SELECT
  'Q-' || jf.job_no,
  jf.plate,
  jf.vehicle_id,
  jf.client_id,
  COALESCE(jf.service_type, 'service'),
  'job_card',
  jf.started_at,
  NULLIF(BTRIM(COALESCE(jf.discount_reason, '')), ''),
  COALESCE(jf.started_at::date, CURRENT_DATE),
  jf.quotation_amount,
  jf.discount_amount,
  NULLIF(BTRIM(COALESCE(jf.discount_reason, '')), ''),
  0,
  jf.mechanic,
  jf.customer_phone,
  CASE WHEN jf.status <> 'diagnosis' THEN 'issued' ELSE 'draft' END,
  COALESCE(NULLIF(BTRIM(jf.reported_problem), ''), NULLIF(BTRIM(jf.complaint), '')),
  jf.id,
  'quotation',
  COALESCE(NULLIF(BTRIM(COALESCE(jf.payer_type, '')), ''), 'client'),
  NULLIF(BTRIM(COALESCE(jf.payer_name, '')), ''),
  'cash',
  false,
  NULL,
  NULL
FROM job_finance jf
LEFT JOIN public.invoices existing
  ON existing.job_id = jf.id
 AND existing.doc_type = 'quotation'
WHERE existing.id IS NULL
  AND jf.quotation_amount > 0;

INSERT INTO public.invoices (
  invoice_no,
  plate,
  vehicle_id,
  client_id,
  service_type,
  parts_source,
  time_in,
  time_out,
  date,
  amount,
  discount,
  discount_by,
  amount_paid,
  technicians,
  customer_phone,
  status,
  notes,
  job_id,
  doc_type,
  payer_type,
  payer_name,
  payment_mode,
  payment_reference,
  is_payment_bypassed,
  payment_bypass_reason,
  payment_bypass_authorized_by
)
SELECT
  'INV-' || jf.job_no,
  jf.plate,
  jf.vehicle_id,
  jf.client_id,
  COALESCE(jf.service_type, 'service'),
  'job_card',
  jf.started_at,
  COALESCE(jf.completed_at, jf.paid_at),
  COALESCE(jf.completed_at::date, jf.started_at::date, CURRENT_DATE),
  jf.invoice_amount + jf.discount_amount,
  jf.discount_amount,
  NULL,
  CASE WHEN jf.payment_bypass THEN 0 ELSE jf.receipt_amount END,
  jf.mechanic,
  jf.customer_phone,
  CASE
    WHEN jf.payment_bypass THEN 'bypassed'
    WHEN jf.receipt_amount >= jf.invoice_amount AND jf.invoice_amount > 0 THEN 'paid'
    ELSE 'issued'
  END,
  COALESCE(NULLIF(BTRIM(jf.work_performed), ''), NULLIF(BTRIM(jf.reported_problem), ''), NULLIF(BTRIM(jf.complaint), '')),
  jf.id,
  'invoice',
  COALESCE(NULLIF(BTRIM(COALESCE(jf.payer_type, '')), ''), 'client'),
  NULLIF(BTRIM(COALESCE(jf.payer_name, '')), ''),
  'cash',
  NULL,
  COALESCE(jf.payment_bypass, false),
  jf.payment_bypass_reason,
  jf.payment_bypass_authorized_by
FROM job_finance jf
LEFT JOIN public.invoices existing
  ON existing.job_id = jf.id
 AND existing.doc_type = 'invoice'
WHERE existing.id IS NULL
  AND jf.invoice_amount > 0;

INSERT INTO public.invoices (
  invoice_no,
  plate,
  vehicle_id,
  client_id,
  service_type,
  parts_source,
  time_in,
  time_out,
  date,
  amount,
  discount,
  discount_by,
  amount_paid,
  technicians,
  customer_phone,
  status,
  notes,
  job_id,
  doc_type,
  payer_type,
  payer_name,
  payment_mode,
  payment_reference,
  is_payment_bypassed
)
SELECT
  'RC-' || jf.job_no,
  jf.plate,
  jf.vehicle_id,
  jf.client_id,
  COALESCE(jf.service_type, 'service'),
  'job_card',
  jf.started_at,
  COALESCE(jf.paid_at, jf.completed_at),
  COALESCE(jf.paid_at::date, jf.completed_at::date, CURRENT_DATE),
  jf.receipt_total,
  0,
  NULL,
  jf.receipt_total,
  jf.mechanic,
  jf.customer_phone,
  'paid',
  COALESCE(NULLIF(BTRIM(jf.work_performed), ''), NULLIF(BTRIM(jf.reported_problem), ''), NULLIF(BTRIM(jf.complaint), ''), 'Customer payment received.'),
  jf.id,
  'receipt',
  COALESCE(NULLIF(BTRIM(COALESCE(jf.payer_type, '')), ''), 'client'),
  NULLIF(BTRIM(COALESCE(jf.payer_name, '')), ''),
  'cash',
  NULL,
  false
FROM job_finance jf
LEFT JOIN public.invoices existing
  ON existing.job_id = jf.id
 AND existing.doc_type = 'receipt'
WHERE existing.id IS NULL
  AND jf.receipt_total > 0;
