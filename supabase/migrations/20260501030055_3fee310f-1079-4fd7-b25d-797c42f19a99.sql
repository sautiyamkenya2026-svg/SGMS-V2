-- ===== JOBS table =====
CREATE SEQUENCE IF NOT EXISTS public.job_no_seq START 1;

CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_no TEXT NOT NULL UNIQUE DEFAULT ('JOB-' || lpad(nextval('public.job_no_seq')::text, 4, '0')),
  plate TEXT NOT NULL,
  vehicle_id UUID,
  client_id UUID,
  customer_name TEXT,
  customer_phone TEXT,
  vehicle_label TEXT,
  complaint TEXT,
  mechanic TEXT,
  estimate NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'diagnosis',
  service_type TEXT,
  paint_color_code TEXT,
  previous_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_feedback TEXT,
  feedback_rating INTEGER,
  gate_pass_issued BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_plate ON public.jobs(plate);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_job_no ON public.jobs(job_no);

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read jobs" ON public.jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert jobs" ON public.jobs FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'reception') OR
    public.has_role(auth.uid(), 'mechanic') OR
    public.has_role(auth.uid(), 'storekeeper')
  );
CREATE POLICY "auth update jobs" ON public.jobs FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'reception') OR
    public.has_role(auth.uid(), 'mechanic') OR
    public.has_role(auth.uid(), 'storekeeper')
  );
CREATE POLICY "admin delete jobs" ON public.jobs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-link previous job for same plate
CREATE OR REPLACE FUNCTION public.link_previous_job()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.previous_job_id IS NULL AND NEW.plate IS NOT NULL THEN
    SELECT id INTO NEW.previous_job_id
    FROM public.jobs
    WHERE plate = NEW.plate AND id <> NEW.id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_jobs_link_previous
BEFORE INSERT ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.link_previous_job();

-- ===== GATE PASSES =====
CREATE TABLE IF NOT EXISTS public.gate_passes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  pass_no TEXT NOT NULL DEFAULT ('GP-' || to_char(now(), 'YYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 4)),
  issued_by UUID,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  message TEXT,
  notes TEXT
);

ALTER TABLE public.gate_passes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read gate_passes" ON public.gate_passes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth issue gate_passes" ON public.gate_passes FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'reception'));

-- ===== JOB LINKAGE columns =====
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS buy_price NUMERIC;
ALTER TABLE public.stock_movements ADD COLUMN IF NOT EXISTS sell_price NUMERIC;

ALTER TABLE public.tool_assignments ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.petty_cash_entries ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'invoice';

ALTER TABLE public.supplier_ledger ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_job ON public.stock_movements(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_job ON public.invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_petty_job ON public.petty_cash_entries(job_id);
CREATE INDEX IF NOT EXISTS idx_tool_assignments_job ON public.tool_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_supplier_ledger_job ON public.supplier_ledger(job_id);
CREATE INDEX IF NOT EXISTS idx_inspections_job ON public.inspections(job_id);