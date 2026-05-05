-- Mechanic enrichment
ALTER TABLE public.mechanics
  ADD COLUMN IF NOT EXISTS level TEXT NOT NULL DEFAULT 'junior',
  ADD COLUMN IF NOT EXISTS roles TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS other_specialisations TEXT;

-- Multi-mechanic assignment per job
CREATE TABLE IF NOT EXISTS public.job_mechanics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL,
  mechanic_id UUID NOT NULL,
  role_on_job TEXT NOT NULL DEFAULT 'lead',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (job_id, mechanic_id)
);
CREATE INDEX IF NOT EXISTS idx_job_mechanics_job ON public.job_mechanics(job_id);
CREATE INDEX IF NOT EXISTS idx_job_mechanics_mech ON public.job_mechanics(mechanic_id);
ALTER TABLE public.job_mechanics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read job_mechanics" ON public.job_mechanics FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write job_mechanics" ON public.job_mechanics FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'reception') OR public.has_role(auth.uid(),'mechanic') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'reception') OR public.has_role(auth.uid(),'mechanic') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

-- WebAuthn credentials (multi-credential per user)
CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT,
  device_label TEXT,
  enrolled_by UUID,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webauthn_user ON public.webauthn_credentials(user_id);
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or admin read webauthn" ON public.webauthn_credentials FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "own or admin insert webauthn" ON public.webauthn_credentials FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "own or admin delete webauthn" ON public.webauthn_credentials FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "own update webauthn last_used" ON public.webauthn_credentials FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- Vehicles: track AI-detected fields so reception can review
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS detected_by_ai BOOLEAN NOT NULL DEFAULT false;