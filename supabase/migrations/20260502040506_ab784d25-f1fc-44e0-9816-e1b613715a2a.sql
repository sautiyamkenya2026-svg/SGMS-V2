
-- =============================================================
-- 1. AI KEYS POOL (super admin manages many provider keys)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.ai_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'gemini',  -- gemini
  label text NOT NULL,
  api_key text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super_admin manage ai_keys" ON public.ai_keys;
CREATE POLICY "super_admin manage ai_keys" ON public.ai_keys
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'super_admin'));

-- =============================================================
-- 2. STAFF ATTENDANCE / PRESENCE
-- =============================================================
CREATE TABLE IF NOT EXISTS public.staff_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  event text NOT NULL,                  -- check_in | check_out | heartbeat
  method text NOT NULL DEFAULT 'webauthn', -- webauthn | pin | manual
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attendance_user_day ON public.staff_attendance(user_id, created_at DESC);
ALTER TABLE public.staff_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read attendance" ON public.staff_attendance;
CREATE POLICY "auth read attendance" ON public.staff_attendance
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "auth insert own attendance" ON public.staff_attendance;
CREATE POLICY "auth insert own attendance" ON public.staff_attendance
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- presence on profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS biometric_credential_id text;
-- allow user to update their own presence
DROP POLICY IF EXISTS "own presence update" ON public.profiles;
-- profiles already has 'own profile update' which covers this column

-- =============================================================
-- 3. GATE PASS REQUEST: final_release flag + lateness tracking
-- =============================================================
ALTER TABLE public.gate_pass_requests ADD COLUMN IF NOT EXISTS is_final_release boolean NOT NULL DEFAULT false;
ALTER TABLE public.gate_pass_requests ADD COLUMN IF NOT EXISTS late_notified_at timestamptz;
ALTER TABLE public.gate_pass_requests ADD COLUMN IF NOT EXISTS arrived_early_at timestamptz;

-- =============================================================
-- 4. MAZDA MODELS LOOKUP
-- =============================================================
CREATE TABLE IF NOT EXISTS public.vehicle_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make text NOT NULL,
  model text NOT NULL,
  body_style text,
  UNIQUE (make, model)
);
ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth read models" ON public.vehicle_models;
CREATE POLICY "auth read models" ON public.vehicle_models FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "admin manage models" ON public.vehicle_models;
CREATE POLICY "admin manage models" ON public.vehicle_models FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.vehicle_models (make, model, body_style) VALUES
  ('Mazda','Demio','hatchback'),('Mazda','Axela','sedan'),('Mazda','Atenza','sedan'),
  ('Mazda','CX-3','suv'),('Mazda','CX-5','suv'),('Mazda','CX-7','suv'),('Mazda','CX-8','suv'),
  ('Mazda','CX-9','suv'),('Mazda','MX-5','convertible'),('Mazda','BT-50','pickup'),
  ('Mazda','Premacy','minivan'),('Mazda','Bongo','van'),('Mazda','Mazda2','hatchback'),
  ('Mazda','Mazda3','sedan'),('Mazda','Mazda6','sedan'),('Mazda','Tribute','suv'),
  ('Mazda','RX-8','coupe'),('Mazda','Verisa','hatchback'),('Mazda','Carol','kei'),
  ('Mazda','Familia','sedan'),('Mazda','Roadster','convertible')
ON CONFLICT (make, model) DO NOTHING;

-- =============================================================
-- 5. SEED COMMON MAZDA PARTS (uses unique sku to skip dups)
-- =============================================================
INSERT INTO public.parts (sku, name, category, unit_cost, unit_price, min_stock) VALUES
  ('MZ-OF-DEMIO','Mazda Demio Oil Filter','Filters',350,650,3),
  ('MZ-OF-AXELA','Mazda Axela Oil Filter','Filters',400,750,3),
  ('MZ-OF-CX5','Mazda CX-5 Oil Filter','Filters',550,950,3),
  ('MZ-AF-DEMIO','Mazda Demio Air Filter','Filters',650,1100,2),
  ('MZ-AF-CX5','Mazda CX-5 Air Filter','Filters',900,1500,2),
  ('MZ-BP-FRONT-DEMIO','Mazda Demio Front Brake Pads','Brakes',2200,3800,2),
  ('MZ-BP-FRONT-CX5','Mazda CX-5 Front Brake Pads','Brakes',3800,6500,2),
  ('MZ-BP-REAR-DEMIO','Mazda Demio Rear Brake Pads','Brakes',1800,3200,2),
  ('MZ-SP-IRIDIUM','Mazda Iridium Spark Plug (NGK ILKAR7B11)','Ignition',850,1500,4),
  ('MZ-TB-AXELA','Mazda Axela Timing Chain Kit','Engine',8500,14500,1),
  ('MZ-WS-FRONT','Mazda Front Wiper Set','Wipers',650,1200,4),
  ('MZ-CB-12V','Mazda 12V Battery NS70','Electrical',8500,12500,2),
  ('MZ-COIL-MZR','Mazda MZR Ignition Coil','Ignition',4200,6800,2),
  ('MZ-TR-LH','Mazda Tie Rod End LH','Suspension',1800,3200,2),
  ('MZ-TR-RH','Mazda Tie Rod End RH','Suspension',1800,3200,2)
ON CONFLICT (sku) DO NOTHING;

-- =============================================================
-- 6. SUPPLIER LEDGER → STOCK linkage
-- =============================================================
ALTER TABLE public.supplier_ledger ADD COLUMN IF NOT EXISTS part_id uuid REFERENCES public.parts(id);
ALTER TABLE public.supplier_ledger ADD COLUMN IF NOT EXISTS qty integer;
ALTER TABLE public.supplier_ledger ADD COLUMN IF NOT EXISTS buy_price numeric;
ALTER TABLE public.supplier_ledger ADD COLUMN IF NOT EXISTS sell_price numeric;
ALTER TABLE public.supplier_ledger ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.locations(id);

CREATE OR REPLACE FUNCTION public.supplier_charge_to_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_loc uuid;
BEGIN
  IF NEW.type <> 'charge' OR NEW.part_id IS NULL OR NEW.qty IS NULL OR NEW.qty <= 0 THEN
    RETURN NEW;
  END IF;
  v_loc := COALESCE(NEW.location_id, (SELECT id FROM public.locations WHERE kind='garage_store' LIMIT 1), (SELECT id FROM public.locations LIMIT 1));
  IF v_loc IS NULL THEN RETURN NEW; END IF;

  -- update parts master prices when given
  UPDATE public.parts
     SET unit_cost = COALESCE(NEW.buy_price, unit_cost),
         unit_price = COALESCE(NEW.sell_price, unit_price)
   WHERE id = NEW.part_id;

  INSERT INTO public.stock_movements (part_id, location_id, type, qty, unit_price, reference, note, buy_price, sell_price, created_by)
  VALUES (NEW.part_id, v_loc, 'restock', NEW.qty, NEW.buy_price, NEW.reference, COALESCE(NEW.note,'Supplier charge'), NEW.buy_price, NEW.sell_price, NEW.created_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supplier_charge_stock_trg ON public.supplier_ledger;
CREATE TRIGGER supplier_charge_stock_trg
AFTER INSERT ON public.supplier_ledger
FOR EACH ROW EXECUTE FUNCTION public.supplier_charge_to_stock();

-- =============================================================
-- 7. ATOMIC USER CREATION (admin/superadmin via edge function pattern is preferred,
--    but we expose a helper to assign roles in one statement)
-- =============================================================
CREATE OR REPLACE FUNCTION public.set_user_role(_user_id uuid, _role app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- replace default reception with the chosen role; keep super_admin only by super_admin
  IF _role = 'super_admin' AND NOT public.has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
END;
$$;
