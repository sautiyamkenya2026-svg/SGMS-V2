
-- 1. Extend profiles with the fields the new add-user wizard captures
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS notes text;

-- 2. Avatars storage bucket (public read, authenticated write)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

-- Public can read avatars
DROP POLICY IF EXISTS "avatars public read" ON storage.objects;
CREATE POLICY "avatars public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Authenticated users can upload to the avatars bucket
DROP POLICY IF EXISTS "avatars auth upload" ON storage.objects;
CREATE POLICY "avatars auth upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars');

-- Authenticated users can update / replace avatars
DROP POLICY IF EXISTS "avatars auth update" ON storage.objects;
CREATE POLICY "avatars auth update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars');

-- Authenticated users can delete avatars
DROP POLICY IF EXISTS "avatars auth delete" ON storage.objects;
CREATE POLICY "avatars auth delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars');

-- 3. Lightweight in-app notifications (already discussed; create if missing)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,                       -- null = broadcast to all staff
  title text NOT NULL,
  body  text,
  link  text,
  kind  text NOT NULL DEFAULT 'info', -- info | warning | success
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notif read" ON public.notifications;
CREATE POLICY "notif read" ON public.notifications FOR SELECT TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());
DROP POLICY IF EXISTS "notif insert" ON public.notifications;
CREATE POLICY "notif insert" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (true);
DROP POLICY IF EXISTS "notif update own" ON public.notifications;
CREATE POLICY "notif update own" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());
