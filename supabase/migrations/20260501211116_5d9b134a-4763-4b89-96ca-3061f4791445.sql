-- Tronix conversation memory: stores per-user chat history so the AI can
-- remember past conversations, learn patterns, and personalise replies.
CREATE TABLE IF NOT EXISTS public.tronix_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  has_image boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tronix_messages_user_created
  ON public.tronix_messages (user_id, created_at DESC);

ALTER TABLE public.tronix_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read their own Tronix history"
ON public.tronix_messages FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert their own Tronix history"
ON public.tronix_messages FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete their own Tronix history"
ON public.tronix_messages FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Service role (edge function) can also write on behalf of the user
CREATE POLICY "Service role full access tronix_messages"
ON public.tronix_messages FOR ALL
TO service_role
USING (true) WITH CHECK (true);