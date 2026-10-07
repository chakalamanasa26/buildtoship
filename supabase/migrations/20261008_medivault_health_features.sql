-- ==============================================================================
-- MediVault Health Management Features Migration
-- Run AFTER 20261007_medivault_schema.sql (Supabase Dashboard -> SQL Editor).
--
-- This migration is ADDITIVE and idempotent (safe to run more than once). It does
-- not drop or rewrite any existing table, column, policy or function behaviour,
-- apart from two deliberate security hardenings that are called out below:
--   * shared_documents INSERT now also requires that the document is yours.
--   * is_actively_shared_object() also understands prescription/receipt files.
--
-- Adds:
--   1. profiles.date_of_birth                (age is derived, never stored)
--   2. medical_documents.document_time       (exact time of a medical event)
--   3. appointments.appointment_type / remind_before_minutes (follow-up reminders)
--   4. prescriptions + medicines             (prescription & medicine management)
--   5. medicine_receipts                     (pharmacy receipts)
--   6. medication_reminders + logs           (user-entered schedules only)
--   7. shares.kind/title/note/include_patient_info + share_items (Doctor Visit Pack)
--   8. get_share_pack() RPC                  (token-gated read of a whole pack)
--   9. Private storage: files live in the existing PRIVATE 'medical-records' bucket
--      under  <user_id>/prescriptions/...  and  <user_id>/receipts/...
--      The existing storage RLS (first folder == auth.uid()) already covers them.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 0. Shared helpers
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------------------------
-- 1. PROFILES: date of birth
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS date_of_birth DATE;

CREATE OR REPLACE FUNCTION public.validate_profile_dob()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.date_of_birth IS NOT NULL THEN
    IF NEW.date_of_birth > current_date THEN
      RAISE EXCEPTION 'Date of birth cannot be in the future';
    END IF;
    IF NEW.date_of_birth < DATE '1900-01-01' THEN
      RAISE EXCEPTION 'Date of birth is not valid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_validate_dob ON public.profiles;
CREATE TRIGGER trg_profiles_validate_dob
  BEFORE INSERT OR UPDATE OF date_of_birth ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.validate_profile_dob();

-- ------------------------------------------------------------------------------
-- 2. MEDICAL DOCUMENTS: exact time of the event
-- ------------------------------------------------------------------------------
ALTER TABLE public.medical_documents ADD COLUMN IF NOT EXISTS document_time TIME;

-- ------------------------------------------------------------------------------
-- 3. APPOINTMENTS: follow-up type + reminder lead time
--    (appointment_date DATE + appointment_time TIME already store the exact
--     wall-clock date and time of the visit.)
-- ------------------------------------------------------------------------------
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS appointment_type TEXT NOT NULL DEFAULT 'appointment';
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS remind_before_minutes INTEGER;

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_type_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_type_check
  CHECK (appointment_type IN ('appointment', 'follow_up'));

ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_remind_check;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_remind_check
  CHECK (remind_before_minutes IS NULL OR (remind_before_minutes >= 0 AND remind_before_minutes <= 43200));

-- ------------------------------------------------------------------------------
-- 4. PRESCRIPTIONS + MEDICINES
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doctor_name TEXT NOT NULL,
  hospital_name TEXT,
  prescription_date DATE NOT NULL,
  prescription_time TIME,
  reason TEXT,
  notes TEXT,
  file_name TEXT,
  storage_path TEXT,
  mime_type TEXT,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The file must live in this user's own private folder.
  CONSTRAINT prescriptions_storage_path_owner
    CHECK (storage_path IS NULL OR storage_path LIKE user_id::text || '/prescriptions/%'),
  CONSTRAINT prescriptions_file_complete
    CHECK ((storage_path IS NULL) = (file_name IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_user_date
  ON public.prescriptions(user_id, prescription_date DESC);

CREATE TABLE IF NOT EXISTS public.medicines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prescription_id UUID NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  medicine_name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  duration_days INTEGER CHECK (duration_days IS NULL OR duration_days > 0),
  start_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_medicines_user ON public.medicines(user_id);
CREATE INDEX IF NOT EXISTS idx_medicines_prescription ON public.medicines(prescription_id);

-- ------------------------------------------------------------------------------
-- 5. MEDICINE RECEIPTS
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medicine_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prescription_id UUID REFERENCES public.prescriptions(id) ON DELETE SET NULL,
  pharmacy_name TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  purchase_time TIME,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'INR',
  notes TEXT,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT receipts_storage_path_owner
    CHECK (storage_path LIKE user_id::text || '/receipts/%')
);

CREATE INDEX IF NOT EXISTS idx_receipts_user_date
  ON public.medicine_receipts(user_id, purchase_date DESC);

-- ------------------------------------------------------------------------------
-- 6. MEDICATION REMINDERS (schedules entered by the user - nothing is inferred)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medication_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  reminder_times TIME[] NOT NULL
    CHECK (cardinality(reminder_times) BETWEEN 1 AND 12),
  -- 0 = Sunday ... 6 = Saturday
  days_of_week SMALLINT[] NOT NULL DEFAULT ARRAY[0,1,2,3,4,5,6]::smallint[]
    CHECK (
      cardinality(days_of_week) BETWEEN 1 AND 7
      AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
    ),
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT reminders_date_order CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_med_reminders_user ON public.medication_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_med_reminders_medicine ON public.medication_reminders(medicine_id);

CREATE TABLE IF NOT EXISTS public.medication_reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_id UUID NOT NULL REFERENCES public.medication_reminders(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  scheduled_time TIME NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('taken', 'skipped')),
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_reminder_dose UNIQUE (reminder_id, scheduled_date, scheduled_time)
);

CREATE INDEX IF NOT EXISTS idx_med_logs_user_date
  ON public.medication_reminder_logs(user_id, scheduled_date DESC);

-- ------------------------------------------------------------------------------
-- 7. DOCTOR VISIT PACK (extends the existing secure-sharing system)
-- ------------------------------------------------------------------------------
ALTER TABLE public.shares ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'documents';
ALTER TABLE public.shares ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.shares ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE public.shares ADD COLUMN IF NOT EXISTS include_patient_info BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.shares DROP CONSTRAINT IF EXISTS shares_kind_check;
ALTER TABLE public.shares
  ADD CONSTRAINT shares_kind_check CHECK (kind IN ('documents', 'visit_pack'));

-- Does this user own the item being put into a pack?
CREATE OR REPLACE FUNCTION public.owns_shareable_item(p_user UUID, p_type TEXT, p_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_type
    WHEN 'document' THEN EXISTS (
      SELECT 1 FROM public.medical_documents x WHERE x.id = p_id AND x.user_id = p_user)
    WHEN 'prescription' THEN EXISTS (
      SELECT 1 FROM public.prescriptions x WHERE x.id = p_id AND x.user_id = p_user)
    WHEN 'receipt' THEN EXISTS (
      SELECT 1 FROM public.medicine_receipts x WHERE x.id = p_id AND x.user_id = p_user)
    WHEN 'appointment' THEN EXISTS (
      SELECT 1 FROM public.appointments x WHERE x.id = p_id AND x.user_id = p_user)
    ELSE false
  END;
$$;

GRANT EXECUTE ON FUNCTION public.owns_shareable_item(UUID, TEXT, UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS public.share_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id UUID NOT NULL REFERENCES public.shares(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('prescription', 'receipt', 'appointment')),
  item_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_share_item UNIQUE (share_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_share_items_share ON public.share_items(share_id);
CREATE INDEX IF NOT EXISTS idx_share_items_item ON public.share_items(item_type, item_id);

-- Remove pack links automatically when the underlying item is deleted.
CREATE OR REPLACE FUNCTION public.cleanup_share_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.share_items
  WHERE item_type = TG_ARGV[0] AND item_id = OLD.id;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_share_items ON public.prescriptions;
CREATE TRIGGER trg_cleanup_share_items AFTER DELETE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_share_items('prescription');

DROP TRIGGER IF EXISTS trg_cleanup_share_items ON public.medicine_receipts;
CREATE TRIGGER trg_cleanup_share_items AFTER DELETE ON public.medicine_receipts
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_share_items('receipt');

DROP TRIGGER IF EXISTS trg_cleanup_share_items ON public.appointments;
CREATE TRIGGER trg_cleanup_share_items AFTER DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_share_items('appointment');

-- ------------------------------------------------------------------------------
-- 8. updated_at triggers for the new tables
-- ------------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['prescriptions', 'medicines', 'medicine_receipts', 'medication_reminders']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_updated_at ON public.%1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_updated_at BEFORE UPDATE ON public.%1$s
         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()', t);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------
-- 9. ROW LEVEL SECURITY
--    Every new table is locked to its owner. Child tables additionally verify
--    that the parent row they point to is also owned by the caller.
-- ------------------------------------------------------------------------------
ALTER TABLE public.prescriptions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicines                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_receipts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_reminders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medication_reminder_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_items                ENABLE ROW LEVEL SECURITY;

-- 9a. prescriptions ------------------------------------------------------------
DROP POLICY IF EXISTS "prescriptions_select_own" ON public.prescriptions;
CREATE POLICY "prescriptions_select_own" ON public.prescriptions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "prescriptions_insert_own" ON public.prescriptions;
CREATE POLICY "prescriptions_insert_own" ON public.prescriptions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prescriptions_update_own" ON public.prescriptions;
CREATE POLICY "prescriptions_update_own" ON public.prescriptions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prescriptions_delete_own" ON public.prescriptions;
CREATE POLICY "prescriptions_delete_own" ON public.prescriptions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9b. medicines (parent: prescriptions) ---------------------------------------
DROP POLICY IF EXISTS "medicines_select_own" ON public.medicines;
CREATE POLICY "medicines_select_own" ON public.medicines
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "medicines_insert_own" ON public.medicines;
CREATE POLICY "medicines_insert_own" ON public.medicines
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.prescriptions p
                WHERE p.id = prescription_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "medicines_update_own" ON public.medicines;
CREATE POLICY "medicines_update_own" ON public.medicines
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.prescriptions p
                WHERE p.id = prescription_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "medicines_delete_own" ON public.medicines;
CREATE POLICY "medicines_delete_own" ON public.medicines
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9c. medicine_receipts (optional parent: prescriptions) ----------------------
DROP POLICY IF EXISTS "receipts_select_own" ON public.medicine_receipts;
CREATE POLICY "receipts_select_own" ON public.medicine_receipts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "receipts_insert_own" ON public.medicine_receipts;
CREATE POLICY "receipts_insert_own" ON public.medicine_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (prescription_id IS NULL OR EXISTS (
          SELECT 1 FROM public.prescriptions p
          WHERE p.id = prescription_id AND p.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "receipts_update_own" ON public.medicine_receipts;
CREATE POLICY "receipts_update_own" ON public.medicine_receipts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (prescription_id IS NULL OR EXISTS (
          SELECT 1 FROM public.prescriptions p
          WHERE p.id = prescription_id AND p.user_id = auth.uid()))
  );

DROP POLICY IF EXISTS "receipts_delete_own" ON public.medicine_receipts;
CREATE POLICY "receipts_delete_own" ON public.medicine_receipts
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9d. medication_reminders (parent: medicines) --------------------------------
DROP POLICY IF EXISTS "med_reminders_select_own" ON public.medication_reminders;
CREATE POLICY "med_reminders_select_own" ON public.medication_reminders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "med_reminders_insert_own" ON public.medication_reminders;
CREATE POLICY "med_reminders_insert_own" ON public.medication_reminders
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.medicines m
                WHERE m.id = medicine_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "med_reminders_update_own" ON public.medication_reminders;
CREATE POLICY "med_reminders_update_own" ON public.medication_reminders
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.medicines m
                WHERE m.id = medicine_id AND m.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "med_reminders_delete_own" ON public.medication_reminders;
CREATE POLICY "med_reminders_delete_own" ON public.medication_reminders
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9e. medication_reminder_logs (parent: medication_reminders) -----------------
DROP POLICY IF EXISTS "med_logs_select_own" ON public.medication_reminder_logs;
CREATE POLICY "med_logs_select_own" ON public.medication_reminder_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "med_logs_insert_own" ON public.medication_reminder_logs;
CREATE POLICY "med_logs_insert_own" ON public.medication_reminder_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.medication_reminders r
                WHERE r.id = reminder_id AND r.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "med_logs_update_own" ON public.medication_reminder_logs;
CREATE POLICY "med_logs_update_own" ON public.medication_reminder_logs
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (SELECT 1 FROM public.medication_reminders r
                WHERE r.id = reminder_id AND r.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "med_logs_delete_own" ON public.medication_reminder_logs;
CREATE POLICY "med_logs_delete_own" ON public.medication_reminder_logs
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 9f. share_items (parent: shares, and the item itself must be yours) ---------
DROP POLICY IF EXISTS "share_items_select_own" ON public.share_items;
CREATE POLICY "share_items_select_own" ON public.share_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shares s
                 WHERE s.id = share_items.share_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "share_items_insert_own" ON public.share_items;
CREATE POLICY "share_items_insert_own" ON public.share_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.shares s
            WHERE s.id = share_items.share_id AND s.user_id = auth.uid())
    AND public.owns_shareable_item(auth.uid(), item_type, item_id)
  );

DROP POLICY IF EXISTS "share_items_delete_own" ON public.share_items;
CREATE POLICY "share_items_delete_own" ON public.share_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.shares s
                 WHERE s.id = share_items.share_id AND s.user_id = auth.uid()));

-- 9g. HARDENING: a share may only include documents that belong to the sharer.
--     (The original policy only checked share ownership.)
DROP POLICY IF EXISTS "Users can insert their own shared_documents" ON public.shared_documents;
CREATE POLICY "Users can insert their own shared_documents"
  ON public.shared_documents FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.shares s
            WHERE s.id = shared_documents.share_id AND s.user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.medical_documents d
                WHERE d.id = shared_documents.document_id AND d.user_id = auth.uid())
  );

-- Table privileges (RLS above is what actually restricts rows).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.prescriptions,
  public.medicines,
  public.medicine_receipts,
  public.medication_reminders,
  public.medication_reminder_logs,
  public.share_items
TO authenticated;

-- ------------------------------------------------------------------------------
-- 10. SECURE SHARE: storage access for prescription / receipt files
--     Extends the existing helper; documents behave exactly as before.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_actively_shared_object(p_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.shared_documents sd
      JOIN public.shares s ON s.id = sd.share_id
      JOIN public.medical_documents d ON d.id = sd.document_id
      WHERE d.storage_path = p_name
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND (s.max_views IS NULL OR s.view_count <= s.max_views)
    )
    OR EXISTS (
      SELECT 1
      FROM public.share_items si
      JOIN public.shares s ON s.id = si.share_id
      JOIN public.prescriptions pr ON pr.id = si.item_id AND si.item_type = 'prescription'
      WHERE pr.storage_path = p_name
        AND pr.user_id = s.user_id
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND (s.max_views IS NULL OR s.view_count <= s.max_views)
    )
    OR EXISTS (
      SELECT 1
      FROM public.share_items si
      JOIN public.shares s ON s.id = si.share_id
      JOIN public.medicine_receipts rc ON rc.id = si.item_id AND si.item_type = 'receipt'
      WHERE rc.storage_path = p_name
        AND rc.user_id = s.user_id
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND (s.max_views IS NULL OR s.view_count <= s.max_views)
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_actively_shared_object(TEXT) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- 11. SECURE SHARE: get_share_pack()
--     Token-gated. Validates the (hashed) token, expiry, revocation and view
--     limit, increments the view count ONCE, then returns everything linked to
--     the share as a single JSON document. It is a superset of the legacy
--     get_medical_share() (which is left untouched), so older document-only
--     shares keep working through the same viewer.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_share_pack(p_token_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_share RECORD;
  v_result JSONB;
BEGIN
  SELECT s.*
  INTO v_share
  FROM public.shares s
  WHERE s.token_hash = p_token_hash
    AND s.revoked_at IS NULL
    AND s.expires_at > now()
    AND (s.max_views IS NULL OR s.view_count < s.max_views);

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.shares
  SET view_count = COALESCE(view_count, 0) + 1,
      updated_at = now()
  WHERE id = v_share.id;

  SELECT jsonb_build_object(
    'share', jsonb_build_object(
      'id', v_share.id,
      'kind', v_share.kind,
      'title', v_share.title,
      'note', v_share.note,
      'permission', v_share.permission,
      'recipient', v_share.recipient,
      'expires_at', v_share.expires_at,
      'created_at', v_share.created_at
    ),
    'patient', CASE WHEN v_share.include_patient_info THEN (
        SELECT jsonb_build_object(
          'full_name', p.full_name,
          'age_years', CASE WHEN p.date_of_birth IS NULL THEN NULL
                            ELSE date_part('year', age(current_date, p.date_of_birth))::int END,
          'age_months', CASE WHEN p.date_of_birth IS NULL THEN NULL
                             ELSE date_part('month', age(current_date, p.date_of_birth))::int END
        )
        FROM public.profiles p WHERE p.id = v_share.user_id
      ) ELSE NULL END,
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'document_id', d.id,
        'title', d.title,
        'category', d.category,
        'file_name', d.file_name,
        'mime_type', d.mime_type,
        'file_size', d.file_size,
        'storage_path', d.storage_path,
        'document_date', d.document_date,
        'document_time', d.document_time,
        'doctor_name', d.doctor_name,
        'hospital_name', d.hospital_name,
        'description', d.description
      ) ORDER BY d.document_date DESC NULLS LAST, d.created_at DESC)
      FROM public.shared_documents sd
      JOIN public.medical_documents d ON d.id = sd.document_id
      WHERE sd.share_id = v_share.id
        AND d.user_id = v_share.user_id
    ), '[]'::jsonb),
    'prescriptions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'prescription_id', pr.id,
        'doctor_name', pr.doctor_name,
        'hospital_name', pr.hospital_name,
        'prescription_date', pr.prescription_date,
        'prescription_time', pr.prescription_time,
        'reason', pr.reason,
        'notes', pr.notes,
        'file_name', pr.file_name,
        'mime_type', pr.mime_type,
        'storage_path', pr.storage_path,
        'medicines', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'medicine_name', m.medicine_name,
            'dosage', m.dosage,
            'frequency', m.frequency,
            'duration_days', m.duration_days,
            'start_date', m.start_date,
            'notes', m.notes
          ) ORDER BY m.created_at)
          FROM public.medicines m
          WHERE m.prescription_id = pr.id AND m.user_id = v_share.user_id
        ), '[]'::jsonb)
      ) ORDER BY pr.prescription_date DESC, pr.created_at DESC)
      FROM public.share_items si
      JOIN public.prescriptions pr ON pr.id = si.item_id
      WHERE si.share_id = v_share.id
        AND si.item_type = 'prescription'
        AND pr.user_id = v_share.user_id
    ), '[]'::jsonb),
    'receipts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'receipt_id', rc.id,
        'pharmacy_name', rc.pharmacy_name,
        'purchase_date', rc.purchase_date,
        'purchase_time', rc.purchase_time,
        'amount', rc.amount,
        'currency', rc.currency,
        'notes', rc.notes,
        'file_name', rc.file_name,
        'mime_type', rc.mime_type,
        'storage_path', rc.storage_path
      ) ORDER BY rc.purchase_date DESC, rc.created_at DESC)
      FROM public.share_items si
      JOIN public.medicine_receipts rc ON rc.id = si.item_id
      WHERE si.share_id = v_share.id
        AND si.item_type = 'receipt'
        AND rc.user_id = v_share.user_id
    ), '[]'::jsonb),
    'appointments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'appointment_id', a.id,
        'appointment_type', a.appointment_type,
        'doctor_name', a.doctor_name,
        'hospital_name', a.hospital_name,
        'appointment_date', a.appointment_date,
        'appointment_time', a.appointment_time,
        'reason', a.reason,
        'notes', a.notes
      ) ORDER BY a.appointment_date DESC, a.appointment_time DESC NULLS LAST)
      FROM public.share_items si
      JOIN public.appointments a ON a.id = si.item_id
      WHERE si.share_id = v_share.id
        AND si.item_type = 'appointment'
        AND a.user_id = v_share.user_id
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_share_pack(TEXT) TO anon, authenticated;

-- Make PostgREST pick up the new tables/functions immediately.
NOTIFY pgrst, 'reload schema';
