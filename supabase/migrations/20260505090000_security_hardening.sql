-- Keep app_settings readable only for safe public knobs, not stored API keys.
DROP POLICY IF EXISTS "auth read app_settings" ON public.app_settings;
CREATE POLICY "auth read app_settings"
  ON public.app_settings FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR key = 'major_part_threshold_ksh'
  );

-- Clear any previously stored Gemini key so the replacement credentials can be
-- entered cleanly after this migration.
UPDATE public.app_settings
   SET value = NULL,
       updated_at = now()
 WHERE key = 'gemini_api_key';

-- Attendance operators can log staff in and out on their behalf.
DROP POLICY IF EXISTS "auth insert own attendance" ON public.staff_attendance;
CREATE POLICY "auth insert attendance" ON public.staff_attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'reception')
    OR public.has_role(auth.uid(), 'gateman')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'director')
  );

-- Attendance and user-management screens need broader read access to staff records.
DROP POLICY IF EXISTS "admins read all profiles" ON public.profiles;
CREATE POLICY "admins read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'director'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'reception'::app_role)
    OR has_role(auth.uid(), 'gateman'::app_role)
  );

DROP POLICY IF EXISTS "staff read all roles" ON public.user_roles;
CREATE POLICY "staff read all roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.is_staff(auth.uid()));

-- Directors can open the Users screen, so they need the same credential visibility.
DROP POLICY IF EXISTS "own or admin read webauthn" ON public.webauthn_credentials;
CREATE POLICY "own or admin read webauthn" ON public.webauthn_credentials FOR SELECT TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "own or admin insert webauthn" ON public.webauthn_credentials;
CREATE POLICY "own or admin insert webauthn" ON public.webauthn_credentials FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "own or admin delete webauthn" ON public.webauthn_credentials;
CREATE POLICY "own or admin delete webauthn" ON public.webauthn_credentials FOR DELETE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "own update webauthn last_used" ON public.webauthn_credentials;
CREATE POLICY "own update webauthn last_used" ON public.webauthn_credentials FOR UPDATE TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );
