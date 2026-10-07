/**
 * MediVault – Demo Seed Script  (ESM / Node.js)
 * ================================================
 * Inserts realistic demo data into Supabase for a single user.
 *
 * Prerequisites
 * -------------
 *   node >= 18
 *   npm install @supabase/supabase-js   (already in package.json)
 *
 * Usage
 * -----
 *   node seed-demo.mjs <USER_ID>
 *
 *   USER_ID  – the UUID from Authentication → Users in the Supabase dashboard.
 *
 * Environment variables (reads from .env automatically)
 * -------------------------------------------------------
 *   VITE_SUPABASE_URL
 *   VITE_SUPABASE_PUBLISHABLE_KEY   (or the NEXT_PUBLIC_ variants)
 *
 * The script uses the publishable (anon) key because the records are inserted
 * with RLS-compatible user_id values.  If your tables have strict RLS you may
 * need the SERVICE_ROLE key instead – set SUPABASE_SERVICE_ROLE_KEY in .env
 * and the script will prefer it automatically.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

// ─── 1. Load .env manually (no dotenv dependency needed) ────────────────────
const __dirname = fileURLToPath(new URL('.', import.meta.url));
try {
  const envText = readFileSync(resolve(__dirname, '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {
  // .env not found – rely on environment variables already set
}

// ─── 2. Config ────────────────────────────────────────────────────────────────
const supabaseUrl =
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL || '';

const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||          // prefer service key if available
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error('ERROR: Supabase URL or key not found. Check your .env file.');
  process.exit(1);
}

const userId = process.argv[2];
if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
  console.error('Usage: node seed-demo.mjs <USER_UUID>');
  console.error('Example: node seed-demo.mjs 550e8400-e29b-41d4-a716-446655440000');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ─── 3. Date helpers ─────────────────────────────────────────────────────────
/** YYYY-MM-DD, offset by +/- days from today */
function d(offsetDays = 0) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

// ─── 4. Seed data ─────────────────────────────────────────────────────────────

// ── 4a. Profile ───────────────────────────────────────────────────────────────
async function seedProfile() {
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    full_name: 'Akhil Kumar',
    email: 'akhilkumar8118k@gmail.com',
    date_of_birth: '1989-04-15',
  });
  if (error) throw new Error(`profiles: ${error.message}`);
  console.log('✓ profile');
}

// ── 4b. Prescriptions ─────────────────────────────────────────────────────────
const RX = [
  {
    id: 'a1000000-0000-0000-0000-000000000001',
    doctor_name: 'Dr. Sarah Jenkins',
    hospital_name: 'Metro Heart & Vascular Center',
    prescription_date: d(-90),
    prescription_time: '10:30',
    reason: 'Annual cardiac review – mild hypertension follow-up',
    notes: 'Blood pressure well controlled. Continue current regimen.',
  },
  {
    id: 'a1000000-0000-0000-0000-000000000002',
    doctor_name: 'Dr. Marcus Chen',
    hospital_name: 'Greenview Family Clinic',
    prescription_date: d(-42),
    prescription_time: '09:00',
    reason: 'Seasonal allergy flare-up',
    notes: 'Avoid known triggers. Return if symptoms worsen after 2 weeks.',
  },
  {
    id: 'a1000000-0000-0000-0000-000000000003',
    doctor_name: 'Dr. Priya Nair',
    hospital_name: 'Sunrise Diabetes & Endocrine Clinic',
    prescription_date: d(-14),
    prescription_time: '11:15',
    reason: 'Type-2 diabetes quarterly review',
    notes: 'HbA1c improving. Recheck in 3 months.',
  },
];

async function seedPrescriptions() {
  const rows = RX.map((r) => ({ ...r, user_id: userId }));
  const { error } = await supabase.from('prescriptions').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`prescriptions: ${error.message}`);
  console.log(`✓ ${rows.length} prescriptions`);
}

// ── 4c. Medicines ─────────────────────────────────────────────────────────────
const MEDICINES = [
  // Cardiology
  { id: 'b1000000-0000-0000-0000-000000000001', prescription_id: 'a1000000-0000-0000-0000-000000000001', medicine_name: 'Amlodipine',            dosage: '5 mg',                frequency: 'Once daily',          duration_days: null, start_date: d(-90), notes: 'Take in the morning with water' },
  { id: 'b1000000-0000-0000-0000-000000000002', prescription_id: 'a1000000-0000-0000-0000-000000000001', medicine_name: 'Atorvastatin',           dosage: '10 mg',               frequency: 'Once daily at night', duration_days: null, start_date: d(-90), notes: 'Take at bedtime' },
  // Allergy
  { id: 'b1000000-0000-0000-0000-000000000003', prescription_id: 'a1000000-0000-0000-0000-000000000002', medicine_name: 'Cetirizine',             dosage: '10 mg',               frequency: 'Once daily',          duration_days: 30,   start_date: d(-42), notes: 'Take at night to reduce drowsiness' },
  { id: 'b1000000-0000-0000-0000-000000000004', prescription_id: 'a1000000-0000-0000-0000-000000000002', medicine_name: 'Fluticasone Nasal Spray',dosage: '50 mcg per nostril',   frequency: 'Twice daily',         duration_days: 30,   start_date: d(-42), notes: '2 sprays each nostril morning and night' },
  // Diabetes
  { id: 'b1000000-0000-0000-0000-000000000005', prescription_id: 'a1000000-0000-0000-0000-000000000003', medicine_name: 'Metformin',              dosage: '500 mg',              frequency: 'Twice daily',         duration_days: null, start_date: d(-14), notes: 'Take with meals to reduce stomach upset' },
  { id: 'b1000000-0000-0000-0000-000000000006', prescription_id: 'a1000000-0000-0000-0000-000000000003', medicine_name: 'Vitamin D3',             dosage: '1000 IU',             frequency: 'Once daily',          duration_days: null, start_date: d(-14), notes: null },
];

async function seedMedicines() {
  const rows = MEDICINES.map((m) => ({ ...m, user_id: userId }));
  const { error } = await supabase.from('medicines').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`medicines: ${error.message}`);
  console.log(`✓ ${rows.length} medicines`);
}

// ── 4d. Medication reminders ──────────────────────────────────────────────────
const REMINDERS = [
  { id: 'c1000000-0000-0000-0000-000000000001', medicine_id: 'b1000000-0000-0000-0000-000000000001', reminder_times: ['08:00'], days_of_week: [0,1,2,3,4,5,6], start_date: d(-90), end_date: null,   is_active: true, notes: 'Morning with breakfast' },
  { id: 'c1000000-0000-0000-0000-000000000002', medicine_id: 'b1000000-0000-0000-0000-000000000002', reminder_times: ['21:30'], days_of_week: [0,1,2,3,4,5,6], start_date: d(-90), end_date: null,   is_active: true, notes: 'At bedtime' },
  { id: 'c1000000-0000-0000-0000-000000000003', medicine_id: 'b1000000-0000-0000-0000-000000000003', reminder_times: ['21:00'], days_of_week: [0,1,2,3,4,5,6], start_date: d(-42), end_date: d(-13), is_active: true, notes: null },
  { id: 'c1000000-0000-0000-0000-000000000004', medicine_id: 'b1000000-0000-0000-0000-000000000005', reminder_times: ['08:00','20:00'], days_of_week: [0,1,2,3,4,5,6], start_date: d(-14), end_date: null, is_active: true, notes: 'With meals' },
];

async function seedReminders() {
  const rows = REMINDERS.map((r) => ({ ...r, user_id: userId }));
  const { error } = await supabase.from('medication_reminders').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`medication_reminders: ${error.message}`);
  console.log(`✓ ${rows.length} medication reminders`);
}

// ── 4e. Reminder logs ─────────────────────────────────────────────────────────
function ts(offsetDays, hh, mm) {
  const dt = new Date();
  dt.setDate(dt.getDate() + offsetDays);
  dt.setHours(hh, mm, 0, 0);
  return dt.toISOString();
}

const LOGS = [
  // Amlodipine – 5 days of history
  { id: 'd1000000-0000-0000-0000-000000000001', reminder_id: 'c1000000-0000-0000-0000-000000000001', scheduled_date: d(-5), scheduled_time: '08:00', status: 'taken',   logged_at: ts(-5,  8,  3) },
  { id: 'd1000000-0000-0000-0000-000000000002', reminder_id: 'c1000000-0000-0000-0000-000000000001', scheduled_date: d(-4), scheduled_time: '08:00', status: 'taken',   logged_at: ts(-4,  8,  1) },
  { id: 'd1000000-0000-0000-0000-000000000003', reminder_id: 'c1000000-0000-0000-0000-000000000001', scheduled_date: d(-3), scheduled_time: '08:00', status: 'taken',   logged_at: ts(-3,  8, 12) },
  { id: 'd1000000-0000-0000-0000-000000000004', reminder_id: 'c1000000-0000-0000-0000-000000000001', scheduled_date: d(-2), scheduled_time: '08:00', status: 'skipped', logged_at: ts(-2,  8, 45) },
  { id: 'd1000000-0000-0000-0000-000000000005', reminder_id: 'c1000000-0000-0000-0000-000000000001', scheduled_date: d(-1), scheduled_time: '08:00', status: 'taken',   logged_at: ts(-1,  8,  5) },
  // Metformin morning
  { id: 'd1000000-0000-0000-0000-000000000006', reminder_id: 'c1000000-0000-0000-0000-000000000004', scheduled_date: d(-3), scheduled_time: '08:00', status: 'taken',   logged_at: ts(-3,  8, 10) },
  { id: 'd1000000-0000-0000-0000-000000000007', reminder_id: 'c1000000-0000-0000-0000-000000000004', scheduled_date: d(-2), scheduled_time: '08:00', status: 'taken',   logged_at: ts(-2,  8,  7) },
  { id: 'd1000000-0000-0000-0000-000000000008', reminder_id: 'c1000000-0000-0000-0000-000000000004', scheduled_date: d(-1), scheduled_time: '08:00', status: 'taken',   logged_at: ts(-1,  8,  4) },
  // Metformin evening
  { id: 'd1000000-0000-0000-0000-000000000009', reminder_id: 'c1000000-0000-0000-0000-000000000004', scheduled_date: d(-2), scheduled_time: '20:00', status: 'taken',   logged_at: ts(-2, 20,  2) },
  { id: 'd1000000-0000-0000-0000-000000000010', reminder_id: 'c1000000-0000-0000-0000-000000000004', scheduled_date: d(-1), scheduled_time: '20:00', status: 'taken',   logged_at: ts(-1, 20,  9) },
];

async function seedLogs() {
  const rows = LOGS.map((l) => ({ ...l, user_id: userId }));
  const { error } = await supabase.from('medication_reminder_logs').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`medication_reminder_logs: ${error.message}`);
  console.log(`✓ ${rows.length} reminder logs`);
}

// ── 4f. Appointments ──────────────────────────────────────────────────────────
const APPOINTMENTS = [
  { id: 'e1000000-0000-0000-0000-000000000001', doctor_name: 'Dr. Marcus Chen',   hospital_name: 'Greenview Family Clinic',            appointment_date: d(-30), appointment_time: '09:30', reason: 'Routine annual checkup',           notes: 'Bloodwork ordered. Results reviewed and within normal range.', appointment_type: 'appointment', remind_before_minutes: null, status: 'completed' },
  { id: 'e1000000-0000-0000-0000-000000000002', doctor_name: 'Dr. Aisha Mohammed',hospital_name: 'ClearSkin Dermatology',               appointment_date: d(-21), appointment_time: '14:00', reason: 'Skin rash evaluation',             notes: 'Mild eczema. Topical cream prescribed.',                      appointment_type: 'appointment', remind_before_minutes: null, status: 'completed' },
  { id: 'e1000000-0000-0000-0000-000000000003', doctor_name: 'Dr. Sarah Jenkins', hospital_name: 'Metro Heart & Vascular Center',       appointment_date: d(7),   appointment_time: '10:30', reason: 'Blood pressure 3-month review',     notes: 'Bring home BP log.',                                          appointment_type: 'follow_up',   remind_before_minutes: 1440, status: 'scheduled' },
  { id: 'e1000000-0000-0000-0000-000000000004', doctor_name: 'Dr. Priya Nair',    hospital_name: 'Sunrise Diabetes & Endocrine Clinic', appointment_date: d(76),  appointment_time: '11:15', reason: 'HbA1c 3-month review',             notes: 'Fast overnight before the blood draw.',                       appointment_type: 'follow_up',   remind_before_minutes: 2880, status: 'scheduled' },
  { id: 'e1000000-0000-0000-0000-000000000005', doctor_name: 'Dr. Linda Ortega',  hospital_name: 'VisionPlus Eye Care',                 appointment_date: d(14),  appointment_time: '15:45', reason: 'Annual eye exam',                  notes: null,                                                          appointment_type: 'appointment', remind_before_minutes: 1440, status: 'scheduled' },
];

async function seedAppointments() {
  const rows = APPOINTMENTS.map((a) => ({ ...a, user_id: userId }));
  const { error } = await supabase.from('appointments').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`appointments: ${error.message}`);
  console.log(`✓ ${rows.length} appointments`);
}

// ── 4g. Medicine receipts ─────────────────────────────────────────────────────
// Note: the storage_path references files that do not exist in the bucket, so
// clicking "View" will return an error – acceptable for a UI demo.  To fix it,
// upload dummy PDF/image files at those paths via the Supabase Storage UI.
const RECEIPTS = [
  { id: 'f1000000-0000-0000-0000-000000000001', prescription_id: 'a1000000-0000-0000-0000-000000000001', pharmacy_name: 'CityMed Pharmacy',     purchase_date: d(-89), purchase_time: '11:20', amount: 840.00, currency: 'INR', notes: 'Purchased 1-month supply of both medicines',             file_name: 'receipt-citymed-jan.jpg',         storage_path: `${userId}/receipts/receipt-citymed-jan.jpg`,         mime_type: 'image/jpeg',       file_size: 204800 },
  { id: 'f1000000-0000-0000-0000-000000000002', prescription_id: 'a1000000-0000-0000-0000-000000000002', pharmacy_name: 'HealthFirst Pharmacy', purchase_date: d(-41), purchase_time: '09:45', amount: 320.00, currency: 'INR', notes: 'Cetirizine 30 tabs + nasal spray',                       file_name: 'receipt-healthfirst-allergy.pdf', storage_path: `${userId}/receipts/receipt-healthfirst-allergy.pdf`, mime_type: 'application/pdf',  file_size:  98304 },
  { id: 'f1000000-0000-0000-0000-000000000003', prescription_id: 'a1000000-0000-0000-0000-000000000003', pharmacy_name: 'Apollo Pharmacy',      purchase_date: d(-13), purchase_time: '13:10', amount: 560.00, currency: 'INR', notes: 'Metformin 500 mg x 60 tabs, Vitamin D3 x 30 softgels', file_name: 'receipt-apollo-metformin.jpg',    storage_path: `${userId}/receipts/receipt-apollo-metformin.jpg`,    mime_type: 'image/jpeg',       file_size: 156000 },
  { id: 'f1000000-0000-0000-0000-000000000004', prescription_id: null,                                   pharmacy_name: 'CityMed Pharmacy',     purchase_date: d(-7),  purchase_time: '10:30', amount: 420.00, currency: 'INR', notes: null,                                                     file_name: 'receipt-citymed-feb.jpg',         storage_path: `${userId}/receipts/receipt-citymed-feb.jpg`,         mime_type: 'image/jpeg',       file_size: 187000 },
];

async function seedReceipts() {
  const rows = RECEIPTS.map((r) => ({ ...r, user_id: userId }));
  const { error } = await supabase.from('medicine_receipts').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`medicine_receipts: ${error.message}`);
  console.log(`✓ ${rows.length} medicine receipts`);
}

// ── 4h. Audit logs ────────────────────────────────────────────────────────────
const AUDIT = [
  { id: 'g1000000-0000-0000-0000-000000000001', action: 'prescription_created', event_type: 'prescription_created', title: 'Prescription added',        metadata: { prescription_id: 'a1000000-0000-0000-0000-000000000001', medicine_count: 2 } },
  { id: 'g1000000-0000-0000-0000-000000000002', action: 'prescription_created', event_type: 'prescription_created', title: 'Prescription added',        metadata: { prescription_id: 'a1000000-0000-0000-0000-000000000002', medicine_count: 2 } },
  { id: 'g1000000-0000-0000-0000-000000000003', action: 'prescription_created', event_type: 'prescription_created', title: 'Prescription added',        metadata: { prescription_id: 'a1000000-0000-0000-0000-000000000003', medicine_count: 2 } },
  { id: 'g1000000-0000-0000-0000-000000000004', action: 'appointment_created',  event_type: 'appointment_created',  title: 'Appointment scheduled',     metadata: {} },
  { id: 'g1000000-0000-0000-0000-000000000005', action: 'receipt_uploaded',     event_type: 'receipt_uploaded',     title: 'Medicine receipt uploaded', metadata: { receipt_id: 'f1000000-0000-0000-0000-000000000001' } },
  { id: 'g1000000-0000-0000-0000-000000000006', action: 'receipt_uploaded',     event_type: 'receipt_uploaded',     title: 'Medicine receipt uploaded', metadata: { receipt_id: 'f1000000-0000-0000-0000-000000000002' } },
  { id: 'g1000000-0000-0000-0000-000000000007', action: 'receipt_uploaded',     event_type: 'receipt_uploaded',     title: 'Medicine receipt uploaded', metadata: { receipt_id: 'f1000000-0000-0000-0000-000000000003' } },
  { id: 'g1000000-0000-0000-0000-000000000008', action: 'dose_logged',          event_type: 'dose_logged',          title: 'Dose marked taken',         metadata: { reminder_id: 'c1000000-0000-0000-0000-000000000001', status: 'taken' } },
];

async function seedAudit() {
  const rows = AUDIT.map((a) => ({ ...a, user_id: userId }));
  const { error } = await supabase.from('audit_logs').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`audit_logs: ${error.message}`);
  console.log(`✓ ${rows.length} audit log entries`);
}

// ─── 5. Run all ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🌱  Seeding MediVault demo data for user ${userId}\n`);
  await seedProfile();
  await seedPrescriptions();
  await seedMedicines();
  await seedReminders();
  await seedLogs();
  await seedAppointments();
  await seedReceipts();
  await seedAudit();
  console.log('\n✅  Done! Here is what was seeded:');
  console.log('   • Profile:  Akhil Kumar  (DOB 1989-04-15)');
  console.log('   • 3 prescriptions  (Cardiology, Allergy, Diabetes)');
  console.log('   • 6 medicines across those prescriptions');
  console.log('   • 4 medication reminder schedules');
  console.log('   • 10 reminder log entries (taken / skipped history)');
  console.log('   • 5 appointments  (2 completed, 3 upcoming)');
  console.log('   • 4 pharmacy receipts  (₹2,140 total)');
  console.log('   • 8 audit log entries\n');
}

main().catch((err) => {
  console.error('\n❌  Seed failed:', err.message);
  process.exit(1);
});
