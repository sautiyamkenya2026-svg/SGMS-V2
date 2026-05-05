
-- Mechanics
CREATE TABLE public.mechanics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  phone TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mechanics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read mechanics" ON public.mechanics FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/store manage mechanics" ON public.mechanics FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'storekeeper'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'storekeeper'));

-- Tools register
CREATE TABLE public.tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  condition TEXT NOT NULL DEFAULT 'good',
  photo_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read tools" ON public.tools FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/store manage tools" ON public.tools FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'storekeeper'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'storekeeper'));
CREATE TRIGGER update_tools_updated_at BEFORE UPDATE ON public.tools FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Assignments
CREATE TABLE public.tool_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  mechanic_id UUID NOT NULL REFERENCES public.mechanics(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at TIMESTAMPTZ,
  note TEXT,
  created_by UUID
);
ALTER TABLE public.tool_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read tool_assignments" ON public.tool_assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/store manage tool_assignments" ON public.tool_assignments FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'storekeeper'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'storekeeper'));
CREATE INDEX idx_tool_assignments_open ON public.tool_assignments(tool_id) WHERE returned_at IS NULL;

-- Monthly check-ins
CREATE TABLE public.tool_checkins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id UUID NOT NULL REFERENCES public.tools(id) ON DELETE CASCADE,
  mechanic_id UUID REFERENCES public.mechanics(id) ON DELETE SET NULL,
  period TEXT NOT NULL,                 -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'present', -- present | missing | damaged
  notes TEXT,
  photo_url TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by UUID
);
ALTER TABLE public.tool_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read tool_checkins" ON public.tool_checkins FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/store manage tool_checkins" ON public.tool_checkins FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'storekeeper'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'storekeeper'));
CREATE INDEX idx_tool_checkins_period ON public.tool_checkins(period);
