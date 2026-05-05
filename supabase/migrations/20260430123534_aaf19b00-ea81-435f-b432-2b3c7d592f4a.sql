
-- shared trigger function (create first if missing)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ============ CLIENTS ============
CREATE TABLE public.clients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone_primary TEXT,
  phone_alt TEXT,
  email TEXT,
  address TEXT,
  contact_method TEXT,
  occupation TEXT,
  source TEXT,
  source_detail TEXT,
  referred_by TEXT,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  value_rating TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read clients" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write clients" ON public.clients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_clients_upd BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ VEHICLES ============
CREATE TABLE public.vehicles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  plate TEXT NOT NULL,
  make TEXT, model TEXT, year INT,
  engine_no TEXT, vin TEXT,
  fuel_type TEXT, transmission TEXT,
  mileage INT, color TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vehicles_plate ON public.vehicles(plate);
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read vehicles" ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write vehicles" ON public.vehicles FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_vehicles_upd BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ INVOICES ============
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_no TEXT, invoice_book_no TEXT,
  plate TEXT,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  service_type TEXT, parts_source TEXT,
  time_in TIMESTAMPTZ, time_out TIMESTAMPTZ,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  discount NUMERIC NOT NULL DEFAULT 0,
  discount_by TEXT,
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  technicians TEXT, customer_phone TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read invoices" ON public.invoices FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write invoices" ON public.invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_invoices_upd BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'part',
  description TEXT NOT NULL,
  qty NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read invoice_items" ON public.invoice_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write invoice_items" ON public.invoice_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ PETTY CASH ============
CREATE TABLE public.petty_cash_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  type TEXT NOT NULL DEFAULT 'payment',
  payee TEXT, details TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  transaction_cost NUMERIC NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_petty_date ON public.petty_cash_entries(date);
ALTER TABLE public.petty_cash_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read petty" ON public.petty_cash_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert petty" ON public.petty_cash_entries FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'storekeeper') OR has_role(auth.uid(),'reception'));
CREATE POLICY "admin update petty" ON public.petty_cash_entries FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'));
CREATE POLICY "admin delete petty" ON public.petty_cash_entries FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'));

-- ============ SUPPLIERS ============
CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT, email TEXT,
  kind TEXT NOT NULL DEFAULT 'external',
  location TEXT, purpose TEXT, notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read suppliers" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write suppliers" ON public.suppliers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_suppliers_upd BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.supplier_ledger (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  type TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  reference TEXT, note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_supplier_ledger_supplier ON public.supplier_ledger(supplier_id);
ALTER TABLE public.supplier_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read supplier_ledger" ON public.supplier_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write supplier_ledger" ON public.supplier_ledger FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ EXTEND INSPECTIONS ============
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS fuel_level TEXT,
  ADD COLUMN IF NOT EXISTS valuables_declared TEXT,
  ADD COLUMN IF NOT EXISTS accessories TEXT[],
  ADD COLUMN IF NOT EXISTS mileage_in INT,
  ADD COLUMN IF NOT EXISTS customer_complaint TEXT,
  ADD COLUMN IF NOT EXISTS technician_diagnosis TEXT,
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL;
