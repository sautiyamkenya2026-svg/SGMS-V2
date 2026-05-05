
-- Jobs: insurance + reported problem (rename via additional column kept for bw-compat) + work performed + recommended parts JSON + AI summary + financial summary + quotation/invoice/receipt amounts + discount
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS has_insurance boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS insurance_company text,
  ADD COLUMN IF NOT EXISTS insurance_policy_no text,
  ADD COLUMN IF NOT EXISTS reported_problem text,
  ADD COLUMN IF NOT EXISTS work_performed text,
  ADD COLUMN IF NOT EXISTS ai_diagnostic_summary text,
  ADD COLUMN IF NOT EXISTS recommended_parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS financial_summary text,
  ADD COLUMN IF NOT EXISTS quotation_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invoice_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receipt_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_reason text;

-- Backfill reported_problem from complaint
UPDATE public.jobs SET reported_problem = complaint WHERE reported_problem IS NULL AND complaint IS NOT NULL;

-- Petty cash: payment mode (cash, mpesa, bank, card, cheque)
ALTER TABLE public.petty_cash_entries
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_reference text;

-- Suppliers: rename concept "purpose" → "description" (keep purpose column for bw-compat, add description)
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS description text;
UPDATE public.suppliers SET description = purpose WHERE description IS NULL AND purpose IS NOT NULL;
