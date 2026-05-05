-- Vehicle inspections (one per job per inspection round)
CREATE TABLE public.inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_ref TEXT NOT NULL,
  plate TEXT,
  vehicle TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | finished
  manual_done BOOLEAN NOT NULL DEFAULT false,
  obd_done BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read inspections" ON public.inspections
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write inspections" ON public.inspections
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update inspections" ON public.inspections
  FOR UPDATE TO authenticated USING (true);

-- Per-item findings from manual inspection
CREATE TABLE public.inspection_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  system TEXT NOT NULL,         -- e.g. 'doors', 'wheels'
  part TEXT NOT NULL,           -- e.g. 'Front Left Door'
  subpart TEXT,                 -- e.g. 'Window'
  status TEXT NOT NULL DEFAULT 'ok',  -- ok | attention | faulty
  severity TEXT,                -- low | medium | high
  note TEXT,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.inspection_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read findings" ON public.inspection_findings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write findings" ON public.inspection_findings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- OBD scans
CREATE TABLE public.obd_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id UUID NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'simulated', -- simulated | bluetooth | serial
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.obd_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all obd_scans" ON public.obd_scans
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE public.obd_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES public.obd_scans(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  meaning TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium', -- low | medium | high
  system TEXT
);
ALTER TABLE public.obd_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all obd_codes" ON public.obd_codes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Storage bucket for finding photos
INSERT INTO storage.buckets (id, name, public) VALUES ('inspection-photos', 'inspection-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read inspection photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'inspection-photos');
CREATE POLICY "auth upload inspection photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'inspection-photos');
CREATE POLICY "auth update inspection photos" ON storage.objects
  FOR UPDATE TO authenticated USING (bucket_id = 'inspection-photos');

CREATE INDEX idx_inspections_job_ref ON public.inspections(job_ref);
CREATE INDEX idx_findings_inspection ON public.inspection_findings(inspection_id);
CREATE INDEX idx_obd_codes_scan ON public.obd_codes(scan_id);