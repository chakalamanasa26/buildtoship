// Shared data types for MediVault tables.

export type Doc = {
  id: string;
  user_id?: string;
  title: string;
  category: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  document_date: string | null;
  /** Exact time of the medical event (HH:MM[:SS]); optional. */
  document_time?: string | null;
  doctor_name: string | null;
  hospital_name: string | null;
  description: string | null;
  extracted_text: string | null;
  ai_summary: string | null;
  ai_status: string | null;
  created_at: string;
};

export type AppointmentType = 'appointment' | 'follow_up';

export type Appt = {
  id: string;
  user_id?: string;
  doctor_name: string | null;
  hospital_name: string | null;
  appointment_date: string;
  appointment_time: string | null;
  reason: string | null;
  notes: string | null;
  status: string | null;
  appointment_type?: AppointmentType | null;
  /** Minutes before the visit to remind; null/undefined = no reminder. */
  remind_before_minutes?: number | null;
  created_at?: string;
};

export type ShareItem = {
  id: string;
  user_id?: string;
  recipient: string | null;
  permission: 'VIEW' | 'VIEW_DOWNLOAD';
  token_hash: string;
  expires_at: string;
  max_views: number | null;
  view_count: number | null;
  revoked_at: string | null;
  created_at: string;
  kind?: 'documents' | 'visit_pack' | null;
  title?: string | null;
  note?: string | null;
  include_patient_info?: boolean | null;
  documents?: Doc[];
};

export type AuditLog = {
  id: string;
  user_id?: string;
  action: string;
  event_type?: string;
  title: string;
  metadata?: Record<string, any> | string | null;
  created_at: string;
};

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  date_of_birth?: string | null;
};

export type Prescription = {
  id: string;
  user_id?: string;
  doctor_name: string;
  hospital_name: string | null;
  prescription_date: string;
  prescription_time: string | null;
  reason: string | null;
  notes: string | null;
  file_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
};

export type Medicine = {
  id: string;
  user_id?: string;
  prescription_id: string;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration_days: number | null;
  start_date: string | null;
  notes: string | null;
  created_at: string;
};

export type Receipt = {
  id: string;
  user_id?: string;
  prescription_id: string | null;
  pharmacy_name: string;
  purchase_date: string;
  purchase_time: string | null;
  amount: number | string;
  currency: string;
  notes: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  created_at: string;
};

export type MedReminder = {
  id: string;
  user_id?: string;
  medicine_id: string;
  reminder_times: string[];
  days_of_week: number[];
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
};

export type ReminderLog = {
  id: string;
  user_id?: string;
  reminder_id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: 'taken' | 'skipped';
  logged_at: string;
};
