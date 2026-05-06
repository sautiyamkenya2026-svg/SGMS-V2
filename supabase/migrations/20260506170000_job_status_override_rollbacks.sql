-- Safe rollback support for status overrides that move a job backward.

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
  v_reversed_stock integer := 0;
  v_move public.stock_movements%ROWTYPE;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'manager') OR
    public.has_role(auth.uid(), 'director')
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _target_status NOT IN ('diagnosis', 'diagnosed') THEN
    RAISE EXCEPTION 'unsupported target status: %', _target_status;
  END IF;

  SELECT status
    INTO v_current_status
  FROM public.jobs
  WHERE id = _job_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'job not found';
  END IF;

  -- Remove issued stock from the job and add it back into inventory as a reversal.
  FOR v_move IN
    DELETE FROM public.stock_movements
    WHERE job_id = _job_id
      AND type IN ('sale', 'transfer_out')
    RETURNING *
  LOOP
    INSERT INTO public.stock_movements (
      part_id,
      location_id,
      type,
      qty,
      unit_price,
      reference,
      note,
      buy_price,
      sell_price,
      created_by,
      job_id
    )
    VALUES (
      v_move.part_id,
      v_move.location_id,
      CASE WHEN v_move.type = 'transfer_out' THEN 'transfer_in' ELSE 'restock' END,
      v_move.qty,
      v_move.unit_price,
      COALESCE(v_move.reference, 'job-rollback:' || _job_id::text) || ':rollback:' || _target_status,
      'Auto-reversed from job rollback to ' || _target_status,
      v_move.buy_price,
      v_move.sell_price,
      auth.uid(),
      NULL
    );
    v_reversed_stock := v_reversed_stock + 1;
  END LOOP;

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
    'reversed_stock_movements', v_reversed_stock,
    'deleted_part_requests', v_deleted_requests,
    'deleted_line_items', v_deleted_lines,
    'deleted_invoices', v_deleted_invoices,
    'deleted_gate_passes', v_deleted_gate_passes,
    'deleted_inspections', v_deleted_inspections
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_job_to_status(uuid, text) TO authenticated;
