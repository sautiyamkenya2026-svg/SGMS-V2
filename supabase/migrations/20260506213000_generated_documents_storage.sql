-- Generated PDFs should open from stable Supabase URLs instead of browser blob links.
INSERT INTO storage.buckets (id, name, public)
VALUES ('generated-documents', 'generated-documents', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "generated documents public read" ON storage.objects;
CREATE POLICY "generated documents public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'generated-documents');

DROP POLICY IF EXISTS "generated documents auth upload" ON storage.objects;
CREATE POLICY "generated documents auth upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'generated-documents');

DROP POLICY IF EXISTS "generated documents auth update" ON storage.objects;
CREATE POLICY "generated documents auth update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'generated-documents')
  WITH CHECK (bucket_id = 'generated-documents');

DROP POLICY IF EXISTS "generated documents auth delete" ON storage.objects;
CREATE POLICY "generated documents auth delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'generated-documents');
