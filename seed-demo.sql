-- =============================================================================
-- MediVault  –  Demo Seed Data
-- =============================================================================
-- How to use
--   1. Open the Supabase SQL editor for your project.
--   2. Replace every occurrence of '885bc669-750a-46b8-a7e1-e4f1b69f3bd7' with the UUID of the
--      demo/test Supabase auth user you want to seed (copy it from
--      Authentication → Users in the Supabase dashboard).
--   3. Run the whole script.
--
-- The script is idempotent: re-running it after changing the user-id prefix
-- in the custom IDs is safe because the INSERT statements use
-- ON CONFLICT DO NOTHING.
-- =============================================================================

-- ── 0. Set a convenience variable (Supabase SQL editor supports \set) ─────────
-- If your SQL editor does not support \set, just do a find-and-replace of
-- '885bc669-750a-46b8-a7e1-e4f1b69f3bd7' with the real UUID before running.
-- \set uid '885bc669-750a-46b8-a7e1-e4f1b69f3bd7'

-- For the script below we use the literal placeholder; replace it.
DO $$ BEGIN
  RAISE NOTICE 'Replace 885bc669-750a-46b8-a7e1-e4f1b69f3bd7 with the real auth.users UUID before running.';
END $$;


-- =============================================================================
-- 1. profiles
-- =============================================================================
INSERT INTO profiles (id, full_name, email, date_of_birth)
VALUES (
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'Akhil Kumar',
  'akhilkumar8118k@gmail.com',
  '1989-04-15'          -- makes Alex ~37 years old at demo time
)
ON CONFLICT (id) DO UPDATE
  SET full_name      = EXCLUDED.full_name,
      email          = EXCLUDED.email,
      date_of_birth  = EXCLUDED.date_of_birth;


-- =============================================================================
-- 2. prescriptions  (no real files – storage_path left NULL for demo)
-- =============================================================================
INSERT INTO prescriptions
  (id, user_id, doctor_name, hospital_name,
   prescription_date, prescription_time,
   reason, notes,
   file_name, storage_path, mime_type, file_size)
VALUES

-- Prescription A – Cardiology visit (3 months ago)
( 'a1000000-0000-0000-0000-000000000001',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'Dr. Sarah Jenkins',
  'Metro Heart & Vascular Center',
  (CURRENT_DATE - INTERVAL '90 days'),
  '10:30'::TIME,
  'Annual cardiac review – mild hypertension follow-up',
  'Blood pressure well controlled. Continue current regimen.',
  NULL, NULL, NULL, NULL ),

-- Prescription B – General Practitioner (6 weeks ago)
( 'a1000000-0000-0000-0000-000000000002',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'Dr. Marcus Chen',
  'Greenview Family Clinic',
  (CURRENT_DATE - INTERVAL '42 days'),
  '09:00'::TIME,
  'Seasonal allergy flare-up',
  'Avoid known triggers. Return if symptoms worsen after 2 weeks.',
  NULL, NULL, NULL, NULL ),

-- Prescription C – Endocrinologist (2 weeks ago)
( 'a1000000-0000-0000-0000-000000000003',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'Dr. Priya Nair',
  'Sunrise Diabetes & Endocrine Clinic',
  (CURRENT_DATE - INTERVAL '14 days'),
  '11:15'::TIME,
  'Type-2 diabetes quarterly review',
  'HbA1c improving. Recheck in 3 months.',
  NULL, NULL, NULL, NULL )

ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 3. medicines
-- =============================================================================
INSERT INTO medicines
  (id, user_id, prescription_id,
   medicine_name, dosage, frequency,
   duration_days, start_date, notes)
VALUES

-- ── From Prescription A (Cardiology) ─────────────────────────────────────────
( 'b1000000-0000-0000-0000-000000000001',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'a1000000-0000-0000-0000-000000000001',
  'Amlodipine', '5 mg', 'Once daily',
  NULL,   -- long-term, no end date
  (CURRENT_DATE - INTERVAL '90 days'),
  'Take in the morning with water' ),

( 'b1000000-0000-0000-0000-000000000002',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'a1000000-0000-0000-0000-000000000001',
  'Atorvastatin', '10 mg', 'Once daily at night',
  NULL,
  (CURRENT_DATE - INTERVAL '90 days'),
  'Take at bedtime' ),

-- ── From Prescription B (Allergy) ────────────────────────────────────────────
( 'b1000000-0000-0000-0000-000000000003',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'a1000000-0000-0000-0000-000000000002',
  'Cetirizine', '10 mg', 'Once daily',
  30,
  (CURRENT_DATE - INTERVAL '42 days'),
  'Take at night to reduce drowsiness' ),

( 'b1000000-0000-0000-0000-000000000004',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'a1000000-0000-0000-0000-000000000002',
  'Fluticasone Nasal Spray', '50 mcg per nostril', 'Twice daily',
  30,
  (CURRENT_DATE - INTERVAL '42 days'),
  '2 sprays each nostril morning and night' ),

-- ── From Prescription C (Diabetes) ───────────────────────────────────────────
( 'b1000000-0000-0000-0000-000000000005',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'a1000000-0000-0000-0000-000000000003',
  'Metformin', '500 mg', 'Twice daily',
  NULL,
  (CURRENT_DATE - INTERVAL '14 days'),
  'Take with meals to reduce stomach upset' ),

( 'b1000000-0000-0000-0000-000000000006',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'a1000000-0000-0000-0000-000000000003',
  'Vitamin D3', '1000 IU', 'Once daily',
  NULL,
  (CURRENT_DATE - INTERVAL '14 days'),
  NULL )

ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 4. medication_reminders
--    days_of_week: 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
-- =============================================================================
INSERT INTO medication_reminders
  (id, user_id, medicine_id,
   reminder_times, days_of_week,
   start_date, end_date,
   is_active, notes)
VALUES

-- Amlodipine – every day at 08:00
( 'c1000000-0000-0000-0000-000000000001',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'b1000000-0000-0000-0000-000000000001',
  ARRAY['08:00'::TIME],
  ARRAY[0,1,2,3,4,5,6]::SMALLINT[],
  (CURRENT_DATE - INTERVAL '90 days'),
  NULL, TRUE, 'Morning with breakfast' ),

-- Atorvastatin – every day at 21:30
( 'c1000000-0000-0000-0000-000000000002',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'b1000000-0000-0000-0000-000000000002',
  ARRAY['21:30'::TIME],
  ARRAY[0,1,2,3,4,5,6]::SMALLINT[],
  (CURRENT_DATE - INTERVAL '90 days'),
  NULL, TRUE, 'At bedtime' ),

-- Cetirizine – every day at 21:00  (now completed – within 30-day course)
( 'c1000000-0000-0000-0000-000000000003',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'b1000000-0000-0000-0000-000000000003',
  ARRAY['21:00'::TIME],
  ARRAY[0,1,2,3,4,5,6]::SMALLINT[],
  (CURRENT_DATE - INTERVAL '42 days'),
  (CURRENT_DATE - INTERVAL '13 days'),  -- 30-day course ended
  TRUE, NULL ),

-- Metformin – every day at 08:00 and 20:00
( 'c1000000-0000-0000-0000-000000000004',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'b1000000-0000-0000-0000-000000000005',
  ARRAY['08:00'::TIME, '20:00'::TIME],
  ARRAY[0,1,2,3,4,5,6]::SMALLINT[],
  (CURRENT_DATE - INTERVAL '14 days'),
  NULL, TRUE, 'With meals' )

ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 5. medication_reminder_logs  (a few days of history)
-- =============================================================================
INSERT INTO medication_reminder_logs
  (id, user_id, reminder_id,
   scheduled_date, scheduled_time,
   status, logged_at)
VALUES

-- Amlodipine taken for the past 5 days
( 'd1000000-0000-0000-0000-000000000001', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000001',
  (CURRENT_DATE - INTERVAL '5 days'), '08:00'::TIME, 'taken',
  (CURRENT_DATE - INTERVAL '5 days' + INTERVAL '8 hours 3 minutes')::timestamptz ),

( 'd1000000-0000-0000-0000-000000000002', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000001',
  (CURRENT_DATE - INTERVAL '4 days'), '08:00'::TIME, 'taken',
  (CURRENT_DATE - INTERVAL '4 days' + INTERVAL '8 hours 1 minute')::timestamptz ),

( 'd1000000-0000-0000-0000-000000000003', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000001',
  (CURRENT_DATE - INTERVAL '3 days'), '08:00'::TIME, 'taken',
  (CURRENT_DATE - INTERVAL '3 days' + INTERVAL '8 hours 12 minutes')::timestamptz ),

( 'd1000000-0000-0000-0000-000000000004', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000001',
  (CURRENT_DATE - INTERVAL '2 days'), '08:00'::TIME, 'skipped',
  (CURRENT_DATE - INTERVAL '2 days' + INTERVAL '8 hours 45 minutes')::timestamptz ),

( 'd1000000-0000-0000-0000-000000000005', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000001',
  (CURRENT_DATE - INTERVAL '1 day'), '08:00'::TIME, 'taken',
  (CURRENT_DATE - INTERVAL '1 day' + INTERVAL '8 hours 5 minutes')::timestamptz ),

-- Metformin morning – last 3 days
( 'd1000000-0000-0000-0000-000000000006', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000004',
  (CURRENT_DATE - INTERVAL '3 days'), '08:00'::TIME, 'taken',
  (CURRENT_DATE - INTERVAL '3 days' + INTERVAL '8 hours 10 minutes')::timestamptz ),

( 'd1000000-0000-0000-0000-000000000007', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000004',
  (CURRENT_DATE - INTERVAL '2 days'), '08:00'::TIME, 'taken',
  (CURRENT_DATE - INTERVAL '2 days' + INTERVAL '8 hours 7 minutes')::timestamptz ),

( 'd1000000-0000-0000-0000-000000000008', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000004',
  (CURRENT_DATE - INTERVAL '1 day'), '08:00'::TIME, 'taken',
  (CURRENT_DATE - INTERVAL '1 day' + INTERVAL '8 hours 4 minutes')::timestamptz ),

-- Metformin evening – last 2 days
( 'd1000000-0000-0000-0000-000000000009', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000004',
  (CURRENT_DATE - INTERVAL '2 days'), '20:00'::TIME, 'taken',
  (CURRENT_DATE - INTERVAL '2 days' + INTERVAL '20 hours 2 minutes')::timestamptz ),

( 'd1000000-0000-0000-0000-000000000010', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'c1000000-0000-0000-0000-000000000004',
  (CURRENT_DATE - INTERVAL '1 day'), '20:00'::TIME, 'taken',
  (CURRENT_DATE - INTERVAL '1 day' + INTERVAL '20 hours 9 minutes')::timestamptz )

ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 6. appointments
-- =============================================================================
INSERT INTO appointments
  (id, user_id,
   doctor_name, hospital_name,
   appointment_date, appointment_time,
   reason, notes,
   appointment_type, remind_before_minutes,
   status)
VALUES

-- Past: routine GP checkup (last month)
( 'e1000000-0000-0000-0000-000000000001',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'Dr. Marcus Chen', 'Greenview Family Clinic',
  (CURRENT_DATE - INTERVAL '30 days'), '09:30'::TIME,
  'Routine annual checkup',
  'Bloodwork ordered. Results reviewed and within normal range.',
  'appointment', NULL, 'completed' ),

-- Past: Dermatology consult (3 weeks ago)
( 'e1000000-0000-0000-0000-000000000002',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'Dr. Aisha Mohammed', 'ClearSkin Dermatology',
  (CURRENT_DATE - INTERVAL '21 days'), '14:00'::TIME,
  'Skin rash evaluation',
  'Mild eczema. Topical cream prescribed.',
  'appointment', NULL, 'completed' ),

-- Upcoming: Cardiology follow-up (in 7 days at 10:30) – with reminder
( 'e1000000-0000-0000-0000-000000000003',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'Dr. Sarah Jenkins', 'Metro Heart & Vascular Center',
  (CURRENT_DATE + INTERVAL '7 days'), '10:30'::TIME,
  'Blood pressure 3-month review',
  'Bring home BP log.',
  'follow_up', 1440, 'scheduled' ),

-- Upcoming: Endocrinologist follow-up (in 3 months)
( 'e1000000-0000-0000-0000-000000000004',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'Dr. Priya Nair', 'Sunrise Diabetes & Endocrine Clinic',
  (CURRENT_DATE + INTERVAL '76 days'), '11:15'::TIME,
  'HbA1c 3-month review',
  'Fast overnight before the blood draw.',
  'follow_up', 2880, 'scheduled' ),

-- Upcoming: Eye exam (in 2 weeks)
( 'e1000000-0000-0000-0000-000000000005',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'Dr. Linda Ortega', 'VisionPlus Eye Care',
  (CURRENT_DATE + INTERVAL '14 days'), '15:45'::TIME,
  'Annual eye exam',
  NULL,
  'appointment', 1440, 'scheduled' )

ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 7. medicine_receipts  (storage_path uses a realistic path pattern; the file
--    itself does not need to exist for the row to display in the UI since the
--    UI only fetches a signed URL on demand)
-- =============================================================================
INSERT INTO medicine_receipts
  (id, user_id, prescription_id,
   pharmacy_name,
   purchase_date, purchase_time,
   amount, currency,
   notes,
   file_name, storage_path, mime_type, file_size)
VALUES

-- Receipt 1 – Amlodipine & Atorvastatin (matches Prescription A)
( 'f1000000-0000-0000-0000-000000000001',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'a1000000-0000-0000-0000-000000000001',
  'CityMed Pharmacy',
  (CURRENT_DATE - INTERVAL '89 days'), '11:20'::TIME,
  840.00, 'INR',
  'Purchased 1-month supply of both medicines',
  'receipt-citymed-jan.jpg',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7/receipts/receipt-citymed-jan.jpg',
  'image/jpeg', 204800 ),

-- Receipt 2 – Allergy medicines refill
( 'f1000000-0000-0000-0000-000000000002',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'a1000000-0000-0000-0000-000000000002',
  'HealthFirst Pharmacy',
  (CURRENT_DATE - INTERVAL '41 days'), '09:45'::TIME,
  320.00, 'INR',
  'Cetirizine 30 tabs + nasal spray',
  'receipt-healthfirst-allergy.pdf',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7/receipts/receipt-healthfirst-allergy.pdf',
  'application/pdf', 98304 ),

-- Receipt 3 – Metformin monthly refill
( 'f1000000-0000-0000-0000-000000000003',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'a1000000-0000-0000-0000-000000000003',
  'Apollo Pharmacy',
  (CURRENT_DATE - INTERVAL '13 days'), '13:10'::TIME,
  560.00, 'INR',
  'Metformin 500 mg x 60 tabs, Vitamin D3 x 30 softgels',
  'receipt-apollo-metformin.jpg',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7/receipts/receipt-apollo-metformin.jpg',
  'image/jpeg', 156000 ),

-- Receipt 4 – Amlodipine refill last week (no linked prescription to show the optional state)
( 'f1000000-0000-0000-0000-000000000004',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  NULL,
  'CityMed Pharmacy',
  (CURRENT_DATE - INTERVAL '7 days'), '10:30'::TIME,
  420.00, 'INR',
  NULL,
  'receipt-citymed-feb.jpg',
  '885bc669-750a-46b8-a7e1-e4f1b69f3bd7/receipts/receipt-citymed-feb.jpg',
  'image/jpeg', 187000 )

ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- 8. audit_logs  (a lightweight activity trail shown in the timeline)
-- =============================================================================
INSERT INTO audit_logs
  (id, user_id, action, event_type, title, metadata)
VALUES

( 'a2000000-0000-0000-0000-000000000001', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'prescription_created', 'prescription_created',
  'Prescription added',
  '{"prescription_id":"a1000000-0000-0000-0000-000000000001","medicine_count":2}' ),

( 'a2000000-0000-0000-0000-000000000002', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'prescription_created', 'prescription_created',
  'Prescription added',
  '{"prescription_id":"a1000000-0000-0000-0000-000000000002","medicine_count":2}' ),

( 'a2000000-0000-0000-0000-000000000003', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'prescription_created', 'prescription_created',
  'Prescription added',
  '{"prescription_id":"a1000000-0000-0000-0000-000000000003","medicine_count":2}' ),

( 'a2000000-0000-0000-0000-000000000004', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'appointment_created', 'appointment_created',
  'Appointment scheduled',
  '{}' ),

( 'a2000000-0000-0000-0000-000000000005', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'receipt_uploaded', 'receipt_uploaded',
  'Medicine receipt uploaded',
  '{"receipt_id":"f1000000-0000-0000-0000-000000000001"}' ),

( 'a2000000-0000-0000-0000-000000000006', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'receipt_uploaded', 'receipt_uploaded',
  'Medicine receipt uploaded',
  '{"receipt_id":"f1000000-0000-0000-0000-000000000002"}' ),

( 'a2000000-0000-0000-0000-000000000007', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'receipt_uploaded', 'receipt_uploaded',
  'Medicine receipt uploaded',
  '{"receipt_id":"f1000000-0000-0000-0000-000000000003"}' ),

( 'a2000000-0000-0000-0000-000000000008', '885bc669-750a-46b8-a7e1-e4f1b69f3bd7',
  'dose_logged', 'dose_logged',
  'Dose marked taken',
  '{"reminder_id":"c1000000-0000-0000-0000-000000000001","status":"taken"}' )

ON CONFLICT (id) DO NOTHING;


-- =============================================================================
-- Done!
-- =============================================================================
-- Summary of what was seeded:
--   • 1 user profile  (Akhil Kumar, DOB 1989-04-15)
--   • 3 prescriptions (Cardiology, Allergy, Diabetes)
--   • 6 medicines across those prescriptions
--   • 4 medication reminder schedules
--   • 10 reminder log entries (taken / skipped history)
--   • 5 appointments  (2 past/completed, 3 upcoming/scheduled)
--   • 4 pharmacy receipts  (₹2,140 total)
--   • 8 audit log entries
-- =============================================================================
