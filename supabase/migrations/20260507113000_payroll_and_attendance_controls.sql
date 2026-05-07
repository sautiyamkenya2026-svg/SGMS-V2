ALTER TABLE public.staff_attendance
  ADD COLUMN IF NOT EXISTS recorded_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS recorded_by_name text,
  ADD COLUMN IF NOT EXISTS recorded_by_role text;

DROP POLICY IF EXISTS "auth read attendance" ON public.staff_attendance;
CREATE POLICY "auth read attendance"
  ON public.staff_attendance FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'gateman')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "auth insert own attendance" ON public.staff_attendance;
DROP POLICY IF EXISTS "auth insert attendance" ON public.staff_attendance;
CREATE POLICY "auth insert attendance"
  ON public.staff_attendance FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'gateman')
    OR public.has_role(auth.uid(), 'director')
  );

CREATE TABLE IF NOT EXISTS public.attendance_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  day date NOT NULL,
  reason text NOT NULL,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_attendance_exceptions_user_day
  ON public.attendance_exceptions (user_id, day DESC);

ALTER TABLE public.attendance_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendance exceptions read" ON public.attendance_exceptions;
CREATE POLICY "attendance exceptions read"
  ON public.attendance_exceptions FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'gateman')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "attendance exceptions write" ON public.attendance_exceptions;
CREATE POLICY "attendance exceptions write"
  ON public.attendance_exceptions FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP TRIGGER IF EXISTS trg_attendance_exceptions_updated ON public.attendance_exceptions;
CREATE TRIGGER trg_attendance_exceptions_updated
BEFORE UPDATE ON public.attendance_exceptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.staff_payroll_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  month date NOT NULL,
  monthly_salary numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KSh',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

CREATE INDEX IF NOT EXISTS idx_staff_payroll_rates_user_month
  ON public.staff_payroll_rates (user_id, month DESC);

ALTER TABLE public.staff_payroll_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff payroll read" ON public.staff_payroll_rates;
CREATE POLICY "staff payroll read"
  ON public.staff_payroll_rates FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP POLICY IF EXISTS "staff payroll write" ON public.staff_payroll_rates;
CREATE POLICY "staff payroll write"
  ON public.staff_payroll_rates FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'director')
  );

DROP TRIGGER IF EXISTS trg_staff_payroll_rates_updated ON public.staff_payroll_rates;
CREATE TRIGGER trg_staff_payroll_rates_updated
BEFORE UPDATE ON public.staff_payroll_rates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
