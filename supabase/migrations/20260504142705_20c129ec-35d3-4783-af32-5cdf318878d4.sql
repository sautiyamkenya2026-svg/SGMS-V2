
-- Helper: any operational staff (everyone who works inside the garage app)
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('super_admin','admin','director','manager','reception','mechanic','storekeeper','gateman')
  )
$$;

-- jobs
DROP POLICY IF EXISTS "auth insert jobs" ON public.jobs;
CREATE POLICY "auth insert jobs" ON public.jobs FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "auth update jobs" ON public.jobs;
CREATE POLICY "auth update jobs" ON public.jobs FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin delete jobs" ON public.jobs;
CREATE POLICY "admin delete jobs" ON public.jobs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'director'));

-- job_line_items
DROP POLICY IF EXISTS "auth write job_line_items" ON public.job_line_items;
CREATE POLICY "auth write job_line_items" ON public.job_line_items FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- job_mechanics
DROP POLICY IF EXISTS "auth write job_mechanics" ON public.job_mechanics;
CREATE POLICY "auth write job_mechanics" ON public.job_mechanics FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- part_requests
DROP POLICY IF EXISTS "mechanic insert part_requests" ON public.part_requests;
CREATE POLICY "staff insert part_requests" ON public.part_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "reception update part_requests" ON public.part_requests;
CREATE POLICY "staff update part_requests" ON public.part_requests FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()));

-- gate_pass_requests
DROP POLICY IF EXISTS "auth insert gpr" ON public.gate_pass_requests;
CREATE POLICY "auth insert gpr" ON public.gate_pass_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "reception update gpr" ON public.gate_pass_requests;
CREATE POLICY "staff update gpr" ON public.gate_pass_requests FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid()));

-- gate_passes
DROP POLICY IF EXISTS "auth issue gate_passes" ON public.gate_passes;
CREATE POLICY "auth issue gate_passes" ON public.gate_passes FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- petty_cash_entries
DROP POLICY IF EXISTS "auth insert petty" ON public.petty_cash_entries;
CREATE POLICY "auth insert petty" ON public.petty_cash_entries FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin update petty" ON public.petty_cash_entries;
CREATE POLICY "admin update petty" ON public.petty_cash_entries FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'director'));

DROP POLICY IF EXISTS "admin delete petty" ON public.petty_cash_entries;
CREATE POLICY "admin delete petty" ON public.petty_cash_entries FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'director'));

-- inventory + ops tables (parts, part_stock, stock_movements, stock_daily, locations, mechanics, tools, tool_assignments, tool_checkins)
DROP POLICY IF EXISTS "admin/store manage parts" ON public.parts;
CREATE POLICY "staff manage parts" ON public.parts FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin/store manage part_stock" ON public.part_stock;
CREATE POLICY "staff manage part_stock" ON public.part_stock FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin/store insert movements" ON public.stock_movements;
CREATE POLICY "staff insert movements" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin/store manage stock_daily" ON public.stock_daily;
CREATE POLICY "staff manage stock_daily" ON public.stock_daily FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin/store manage locations" ON public.locations;
CREATE POLICY "staff manage locations" ON public.locations FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin/store manage mechanics" ON public.mechanics;
CREATE POLICY "staff manage mechanics" ON public.mechanics FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin/store manage tools" ON public.tools;
CREATE POLICY "staff manage tools" ON public.tools FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin/store manage tool_assignments" ON public.tool_assignments;
CREATE POLICY "staff manage tool_assignments" ON public.tool_assignments FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS "admin/store manage tool_checkins" ON public.tool_checkins;
CREATE POLICY "staff manage tool_checkins" ON public.tool_checkins FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- vehicle_models reference list — admin/manager/director can manage
DROP POLICY IF EXISTS "admin manage models" ON public.vehicle_models;
CREATE POLICY "admin manage models" ON public.vehicle_models FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'director'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'manager') OR public.has_role(auth.uid(),'director'));

-- user_roles administration
DROP POLICY IF EXISTS "admins manage roles" ON public.user_roles;
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'director'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'director'));
