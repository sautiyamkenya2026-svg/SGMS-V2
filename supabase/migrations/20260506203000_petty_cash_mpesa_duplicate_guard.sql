-- Normalize M-PESA petty cash references/times and prevent duplicate transactions.

CREATE OR REPLACE FUNCTION public.normalize_petty_cash_reference(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT UPPER(regexp_replace(BTRIM(COALESCE(_value, '')), '\s+', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.normalize_petty_cash_transaction_time(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT UPPER(regexp_replace(BTRIM(COALESCE(_value, '')), '\s+', ' ', 'g'));
$$;

UPDATE public.petty_cash_entries
SET payment_mode = lower(COALESCE(payment_mode, 'cash')),
    payment_reference = NULLIF(public.normalize_petty_cash_reference(payment_reference), ''),
    transaction_time = NULLIF(public.normalize_petty_cash_transaction_time(transaction_time), '')
WHERE lower(COALESCE(payment_mode, 'cash')) = 'mpesa';

WITH ranked_mpesa_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        public.normalize_petty_cash_reference(payment_reference),
        amount,
        public.normalize_petty_cash_transaction_time(transaction_time)
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM public.petty_cash_entries
  WHERE lower(COALESCE(payment_mode, 'cash')) = 'mpesa'
    AND NULLIF(public.normalize_petty_cash_reference(payment_reference), '') IS NOT NULL
)
DELETE FROM public.petty_cash_entries
WHERE id IN (
  SELECT id
  FROM ranked_mpesa_duplicates
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS petty_cash_mpesa_reference_amount_time_unique
  ON public.petty_cash_entries (
    public.normalize_petty_cash_reference(payment_reference),
    amount,
    public.normalize_petty_cash_transaction_time(transaction_time)
  )
  WHERE lower(COALESCE(payment_mode, 'cash')) = 'mpesa'
    AND NULLIF(public.normalize_petty_cash_reference(payment_reference), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_petty_cash_mpesa_duplicates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text;
  v_transaction_time text;
BEGIN
  NEW.payment_mode := lower(COALESCE(NEW.payment_mode, 'cash'));
  v_reference := public.normalize_petty_cash_reference(NEW.payment_reference);
  v_transaction_time := public.normalize_petty_cash_transaction_time(NEW.transaction_time);

  NEW.payment_reference := NULLIF(v_reference, '');
  NEW.transaction_time := NULLIF(v_transaction_time, '');

  IF NEW.payment_mode = 'mpesa' AND NEW.payment_reference IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.petty_cash_entries existing
      WHERE existing.id IS DISTINCT FROM NEW.id
        AND lower(COALESCE(existing.payment_mode, 'cash')) = 'mpesa'
        AND public.normalize_petty_cash_reference(existing.payment_reference) = v_reference
        AND existing.amount = NEW.amount
        AND public.normalize_petty_cash_transaction_time(existing.transaction_time) = v_transaction_time
    ) THEN
      RAISE EXCEPTION 'Transaction already exists.'
        USING ERRCODE = '23505',
              DETAIL = 'An M-PESA transaction with the same reference, amount, and time is already saved.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_petty_cash_mpesa_duplicates ON public.petty_cash_entries;
CREATE TRIGGER trg_guard_petty_cash_mpesa_duplicates
BEFORE INSERT OR UPDATE ON public.petty_cash_entries
FOR EACH ROW EXECUTE FUNCTION public.guard_petty_cash_mpesa_duplicates();

REVOKE EXECUTE ON FUNCTION public.normalize_petty_cash_reference(text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.normalize_petty_cash_transaction_time(text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.guard_petty_cash_mpesa_duplicates() FROM anon, authenticated, public;
