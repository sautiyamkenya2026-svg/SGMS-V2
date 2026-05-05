CREATE TABLE IF NOT EXISTS public.job_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'part', -- 'part' | 'labour'
  description text NOT NULL,
  part_id uuid,
  qty numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual', -- 'manual' | 'ai' | 'inspection'
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_line_items_job ON public.job_line_items(job_id);

ALTER TABLE public.job_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read job_line_items" ON public.job_line_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "auth write job_line_items" ON public.job_line_items
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'reception') OR
    public.has_role(auth.uid(), 'mechanic') OR
    public.has_role(auth.uid(), 'storekeeper') OR
    public.has_role(auth.uid(), 'super_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'reception') OR
    public.has_role(auth.uid(), 'mechanic') OR
    public.has_role(auth.uid(), 'storekeeper') OR
    public.has_role(auth.uid(), 'super_admin')
  );

CREATE TRIGGER trg_job_line_items_updated
  BEFORE UPDATE ON public.job_line_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();