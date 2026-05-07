-- Authenticated staff need execute access because these functions are used
-- by the petty cash trigger and unique index expressions during normal writes.
GRANT EXECUTE ON FUNCTION public.normalize_petty_cash_reference(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_petty_cash_transaction_time(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guard_petty_cash_mpesa_duplicates() TO authenticated;
