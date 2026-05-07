ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'client';

CREATE OR REPLACE FUNCTION public.normalize_plate(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT UPPER(regexp_replace(BTRIM(COALESCE(_value, '')), '[^A-Z0-9]+', '', 'g'));
$$;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS fuel_type text,
  ADD COLUMN IF NOT EXISTS vehicle_color text;

CREATE TABLE IF NOT EXISTS public.client_portal_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  plate text NOT NULL UNIQUE,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT client_portal_accounts_plate_normalized_check
    CHECK (plate = public.normalize_plate(plate))
);

CREATE INDEX IF NOT EXISTS idx_client_portal_accounts_client_id
  ON public.client_portal_accounts (client_id);

CREATE INDEX IF NOT EXISTS idx_client_portal_accounts_vehicle_id
  ON public.client_portal_accounts (vehicle_id);

DROP TRIGGER IF EXISTS trg_client_portal_accounts_upd ON public.client_portal_accounts;
CREATE TRIGGER trg_client_portal_accounts_upd
BEFORE UPDATE ON public.client_portal_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.client_portal_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client portal own read" ON public.client_portal_accounts;
CREATE POLICY "client portal own read"
  ON public.client_portal_accounts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "staff read client portal accounts" ON public.client_portal_accounts;
CREATE POLICY "staff read client portal accounts"
  ON public.client_portal_accounts FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "staff manage client portal accounts" ON public.client_portal_accounts;
CREATE POLICY "staff manage client portal accounts"
  ON public.client_portal_accounts FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'reception')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'reception')
  );

DROP POLICY IF EXISTS "client read own jobs" ON public.jobs;
CREATE POLICY "client read own jobs"
  ON public.jobs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.client_portal_accounts cpa
      WHERE cpa.user_id = auth.uid()
        AND (
          (jobs.client_id IS NOT NULL AND cpa.client_id = jobs.client_id)
          OR public.normalize_plate(cpa.plate) = public.normalize_plate(jobs.plate)
        )
    )
  );

DROP POLICY IF EXISTS "client read own vehicles" ON public.vehicles;
CREATE POLICY "client read own vehicles"
  ON public.vehicles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.client_portal_accounts cpa
      WHERE cpa.user_id = auth.uid()
        AND (
          vehicles.client_id = cpa.client_id
          OR public.normalize_plate(vehicles.plate) = public.normalize_plate(cpa.plate)
        )
    )
  );

DROP POLICY IF EXISTS "client read own invoices" ON public.invoices;
CREATE POLICY "client read own invoices"
  ON public.invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.client_portal_accounts cpa
        ON cpa.user_id = auth.uid()
       AND (
         (j.client_id IS NOT NULL AND cpa.client_id = j.client_id)
         OR public.normalize_plate(j.plate) = public.normalize_plate(cpa.plate)
       )
      WHERE j.id = invoices.job_id
    )
  );

DROP POLICY IF EXISTS "client read own invoice items" ON public.invoice_items;
CREATE POLICY "client read own invoice items"
  ON public.invoice_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.invoices i
      JOIN public.jobs j ON j.id = i.job_id
      JOIN public.client_portal_accounts cpa
        ON cpa.user_id = auth.uid()
       AND (
         (j.client_id IS NOT NULL AND cpa.client_id = j.client_id)
         OR public.normalize_plate(j.plate) = public.normalize_plate(cpa.plate)
       )
      WHERE i.id = invoice_items.invoice_id
    )
  );

DROP POLICY IF EXISTS "client read own gate passes" ON public.gate_passes;
CREATE POLICY "client read own gate passes"
  ON public.gate_passes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.jobs j
      JOIN public.client_portal_accounts cpa
        ON cpa.user_id = auth.uid()
       AND (
         (j.client_id IS NOT NULL AND cpa.client_id = j.client_id)
         OR public.normalize_plate(j.plate) = public.normalize_plate(cpa.plate)
       )
      WHERE j.id = gate_passes.job_id
    )
  );

CREATE OR REPLACE FUNCTION public.notify_client_portal(
  _job_id uuid,
  _title text,
  _body text DEFAULT NULL,
  _kind text DEFAULT 'client_update',
  _link text DEFAULT '/client'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  SELECT cpa.user_id
  INTO v_user_id
  FROM public.jobs j
  JOIN public.client_portal_accounts cpa
    ON (
      (j.client_id IS NOT NULL AND cpa.client_id = j.client_id)
      OR public.normalize_plate(j.plate) = public.normalize_plate(cpa.plate)
    )
  WHERE j.id = _job_id
  ORDER BY CASE WHEN j.client_id IS NOT NULL AND cpa.client_id = j.client_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    WHERE n.user_id = v_user_id
      AND n.title = _title
      AND COALESCE(n.body, '') = COALESCE(_body, '')
      AND n.kind = COALESCE(_kind, 'client_update')
      AND COALESCE(n.link, '') = COALESCE(_link, '/client')
      AND n.created_at > now() - interval '2 minutes'
  ) THEN
    RETURN true;
  END IF;

  INSERT INTO public.notifications (user_id, title, body, kind, link)
  VALUES (v_user_id, _title, _body, COALESCE(_kind, 'client_update'), COALESCE(_link, '/client'));

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_plate(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.normalize_plate(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.notify_client_portal(uuid, text, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.notify_client_portal(uuid, text, text, text, text) TO authenticated;
