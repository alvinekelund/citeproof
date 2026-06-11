-- Per-user data isolation: every row is owned by the Supabase Auth user that
-- created it, and row level security scopes all access to the owner.
--
-- Legacy rows created before this migration have user_id = NULL. They become
-- invisible to all users (and to the app) rather than being deleted; purge or
-- claim them manually if needed:
--   UPDATE public.sources SET user_id = '<your-user-uuid>' WHERE user_id IS NULL;

-- 1. Ownership columns. auth.uid() is evaluated per-insert, so new rows are
--    stamped with their creator automatically and the client never needs to
--    send user_id explicitly.
ALTER TABLE public.sources
  ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.thesis_documents
  ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.paragraph_checks
  ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.copilot_sessions
  ADD COLUMN IF NOT EXISTS user_id UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sources_user_id ON public.sources(user_id);
CREATE INDEX IF NOT EXISTS idx_thesis_documents_user_id ON public.thesis_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_paragraph_checks_user_id ON public.paragraph_checks(user_id);
CREATE INDEX IF NOT EXISTS idx_copilot_sessions_user_id ON public.copilot_sessions(user_id);

-- 2. Drop the permissive demo policies.
DROP POLICY IF EXISTS "Allow all operations on sources" ON public.sources;
DROP POLICY IF EXISTS "Allow all operations on thesis_documents" ON public.thesis_documents;
DROP POLICY IF EXISTS "Allow all operations on thesis_paragraphs" ON public.thesis_paragraphs;
DROP POLICY IF EXISTS "Allow all operations on paragraph_checks" ON public.paragraph_checks;
DROP POLICY IF EXISTS "Anyone can view copilot sessions" ON public.copilot_sessions;
DROP POLICY IF EXISTS "Anyone can create copilot sessions" ON public.copilot_sessions;
DROP POLICY IF EXISTS "Anyone can update copilot sessions" ON public.copilot_sessions;
DROP POLICY IF EXISTS "Anyone can delete copilot sessions" ON public.copilot_sessions;

-- 3. Owner-only policies.
CREATE POLICY "Users manage their own sources"
  ON public.sources FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users manage their own thesis documents"
  ON public.thesis_documents FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- thesis_paragraphs has no user_id of its own; ownership flows from the parent
-- document (rows cascade-delete with it as well).
CREATE POLICY "Users manage paragraphs of their own documents"
  ON public.thesis_paragraphs FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.thesis_documents d
    WHERE d.id = thesis_document_id AND d.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.thesis_documents d
    WHERE d.id = thesis_document_id AND d.user_id = auth.uid()
  ));

CREATE POLICY "Users manage their own paragraph checks"
  ON public.paragraph_checks FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users manage their own copilot sessions"
  ON public.copilot_sessions FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. Storage: uploads are namespaced as <user_id>/<folder>/<filename>, and
--    only the owner may write inside their prefix. Reads stay public because
--    the app renders PDFs via public URLs; paths are unguessable but switch
--    to a private bucket + signed URLs for stricter confidentiality.
DROP POLICY IF EXISTS "Allow public upload to thesis-files" ON storage.objects;
DROP POLICY IF EXISTS "Allow public update to thesis-files" ON storage.objects;
DROP POLICY IF EXISTS "Allow public delete from thesis-files" ON storage.objects;

CREATE POLICY "Users upload to their own folder"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'thesis-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users update their own files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'thesis-files' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users delete their own files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'thesis-files' AND (storage.foldername(name))[1] = auth.uid()::text);
