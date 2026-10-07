import { useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { recordAudit } from '@/lib/helpers';
import type { Appt, AppointmentType } from '@/lib/types';
import { localToday, normTime, REMIND_OPTIONS } from '@/lib/datetime';
import { Field, Modal, SelectField, TextAreaField, primaryButtonCls } from '@/components/common';

export type AppointmentDefaults = {
  appointment_type?: AppointmentType;
  doctor_name?: string;
  hospital_name?: string;
  remind_before_minutes?: number | null;
};

/**
 * Create / edit an appointment or a next-visit follow-up.
 * The exact date AND time are required for new entries so reminders are precise.
 */
export function AppointmentModal({
  initial,
  defaults,
  onClose,
  onSaved,
}: {
  initial: Appt | null;
  defaults?: AppointmentDefaults;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<AppointmentType>(
    initial?.appointment_type || defaults?.appointment_type || 'appointment'
  );

  const remindDefault =
    initial?.remind_before_minutes ?? defaults?.remind_before_minutes ?? null;

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    const f = new FormData(e.currentTarget);
    const time = normTime(String(f.get('appointment_time') || ''));
    const remindRaw = String(f.get('remind_before_minutes') || '');
    const remind = remindRaw === '' ? null : Number(remindRaw);

    if (!time) {
      setError('Please enter the time of the visit.');
      return;
    }

    setBusy(true);
    setError(null);

    const payload: Record<string, unknown> = {
      user_id: user.id,
      doctor_name: String(f.get('doctor_name') || '').trim() || null,
      hospital_name: String(f.get('hospital_name') || '').trim() || null,
      appointment_date: String(f.get('appointment_date')),
      appointment_time: time,
      reason: String(f.get('reason') || '').trim() || null,
      notes: String(f.get('notes') || '').trim() || null,
    };
    // Only send the newer columns when they carry information, so plain appointments
    // keep working exactly as before.
    if (type !== 'appointment' || initial?.appointment_type) payload.appointment_type = type;
    if (remind !== null || (initial && initial.remind_before_minutes != null)) {
      payload.remind_before_minutes = remind;
    }

    const res = initial
      ? await supabase.from('appointments').update(payload).eq('id', initial.id)
      : await supabase.from('appointments').insert({ ...payload, status: 'scheduled' });

    setBusy(false);
    if (res.error) {
      setError(res.error.message);
      return;
    }
    const label = type === 'follow_up' ? 'Follow-up' : 'Appointment';
    await recordAudit(
      user.id,
      initial ? 'appointment_updated' : 'appointment_created',
      initial ? `${label} updated` : `${label} scheduled`
    );
    onSaved(
      initial
        ? `${label} updated.`
        : type === 'follow_up'
        ? 'Follow-up added to your schedule.'
        : 'Appointment added to your schedule.'
    );
  }

  return (
    <Modal
      title={initial ? 'Edit appointment' : type === 'follow_up' ? 'Add a follow-up visit' : 'Add an appointment'}
      close={onClose}
    >
      <form onSubmit={save} className="space-y-4" data-testid="form-appointment">
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900"
            data-testid="status-appointment-error"
          >
            {error}
          </div>
        )}
        <SelectField
          label="Type"
          name="appointment_type"
          value={type}
          onChange={(e) => setType(e.target.value as AppointmentType)}
        >
          <option value="appointment">Appointment</option>
          <option value="follow_up">Next visit / follow-up</option>
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Provider or Doctor"
            name="doctor_name"
            placeholder="e.g. Dr. Sarah Jenkins"
            defaultValue={initial?.doctor_name || defaults?.doctor_name || ''}
          />
          <Field
            label="Clinic or Hospital"
            name="hospital_name"
            placeholder="e.g. Metro Health Center"
            defaultValue={initial?.hospital_name || defaults?.hospital_name || ''}
          />
          <Field
            label="Date"
            name="appointment_date"
            type="date"
            required
            defaultValue={initial?.appointment_date || localToday()}
          />
          <Field
            label="Time"
            name="appointment_time"
            type="time"
            required
            defaultValue={normTime(initial?.appointment_time) || ''}
          />
        </div>
        <Field
          label="Reason or visit type"
          name="reason"
          placeholder="e.g. Annual physical checkup"
          defaultValue={initial?.reason || ''}
        />
        <SelectField
          label="Remind me"
          name="remind_before_minutes"
          defaultValue={remindDefault === null ? '' : String(remindDefault)}
        >
          <option value="">No reminder</option>
          {REMIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <TextAreaField label="Notes" name="notes" defaultValue={initial?.notes || ''} />
        <button disabled={busy} className={`${primaryButtonCls} w-full`} data-testid="button-save-appointment">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {initial ? 'Update appointment' : type === 'follow_up' ? 'Save follow-up' : 'Save appointment'}
        </button>
      </form>
    </Modal>
  );
}
