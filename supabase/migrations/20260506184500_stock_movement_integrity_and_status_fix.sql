-- Rebuild stock balances safely on stock movement deletes/updates and
-- replace the backward status rollback function with a stock-safe version.

CREATE OR REPLACE FUNCTION public.stock_movement_signed_qty(
  _type public.movement_type,
  _qty integer
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _type IN ('restock', 'transfer_in') THEN COALESCE(_qty, 0)
    WHEN _type IN ('sale', 'transfer_out') THEN -COALESCE(_qty, 0)
    ELSE COALESCE(_qty, 0)
  END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_part_stock_balance(
  _part_id uuid,
  _location_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty integer := 0;
BEGIN
  SELECT COALESCE(SUM(public.stock_movement_signed_qty(type, qty)), 0)
    INTO v_qty
  FROM public.stock_movements
  WHERE part_id = _part_id
    AND location_id = _location_id;

  INSERT INTO public.part_stock (part_id, location_id, qty)
  VALUES (_part_id, _location_id, v_qty)
  ON CONFLICT (part_id, location_id)
  DO UPDATE
    SET qty = EXCLUDED.qty,
        updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.rebuild_stock_daily_row(
  _part_id uuid,
  _location_id uuid,
  _day date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_rows boolean := false;
  v_opening integer := 0;
  v_additional integer := 0;
  v_sales integer := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.stock_movements
    WHERE part_id = _part_id
      AND location_id = _location_id
      AND created_at::date = _day
  )
    INTO v_has_rows;

  IF NOT v_has_rows THEN
    DELETE FROM public.stock_daily
    WHERE part_id = _part_id
      AND location_id = _location_id
      AND day = _day;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(public.stock_movement_signed_qty(type, qty)), 0)
    INTO v_opening
  FROM public.stock_movements
  WHERE part_id = _part_id
    AND location_id = _location_id
    AND created_at::date < _day;

  SELECT
    COALESCE(SUM(CASE WHEN type IN ('restock', 'transfer_in') THEN qty ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN type IN ('sale', 'transfer_out') THEN qty ELSE 0 END), 0)
    INTO v_additional, v_sales
  FROM public.stock_movements
  WHERE part_id = _part_id
    AND location_id = _location_id
    AND created_at::date = _day;

  INSERT INTO public.stock_daily (part_id, location_id, day, opening, additional, sales)
  VALUES (_part_id, _location_id, _day, v_opening, v_additional, v_sales)
  ON CONFLICT (part_id, location_id, day)
  DO UPDATE
    SET opening = EXCLUDED.opening,
        additional = EXCLUDED.additional,
        sales = EXCLUDED.sales;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_day date;
  v_new_day date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_new_day := NEW.created_at::date;
    PERFORM public.rebuild_part_stock_balance(NEW.part_id, NEW.location_id);
    PERFORM public.rebuild_stock_daily_row(NEW.part_id, NEW.location_id, v_new_day);
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_old_day := OLD.created_at::date;
    PERFORM public.rebuild_part_stock_balance(OLD.part_id, OLD.location_id);
    PERFORM public.rebuild_stock_daily_row(OLD.part_id, OLD.location_id, v_old_day);
    RETURN OLD;
  END IF;

  v_old_day := OLD.created_at::date;
  v_new_day := NEW.created_at::date;

  PERFORM public.rebuild_part_stock_balance(OLD.part_id, OLD.location_id);
  PERFORM public.rebuild_stock_daily_row(OLD.part_id, OLD.location_id, v_old_day);

  IF NEW.part_id IS DISTINCT FROM OLD.part_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id
  THEN
    PERFORM public.rebuild_part_stock_balance(NEW.part_id, NEW.location_id);
  END IF;

  IF NEW.part_id IS DISTINCT FROM OLD.part_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id
     OR v_new_day IS DISTINCT FROM v_old_day
  THEN
    PERFORM public.rebuild_stock_daily_row(NEW.part_id, NEW.location_id, v_new_day);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_stock_movement ON public.stock_movements;
CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

DROP POLICY IF EXISTS "staff delete movements" ON public.stock_movements;
CREATE POLICY "staff delete movements"
  ON public.stock_movements FOR DELETE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'storekeeper')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  );

-- Rebuild live stock balances from the movement ledger so existing jobs and
-- overview cards reflect the corrected totals immediately after this migration.
DELETE FROM public.part_stock;
INSERT INTO public.part_stock (part_id, location_id, qty)
SELECT
  part_id,
  location_id,
  COALESCE(SUM(public.stock_movement_signed_qty(type, qty)), 0) AS qty
FROM public.stock_movements
GROUP BY part_id, location_id;

DELETE FROM public.stock_daily;
INSERT INTO public.stock_daily (part_id, location_id, day, opening, additional, sales)
SELECT
  current_rows.part_id,
  current_rows.location_id,
  current_rows.day,
  COALESCE((
    SELECT SUM(public.stock_movement_signed_qty(previous_rows.type, previous_rows.qty))
    FROM public.stock_movements previous_rows
    WHERE previous_rows.part_id = current_rows.part_id
      AND previous_rows.location_id = current_rows.location_id
      AND previous_rows.created_at::date < current_rows.day
  ), 0) AS opening,
  COALESCE(SUM(CASE WHEN current_rows.type IN ('restock', 'transfer_in') THEN current_rows.qty ELSE 0 END), 0) AS additional,
  COALESCE(SUM(CASE WHEN current_rows.type IN ('sale', 'transfer_out') THEN current_rows.qty ELSE 0 END), 0) AS sales
FROM (
  SELECT
    part_id,
    location_id,
    created_at::date AS day,
    type,
    qty
  FROM public.stock_movements
) AS current_rows
GROUP BY current_rows.part_id, current_rows.location_id, current_rows.day;

CREATE OR REPLACE FUNCTION public.rollback_job_to_status(
  _job_id uuid,
  _target_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status text;
  v_deleted_requests integer := 0;
  v_deleted_lines integer := 0;
  v_deleted_invoices integer := 0;
  v_deleted_gate_passes integer := 0;
  v_deleted_inspections integer := 0;
  v_deleted_stock integer := 0;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'manager') OR
    public.has_role(auth.uid(), 'director')
  ) THEN
    RAISE EXCEPTION 'You do not have sufficient clearance for this action.';
  END IF;

  IF _target_status NOT IN ('diagnosis', 'diagnosed') THEN
    RAISE EXCEPTION 'That status override is not available.';
  END IF;

  SELECT status
    INTO v_current_status
  FROM public.jobs
  WHERE id = _job_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'The selected job could not be found.';
  END IF;

  DELETE FROM public.stock_movements
  WHERE job_id = _job_id
    AND type IN ('sale', 'transfer_out');
  GET DIAGNOSTICS v_deleted_stock = ROW_COUNT;

  DELETE FROM public.part_requests
  WHERE job_id = _job_id;
  GET DIAGNOSTICS v_deleted_requests = ROW_COUNT;

  IF _target_status = 'diagnosis' THEN
    DELETE FROM public.job_line_items
    WHERE job_id = _job_id;
  ELSE
    DELETE FROM public.job_line_items
    WHERE job_id = _job_id
      AND COALESCE(source, 'manual') NOT IN ('ai', 'inspection');
  END IF;
  GET DIAGNOSTICS v_deleted_lines = ROW_COUNT;

  DELETE FROM public.invoices
  WHERE job_id = _job_id;
  GET DIAGNOSTICS v_deleted_invoices = ROW_COUNT;

  DELETE FROM public.gate_passes
  WHERE job_id = _job_id;
  GET DIAGNOSTICS v_deleted_gate_passes = ROW_COUNT;

  IF _target_status = 'diagnosis' THEN
    DELETE FROM public.inspections
    WHERE job_ref = _job_id::text
       OR job_id = _job_id;
    GET DIAGNOSTICS v_deleted_inspections = ROW_COUNT;
  END IF;

  UPDATE public.jobs
     SET status = _target_status,
         completed_at = NULL,
         paid_at = NULL,
         closed_at = NULL,
         gate_pass_issued = false,
         work_performed = NULL,
         financial_summary = NULL,
         quotation_amount = 0,
         invoice_amount = 0,
         receipt_amount = 0,
         deposit_required = 0,
         deposit_paid = 0,
         discount_amount = 0,
         discount_reason = NULL,
         estimate = 0,
         payer_type = 'client',
         payer_name = NULL,
         payment_bypass = false,
         payment_bypass_reason = NULL,
         payment_bypass_authorized_by = NULL,
         diagnosis_sent_at = NULL,
         diagnosis_approved_at = NULL,
         diagnosis_approval_rating = NULL,
         diagnosis_approval_comment = NULL,
         diagnosis_approval_code = NULL,
         parts_fit_approved_at = NULL,
         parts_fit_approved_by = NULL,
         requires_internal_parts_approval = false,
         client_approved_at = NULL,
         client_rating = NULL,
         feedback_rating = NULL,
         customer_feedback = NULL,
         ai_diagnostic_summary = CASE WHEN _target_status = 'diagnosis' THEN NULL ELSE ai_diagnostic_summary END,
         recommended_parts = CASE WHEN _target_status = 'diagnosis' THEN '[]'::jsonb ELSE recommended_parts END
   WHERE id = _job_id;

  RETURN jsonb_build_object(
    'job_id', _job_id,
    'from_status', v_current_status,
    'to_status', _target_status,
    'deleted_stock_movements', v_deleted_stock,
    'deleted_part_requests', v_deleted_requests,
    'deleted_line_items', v_deleted_lines,
    'deleted_invoices', v_deleted_invoices,
    'deleted_gate_passes', v_deleted_gate_passes,
    'deleted_inspections', v_deleted_inspections
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.stock_movement_signed_qty(public.movement_type, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rebuild_part_stock_balance(uuid, uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.rebuild_stock_daily_row(uuid, uuid, date) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.apply_stock_movement() FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.rollback_job_to_status(uuid, text) TO authenticated;
