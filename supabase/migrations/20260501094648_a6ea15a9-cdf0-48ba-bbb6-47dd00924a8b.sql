-- JOBS
DROP POLICY IF EXISTS "auth insert jobs" ON public.jobs;
CREATE POLICY "auth insert jobs" ON public.jobs FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'reception')
  OR public.has_role(auth.uid(),'mechanic') OR public.has_role(auth.uid(),'storekeeper')
  OR public.has_role(auth.uid(),'super_admin')
);

DROP POLICY IF EXISTS "auth update jobs" ON public.jobs;
CREATE POLICY "auth update jobs" ON public.jobs FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'reception')
  OR public.has_role(auth.uid(),'mechanic') OR public.has_role(auth.uid(),'storekeeper')
  OR public.has_role(auth.uid(),'super_admin')
);

DROP POLICY IF EXISTS "admin delete jobs" ON public.jobs;
CREATE POLICY "admin delete jobs" ON public.jobs FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- GATE PASSES (issue)
DROP POLICY IF EXISTS "auth issue gate_passes" ON public.gate_passes;
CREATE POLICY "auth issue gate_passes" ON public.gate_passes FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'reception')
  OR public.has_role(auth.uid(),'super_admin')
);

-- LOCATIONS / MECHANICS / PARTS / PART_STOCK / STOCK_DAILY / TOOLS / TOOL_ASSIGNMENTS / TOOL_CHECKINS
DROP POLICY IF EXISTS "admin/store manage locations" ON public.locations;
CREATE POLICY "admin/store manage locations" ON public.locations FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "admin/store manage mechanics" ON public.mechanics;
CREATE POLICY "admin/store manage mechanics" ON public.mechanics FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "admin/store manage parts" ON public.parts;
CREATE POLICY "admin/store manage parts" ON public.parts FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "admin/store manage part_stock" ON public.part_stock;
CREATE POLICY "admin/store manage part_stock" ON public.part_stock FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "admin/store manage stock_daily" ON public.stock_daily;
CREATE POLICY "admin/store manage stock_daily" ON public.stock_daily FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "admin/store manage tools" ON public.tools;
CREATE POLICY "admin/store manage tools" ON public.tools FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "admin/store manage tool_assignments" ON public.tool_assignments;
CREATE POLICY "admin/store manage tool_assignments" ON public.tool_assignments FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "admin/store manage tool_checkins" ON public.tool_checkins;
CREATE POLICY "admin/store manage tool_checkins" ON public.tool_checkins FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

-- STOCK MOVEMENTS (insert)
DROP POLICY IF EXISTS "admin/store insert movements" ON public.stock_movements;
CREATE POLICY "admin/store insert movements" ON public.stock_movements FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper') OR public.has_role(auth.uid(),'super_admin'));

-- PETTY CASH
DROP POLICY IF EXISTS "auth insert petty" ON public.petty_cash_entries;
CREATE POLICY "auth insert petty" ON public.petty_cash_entries FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'storekeeper')
  OR public.has_role(auth.uid(),'reception') OR public.has_role(auth.uid(),'super_admin')
);

DROP POLICY IF EXISTS "admin update petty" ON public.petty_cash_entries;
CREATE POLICY "admin update petty" ON public.petty_cash_entries FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "admin delete petty" ON public.petty_cash_entries;
CREATE POLICY "admin delete petty" ON public.petty_cash_entries FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- USER ROLES (super_admin manage)
DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));