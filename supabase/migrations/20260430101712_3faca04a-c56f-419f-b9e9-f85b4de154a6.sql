-- ============ ROLES ============
CREATE TYPE public.app_role AS ENUM ('admin', 'reception', 'mechanic', 'storekeeper');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email), NEW.email);
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'reception');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY "own profile read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "own roles read" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ============ LOCATIONS ============
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('shop', 'garage_store')),
  address TEXT,
  is_supplier BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

INSERT INTO public.locations (name, kind, address, is_supplier) VALUES
  ('Nairobi Shop', 'shop', 'Nairobi CBD', true),
  ('Garage Store', 'garage_store', 'Garage premises', true);

CREATE POLICY "auth read locations" ON public.locations FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/store manage locations" ON public.locations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'storekeeper'));

-- ============ PARTS ============
CREATE TABLE public.parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_cost  NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.parts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read parts" ON public.parts FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/store manage parts" ON public.parts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'storekeeper'));

-- ============ STOCK PER LOCATION ============
CREATE TABLE public.part_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (part_id, location_id)
);
ALTER TABLE public.part_stock ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read part_stock" ON public.part_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/store manage part_stock" ON public.part_stock FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'storekeeper'));

-- ============ DAILY STOCK CARD ============
CREATE TABLE public.stock_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  day DATE NOT NULL DEFAULT CURRENT_DATE,
  opening INTEGER NOT NULL DEFAULT 0,
  additional INTEGER NOT NULL DEFAULT 0,
  sales INTEGER NOT NULL DEFAULT 0,
  UNIQUE (part_id, location_id, day)
);
ALTER TABLE public.stock_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read stock_daily" ON public.stock_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/store manage stock_daily" ON public.stock_daily FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'storekeeper'));

-- ============ STOCK MOVEMENTS ============
CREATE TYPE public.movement_type AS ENUM ('restock', 'sale', 'transfer_out', 'transfer_in', 'adjustment');

CREATE TABLE public.stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  type movement_type NOT NULL,
  qty INTEGER NOT NULL,
  unit_price NUMERIC(12,2),
  reference TEXT,
  note TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read movements" ON public.stock_movements FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin/store insert movements" ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'storekeeper'));

-- ============ TRIGGER: apply movement to part_stock + stock_daily ============
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  delta INTEGER;
  current_qty INTEGER;
  add_col INTEGER := 0;
  sale_col INTEGER := 0;
BEGIN
  IF NEW.type IN ('restock', 'transfer_in') THEN delta := NEW.qty;
  ELSIF NEW.type IN ('sale', 'transfer_out') THEN delta := -NEW.qty;
  ELSE delta := NEW.qty; -- adjustment: signed
  END IF;

  -- get pre-movement qty (this is the opening for today if no row yet)
  SELECT qty INTO current_qty FROM public.part_stock
    WHERE part_id = NEW.part_id AND location_id = NEW.location_id;
  IF current_qty IS NULL THEN current_qty := 0; END IF;

  -- upsert part_stock
  INSERT INTO public.part_stock (part_id, location_id, qty)
  VALUES (NEW.part_id, NEW.location_id, current_qty + delta)
  ON CONFLICT (part_id, location_id)
  DO UPDATE SET qty = public.part_stock.qty + delta, updated_at = now();

  -- update stock_daily
  IF NEW.type IN ('restock', 'transfer_in') THEN add_col := NEW.qty;
  ELSIF NEW.type IN ('sale', 'transfer_out') THEN sale_col := NEW.qty;
  END IF;

  INSERT INTO public.stock_daily (part_id, location_id, day, opening, additional, sales)
  VALUES (NEW.part_id, NEW.location_id, CURRENT_DATE, current_qty, add_col, sale_col)
  ON CONFLICT (part_id, location_id, day)
  DO UPDATE SET
    additional = public.stock_daily.additional + add_col,
    sales = public.stock_daily.sales + sale_col;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_apply_stock_movement
AFTER INSERT ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

-- ============ Seed parts ============
INSERT INTO public.parts (sku, name, unit_price, unit_cost, min_stock, category) VALUES
  ('BP-FR-001', 'Brake Pads (Front)', 3500, 2400, 10, 'Brakes'),
  ('EO-5W30-4', 'Engine Oil 5W-30 4L', 4200, 2800, 12, 'Fluids'),
  ('AF-202', 'Air Filter', 1200, 700, 8, 'Filters'),
  ('RD-UNI-7', 'Radiator (Universal)', 12500, 9000, 4, 'Cooling'),
  ('BT-60AH', 'Battery 60Ah', 11000, 8500, 5, 'Electrical'),
  ('SP-SET-4', 'Spark Plugs (set)', 1800, 1100, 20, 'Engine'),
  ('AC-COMP-1', 'AC Compressor', 28500, 21000, 2, 'AC'),
  ('TR-END-2', 'Tie Rod End', 2400, 1500, 6, 'Steering');

-- Seed initial stock at both locations via direct part_stock insert (no movement, treated as opening balance)
INSERT INTO public.part_stock (part_id, location_id, qty)
SELECT p.id, l.id,
  CASE l.kind WHEN 'shop' THEN 30 ELSE 10 END
FROM public.parts p CROSS JOIN public.locations l;