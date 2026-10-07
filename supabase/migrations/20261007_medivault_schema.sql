-- ==============================================================================
-- MediVault Complete Database Schema & Row-Level Security Migration
-- Supabase PostgreSQL Migration
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. PROFILES TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Function and trigger to auto-create profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, created_at, updated_at)
  VALUES (
    new.id,
    COALESCE(new.raw_user_meta_data->>'full_name', ''),
    new.email,
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    updated_at = now();
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 3. MEDICAL DOCUMENTS TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.medical_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'Other',
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  document_date DATE,
  doctor_name TEXT,
  hospital_name TEXT,
  description TEXT,
  extracted_text TEXT,
  ai_summary TEXT,
  ai_status TEXT DEFAULT 'not_requested',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medical_documents_user_id ON public.medical_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_medical_documents_date ON public.medical_documents(document_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_medical_documents_created ON public.medical_documents(created_at DESC);

ALTER TABLE public.medical_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own documents" ON public.medical_documents;
CREATE POLICY "Users can view their own documents"
  ON public.medical_documents FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own documents" ON public.medical_documents;
CREATE POLICY "Users can insert their own documents"
  ON public.medical_documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own documents" ON public.medical_documents;
CREATE POLICY "Users can update their own documents"
  ON public.medical_documents FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own documents" ON public.medical_documents;
CREATE POLICY "Users can delete their own documents"
  ON public.medical_documents FOR DELETE
  USING (auth.uid() = user_id);

-- ==============================================================================
-- 4. APPOINTMENTS TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor_name TEXT,
  hospital_name TEXT,
  appointment_date DATE NOT NULL,
  appointment_time TIME,
  reason TEXT,
  notes TEXT,
  status TEXT DEFAULT 'scheduled',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_user_id ON public.appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date ON public.appointments(appointment_date ASC);

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own appointments" ON public.appointments;
CREATE POLICY "Users can view their own appointments"
  ON public.appointments FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own appointments" ON public.appointments;
CREATE POLICY "Users can insert their own appointments"
  ON public.appointments FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own appointments" ON public.appointments;
CREATE POLICY "Users can update their own appointments"
  ON public.appointments FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own appointments" ON public.appointments;
CREATE POLICY "Users can delete their own appointments"
  ON public.appointments FOR DELETE
  USING (auth.uid() = user_id);

-- ==============================================================================
-- 5. SHARES TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient TEXT,
  permission TEXT NOT NULL DEFAULT 'VIEW' CHECK (permission IN ('VIEW', 'VIEW_DOWNLOAD')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  max_views INTEGER DEFAULT 10,
  view_count INTEGER DEFAULT 0,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shares_user_id ON public.shares(user_id);
CREATE INDEX IF NOT EXISTS idx_shares_token_hash ON public.shares(token_hash);
CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON public.shares(expires_at);

ALTER TABLE public.shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own shares" ON public.shares;
CREATE POLICY "Users can view their own shares"
  ON public.shares FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own shares" ON public.shares;
CREATE POLICY "Users can insert their own shares"
  ON public.shares FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own shares" ON public.shares;
CREATE POLICY "Users can update their own shares"
  ON public.shares FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own shares" ON public.shares;
CREATE POLICY "Users can delete their own shares"
  ON public.shares FOR DELETE
  USING (auth.uid() = user_id);

-- ==============================================================================
-- 6. SHARED DOCUMENTS TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.shared_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.shares(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES public.medical_documents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_share_document UNIQUE (share_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_shared_documents_share ON public.shared_documents(share_id);
CREATE INDEX IF NOT EXISTS idx_shared_documents_doc ON public.shared_documents(document_id);

ALTER TABLE public.shared_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own shared_documents" ON public.shared_documents;
CREATE POLICY "Users can view their own shared_documents"
  ON public.shared_documents FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.shares s
      WHERE s.id = shared_documents.share_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert their own shared_documents" ON public.shared_documents;
CREATE POLICY "Users can insert their own shared_documents"
  ON public.shared_documents FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.shares s
      WHERE s.id = shared_documents.share_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete their own shared_documents" ON public.shared_documents;
CREATE POLICY "Users can delete their own shared_documents"
  ON public.shared_documents FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.shares s
      WHERE s.id = shared_documents.share_id AND s.user_id = auth.uid()
    )
  );

-- ==============================================================================
-- 7. AUDIT LOGS TABLE (& security_activity view)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  event_type TEXT,
  title TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own audit logs" ON public.audit_logs;
CREATE POLICY "Users can view their own audit logs"
  ON public.audit_logs FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own audit logs" ON public.audit_logs;
CREATE POLICY "Users can insert their own audit logs"
  ON public.audit_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Backward compatibility view for legacy security_activity queries.
-- security_invoker = true makes the view respect audit_logs RLS; without it the
-- view runs as its owner and would expose every user's audit log to any client.
CREATE OR REPLACE VIEW public.security_activity
  WITH (security_invoker = true) AS
  SELECT id, user_id, action, event_type, title, metadata, ip_address, created_at
  FROM public.audit_logs;

-- ==============================================================================
-- 8. SECURE SHARE VERIFICATION RPC (No RLS bypass for arbitrary records)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_medical_share(p_token_hash TEXT)
RETURNS TABLE (
  share_id UUID,
  permission TEXT,
  recipient TEXT,
  expires_at TIMESTAMPTZ,
  document_id UUID,
  title TEXT,
  category TEXT,
  file_name TEXT,
  mime_type TEXT,
  file_size BIGINT,
  storage_path TEXT,
  document_date DATE,
  description TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share RECORD;
BEGIN
  -- 1. Fetch valid, unrevoked, unexpired share
  SELECT s.id, s.permission, s.recipient, s.expires_at, s.max_views, s.view_count
  INTO v_share
  FROM public.shares s
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND (s.max_views IS NULL OR s.view_count < s.max_views);

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 2. Increment view count
  UPDATE public.shares
  SET view_count = view_count + 1,
      updated_at = now()
  WHERE public.shares.id = v_share.id;

  -- 3. Return linked documents
  RETURN QUERY
  SELECT
    v_share.id AS share_id,
    v_share.permission,
    v_share.recipient,
    v_share.expires_at,
    d.id AS document_id,
    d.title,
    d.category,
    d.file_name,
    d.mime_type,
    d.file_size,
    d.storage_path,
    d.document_date,
    d.description
  FROM public.shared_documents sd
  JOIN public.medical_documents d ON d.id = sd.document_id
  WHERE sd.share_id = v_share.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_medical_share(TEXT) TO anon, authenticated;

-- ==============================================================================
-- 9. SUPABASE STORAGE BUCKET & STORAGE POLICIES
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'medical-records',
  'medical-records',
  false,
  20971520, -- 20 MB
  ARRAY['application/pdf', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 20971520,
  allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png'];

-- Helper used by the share storage policy. SECURITY DEFINER so it can see
-- shares/shared_documents regardless of the caller's RLS (anon recipients).
-- view_count <= max_views because get_medical_share() increments the count
-- before the client requests signed URLs.
CREATE OR REPLACE FUNCTION public.is_actively_shared_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shared_documents sd
    JOIN public.shares s ON s.id = sd.share_id
    JOIN public.medical_documents d ON d.id = sd.document_id
    WHERE d.storage_path = p_name
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND (s.max_views IS NULL OR s.view_count <= s.max_views)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_actively_shared_object(TEXT) TO anon, authenticated;

-- Storage RLS policies
DO $$
BEGIN
  -- Storage SELECT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can view their own medical records'
  ) THEN
    CREATE POLICY "Users can view their own medical records"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'medical-records'
        AND (auth.uid()::text = (storage.foldername(name))[1])
      );
  END IF;

  -- Storage INSERT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can upload their own medical records'
  ) THEN
    CREATE POLICY "Users can upload their own medical records"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'medical-records'
        AND (auth.uid()::text = (storage.foldername(name))[1])
      );
  END IF;

  -- Storage SELECT policy for public share links.
  -- Recipients of /share/:token are anonymous, so without this policy they cannot
  -- create signed URLs for shared files. Access is limited to objects linked to a
  -- share that is currently active (not revoked, not expired, under max views).
  -- Storage paths are only revealed through get_medical_share() with a valid token.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Active shares can read shared medical records'
  ) THEN
    CREATE POLICY "Active shares can read shared medical records"
      ON storage.objects FOR SELECT
      TO anon, authenticated
      USING (
        bucket_id = 'medical-records'
        AND public.is_actively_shared_object(name)
      );
  END IF;

  -- Storage DELETE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Users can delete their own medical records'
  ) THEN
    CREATE POLICY "Users can delete their own medical records"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'medical-records'
        AND (auth.uid()::text = (storage.foldername(name))[1])
      );
  END IF;
END $$;
