-- Part / tool requests by mechanics
CREATE TABLE IF NOT EXISTS public.part_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  requested_by uuid,
  mechanic_name text,
  kind text NOT NULL DEFAULT 'part', -- 'part' | 'tool'
  item_name text NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  notes text,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | issued | returned
  approved_by uuid,
  approved_at timestamptz,
  returned_at timestamptz,
  return_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.part_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read part_requests" ON public.part_requests
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "mechanic insert part_requests" ON public.part_requests
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'mechanic') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'reception') OR public.has_role(auth.uid(),'storekeeper')
    OR public.has_role(auth.uid(),'super_admin')
  );
CREATE POLICY "reception update part_requests" ON public.part_requests
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'reception')
    OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin')
  );

CREATE TRIGGER part_requests_updated
BEFORE UPDATE ON public.part_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Gate-pass requests (release authorisations the gateman checks)
CREATE TABLE IF NOT EXISTS public.gate_pass_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  plate text,
  reason text NOT NULL, -- 'roadtest' | 'external_repair' | 'paint_run' | 'parts_pickup' | 'final_release' | 'other'
  reason_detail text,
  destination text,
  expected_return timestamptz,
  status text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | released | returned
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  released_by uuid,
  released_at timestamptz,
  returned_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gate_pass_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read gpr" ON public.gate_pass_requests
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert gpr" ON public.gate_pass_requests
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(),'mechanic') OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'reception') OR public.has_role(auth.uid(),'super_admin')
  );
CREATE POLICY "reception update gpr" ON public.gate_pass_requests
  FOR UPDATE TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'reception')
    OR public.has_role(auth.uid(),'gateman') OR public.has_role(auth.uid(),'super_admin')
  );

CREATE TRIGGER gate_pass_requests_updated
BEFORE UPDATE ON public.gate_pass_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Suppress super_admin trail =====
CREATE OR REPLACE FUNCTION public.suppress_super_admin_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'super_admin') THEN
    -- Wipe any created_by-like field if present
    BEGIN NEW.created_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.requested_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.approved_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.issued_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.released_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
    BEGIN NEW.checked_by := NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'jobs','invoices','invoice_items','petty_cash_entries','stock_movements',
    'supplier_ledger','tool_assignments','tool_checkins','gate_passes',
    'part_requests','gate_pass_requests','inspections','inspection_findings'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS suppress_super_admin_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER suppress_super_admin_%I BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.suppress_super_admin_audit()',
      t, t
    );
  END LOOP;
END $$;