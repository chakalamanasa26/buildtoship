import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import {
  ArrowDownToLine,
  Bell,
  Edit3,
  LoaderCircle,
  Paperclip,
  Pill,
  Plus,
  Receipt as ReceiptIcon,
  Search,
  Stethoscope,
  Trash2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { recordAudit } from '@/lib/helpers';
import type { Medicine, Prescription } from '@/lib/types';
import { courseEnd, formatDate, formatDateTime, localToday, normTime } from '@/lib/datetime';
import { removeStoredFiles, signedUrl, uploadPrivateFile, formatFileSize, type StoredFile } from '@/lib/storage';
import {
  Badge,
  DataAlert,
  EmptyState,
  Field,
  FileDropField,
  Modal,
  Notice,
  PageHeading,
  SkeletonRows,
  TextAreaField,
  ghostButtonCls,
  primaryButtonCls,
  useRows,
} from '@/components/common';
import { AppointmentModal } from '@/features/appointment-form';
import { MedicationReminderModal, useReminders } from '@/features/reminders';

const FREQUENCY_SUGGESTIONS = [
  'Once daily',
  'Twice daily',
  'Three times daily',
  'Four times daily',
  'Every 8 hours',
  'Every 12 hours',
  'Once weekly',
  'As written on prescription',
];

type MedRow = {
  key: string;
  id?: string;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration_days: string;
  start_date: string;
  notes: string;
};

const blankRow = (): MedRow => ({
  key: crypto.randomUUID(),
  medicine_name: '',
  dosage: '',
  frequency: '',
  duration_days: '',
  start_date: '',
  notes: '',
});

/** A medicine course is "active" until its last day has passed (open-ended = active). */
export function medicineStatus(m: Medicine, today = localToday()): 'active' | 'completed' | 'upcoming' {
  if (m.start_date && m.start_date > today) return 'upcoming';
  const end = courseEnd(m.start_date, m.duration_days);
  if (end && end < today) return 'completed';
  return 'active';
}

// -----------------------------------------------------------------------------
// Add / edit prescription
// -----------------------------------------------------------------------------
function PrescriptionModal({
  existing,
  existingMedicines,
  onClose,
  onSaved,
}: {
  existing: Prescription | null;
  existingMedicines: Medicine[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user } = useAuth();
  const [doctor, setDoctor] = useState(existing?.doctor_name || '');
  const [hospital, setHospital] = useState(existing?.hospital_name || '');
  const [date, setDate] = useState(existing?.prescription_date || localToday());
  const [time, setTime] = useState(normTime(existing?.prescription_time) || '');
  const [reason, setReason] = useState(existing?.reason || '');
  const [notes, setNotes] = useState(existing?.notes || '');
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [rows, setRows] = useState<MedRow[]>(
    existingMedicines.length
      ? existingMedicines.map((m) => ({
          key: m.id,
          id: m.id,
          medicine_name: m.medicine_name,
          dosage: m.dosage,
          frequency: m.frequency,
          duration_days: m.duration_days ? String(m.duration_days) : '',
          start_date: m.start_date || '',
          notes: m.notes || '',
        }))
      : [blankRow()]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRow = (key: string, patch: Partial<MedRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);

    const medRows = rows.filter(
      (r) => r.medicine_name.trim() || r.dosage.trim() || r.frequency.trim() || r.duration_days.trim()
    );
    if (medRows.length === 0) return setError('Add at least one medicine.');
    for (const r of medRows) {
      if (!r.medicine_name.trim() || !r.dosage.trim() || !r.frequency.trim()) {
        return setError('Each medicine needs a name, dosage and frequency.');
      }
      if (r.duration_days.trim() && !(Number(r.duration_days) > 0 && Number.isInteger(Number(r.duration_days)))) {
        return setError('Duration must be a whole number of days.');
      }
    }

    setBusy(true);

    // 1. File (optional)
    let uploaded: StoredFile | null = null;
    if (file) {
      const up = await uploadPrivateFile(user.id, 'prescriptions', file);
      if (up.error || !up.data) {
        setBusy(false);
        return setError(`Upload failed: ${up.error}`);
      }
      uploaded = up.data;
    }

    const rx: Record<string, unknown> = {
      user_id: user.id,
      doctor_name: doctor.trim(),
      hospital_name: hospital.trim() || null,
      prescription_date: date,
      prescription_time: normTime(time),
      reason: reason.trim() || null,
      notes: notes.trim() || null,
    };
    if (uploaded) Object.assign(rx, uploaded);
    else if (existing && removeFile) {
      Object.assign(rx, { file_name: null, storage_path: null, mime_type: null, file_size: null });
    }

    const medPayload = (r: MedRow, prescriptionId: string) => ({
      user_id: user.id,
      prescription_id: prescriptionId,
      medicine_name: r.medicine_name.trim(),
      dosage: r.dosage.trim(),
      frequency: r.frequency.trim(),
      duration_days: r.duration_days.trim() ? Number(r.duration_days) : null,
      start_date: r.start_date || date,
      notes: r.notes.trim() || null,
    });

    // 2. Rows
    let prescriptionId = existing?.id || '';
    if (!existing) {
      const { data, error: e1 } = await supabase.from('prescriptions').insert(rx).select('id').single();
      if (e1 || !data) {
        if (uploaded) await removeStoredFiles([uploaded.storage_path]);
        setBusy(false);
        return setError(e1?.message || 'Could not save the prescription.');
      }
      prescriptionId = data.id as string;
      const { error: e2 } = await supabase
        .from('medicines')
        .insert(medRows.map((r) => medPayload(r, prescriptionId)));
      if (e2) {
        // roll back so we never keep a half-saved prescription
        await supabase.from('prescriptions').delete().eq('id', prescriptionId);
        if (uploaded) await removeStoredFiles([uploaded.storage_path]);
        setBusy(false);
        return setError(`Medicines could not be saved: ${e2.message}`);
      }
    } else {
      const { error: e1 } = await supabase.from('prescriptions').update(rx).eq('id', existing.id);
      if (e1) {
        if (uploaded) await removeStoredFiles([uploaded.storage_path]);
        setBusy(false);
        return setError(e1.message);
      }
      const keepIds = new Set(medRows.filter((r) => r.id).map((r) => r.id as string));
      const removedIds = existingMedicines.filter((m) => !keepIds.has(m.id)).map((m) => m.id);
      if (removedIds.length) {
        const { error: eDel } = await supabase.from('medicines').delete().in('id', removedIds);
        if (eDel) {
          setBusy(false);
          return setError(eDel.message);
        }
      }
      for (const r of medRows.filter((x) => x.id)) {
        const { error: eUp } = await supabase
          .from('medicines')
          .update(medPayload(r, existing.id))
          .eq('id', r.id as string);
        if (eUp) {
          setBusy(false);
          return setError(eUp.message);
        }
      }
      const fresh = medRows.filter((x) => !x.id);
      if (fresh.length) {
        const { error: eIns } = await supabase
          .from('medicines')
          .insert(fresh.map((r) => medPayload(r, existing.id)));
        if (eIns) {
          setBusy(false);
          return setError(eIns.message);
        }
      }
      // old file is no longer referenced once replaced/removed
      if (existing.storage_path && (uploaded || removeFile)) {
        await removeStoredFiles([existing.storage_path]);
      }
    }

    await recordAudit(
      user.id,
      existing ? 'prescription_updated' : 'prescription_created',
      existing ? 'Prescription updated' : 'Prescription added',
      { prescription_id: prescriptionId, medicine_count: medRows.length }
    );
    setBusy(false);
    onSaved(existing ? 'Prescription updated.' : 'Prescription saved.');
  }

  return (
    <Modal title={existing ? 'Edit prescription' : 'Add a prescription'} close={onClose} size="xl">
      <form onSubmit={submit} className="space-y-5" data-testid="form-prescription">
        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" data-testid="status-prescription-error">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Doctor" name="doctor_name" required placeholder="e.g. Dr. Sarah Jenkins" value={doctor} onChange={(e) => setDoctor(e.target.value)} />
          <Field label="Clinic or hospital" name="hospital_name" placeholder="Optional" value={hospital} onChange={(e) => setHospital(e.target.value)} />
          <Field label="Prescription date" name="prescription_date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          <Field label="Time (optional)" name="prescription_time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <div className="sm:col-span-2">
            <Field label="Reason for visit (optional)" name="reason" placeholder="As you would describe it" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Medicines</h3>
            <button
              type="button"
              onClick={() => setRows((p) => [...p, blankRow()])}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              data-testid="button-add-medicine-row"
            >
              <Plus className="h-3.5 w-3.5" /> Add medicine
            </button>
          </div>
          <datalist id="frequency-options">
            {FREQUENCY_SUGGESTIONS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={r.key} className="rounded-2xl border border-[#e1e9df] bg-[#f8faf5] p-4" data-testid={`medicine-row-${i}`}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Medicine name" name={`medicine_name_${i}`} required={i === 0} value={r.medicine_name} onChange={(e) => setRow(r.key, { medicine_name: e.target.value })} />
                  <Field label="Dosage" name={`dosage_${i}`} placeholder="e.g. 500 mg" value={r.dosage} onChange={(e) => setRow(r.key, { dosage: e.target.value })} />
                  <div>
                    <label htmlFor={`frequency_${i}`} className="mb-1.5 block text-xs font-semibold text-[#49655b]">Frequency</label>
                    <input
                      id={`frequency_${i}`}
                      name={`frequency_${i}`}
                      list="frequency-options"
                      value={r.frequency}
                      onChange={(e) => setRow(r.key, { frequency: e.target.value })}
                      placeholder="e.g. Twice daily"
                      data-testid={`input-frequency-${i}`}
                      className="w-full rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 text-sm outline-none transition placeholder:text-[#a2b0a7] focus:border-primary focus:ring-2 focus:ring-primary/10"
                    />
                  </div>
                  <Field label="Duration (days)" name={`duration_days_${i}`} type="number" placeholder="e.g. 7" value={r.duration_days} onChange={(e) => setRow(r.key, { duration_days: e.target.value })} />
                  <Field label="Start date" name={`start_date_${i}`} type="date" value={r.start_date} onChange={(e) => setRow(r.key, { start_date: e.target.value })} />
                  <Field label="Note (optional)" name={`med_notes_${i}`} value={r.notes} onChange={(e) => setRow(r.key, { notes: e.target.value })} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground">
                    Start date defaults to the prescription date.
                    {r.duration_days && Number(r.duration_days) > 0
                      ? ` Course ends ${formatDate(courseEnd(r.start_date || date, Number(r.duration_days)) as string)}.`
                      : ''}
                  </p>
                  {rows.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 hover:underline"
                      data-testid={`button-remove-medicine-${i}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          {existing?.storage_path && !removeFile && !file && (
            <div className="mb-3 flex items-center justify-between rounded-xl border border-[#d9e3da] bg-white px-3.5 py-2.5 text-xs">
              <span className="flex items-center gap-2 truncate"><Paperclip className="h-4 w-4 text-primary" />{existing.file_name}</span>
              <button type="button" onClick={() => setRemoveFile(true)} className="font-semibold text-rose-700 hover:underline" data-testid="button-remove-rx-file">
                Remove file
              </button>
            </div>
          )}
          <FileDropField
            label={existing?.storage_path ? 'Replace prescription file or photo (optional)' : 'Prescription file or photo (optional)'}
            file={file}
            onChange={setFile}
            onError={setError}
            testId="input-prescription-file"
          />
        </div>

        <TextAreaField label="Notes (optional)" name="rx_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />

        <button disabled={busy} className={`${primaryButtonCls} w-full`} data-testid="button-save-prescription">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {busy ? 'Saving…' : existing ? 'Update prescription' : 'Save prescription'}
        </button>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
export function MedicinesPage() {
  const { user } = useAuth();
  const rx = useRows<Prescription>('prescriptions', 'prescription_date', false);
  const meds = useRows<Medicine>('medicines', 'created_at', true);
  const { reminders, refresh: refreshReminders } = useReminders();
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ existing: Prescription | null } | null>(null);
  const [reminderFor, setReminderFor] = useState<string | null>(null);
  const [followUpFor, setFollowUpFor] = useState<Prescription | null>(null);
  const today = localToday();

  const medsByRx = useMemo(() => {
    const map = new Map<string, Medicine[]>();
    for (const m of meds.rows) {
      const list = map.get(m.prescription_id) || [];
      list.push(m);
      map.set(m.prescription_id, list);
    }
    return map;
  }, [meds.rows]);

  const reminderCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of reminders) map.set(r.medicine_id, (map.get(r.medicine_id) || 0) + 1);
    return map;
  }, [reminders]);

  const q = search.trim().toLowerCase();
  const shown = rx.rows.filter((p) => {
    if (!q) return true;
    const medText = (medsByRx.get(p.id) || []).map((m) => `${m.medicine_name} ${m.dosage} ${m.frequency}`).join(' ');
    return `${p.doctor_name} ${p.hospital_name || ''} ${p.reason || ''} ${medText}`.toLowerCase().includes(q);
  });

  const refreshAll = () => {
    rx.refresh();
    meds.refresh();
    refreshReminders();
  };

  const openFile = async (p: Prescription) => {
    if (!p.storage_path) return;
    const { url, error } = await signedUrl(p.storage_path);
    if (error || !url) return setNotice({ type: 'error', text: `Could not open the file: ${error}` });
    await recordAudit(user?.id, 'document_viewed', 'Prescription file viewed', { prescription_id: p.id });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const remove = async (p: Prescription) => {
    if (
      !window.confirm(
        'Delete this prescription, its medicines, their reminders and the stored file? This cannot be undone.'
      )
    )
      return;
    const { error } = await supabase.from('prescriptions').delete().eq('id', p.id);
    if (error) return setNotice({ type: 'error', text: error.message });
    if (p.storage_path) await removeStoredFiles([p.storage_path]);
    await recordAudit(user?.id, 'prescription_deleted', 'Prescription deleted', { prescription_id: p.id });
    setNotice({ type: 'success', text: 'Prescription deleted.' });
    refreshAll();
  };

  const error = rx.error || meds.error;

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Your medicines"
        title="Prescriptions & Medicines"
        subtitle="Keep each prescription with its doctor, date, medicines, dosage, frequency and duration."
        action={
          <button onClick={() => setModal({ existing: null })} className={primaryButtonCls} data-testid="button-add-prescription">
            <Plus className="h-4 w-4" /> Add prescription
          </button>
        }
      />
      <Notice notice={notice} dismiss={() => setNotice(null)} />

      {error ? (
        <DataAlert error={error} retry={refreshAll} />
      ) : (
        <>
          <div className="relative mb-5">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by medicine, doctor or hospital…"
              className="w-full rounded-xl border border-[#dce5dc] bg-[#fffefa] py-3 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              data-testid="input-search-prescriptions"
            />
          </div>

          {rx.loading || meds.loading ? (
            <div className="mv-card p-6"><SkeletonRows /></div>
          ) : rx.rows.length === 0 ? (
            <EmptyState
              icon={Pill}
              title="No prescriptions yet"
              body="Add a prescription with its medicines. You can attach a photo or PDF of it."
              action={
                <button onClick={() => setModal({ existing: null })} className={primaryButtonCls + ' !py-2.5 !text-xs'} data-testid="button-empty-add-prescription">
                  <Plus className="h-4 w-4" /> Add your first prescription
                </button>
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState icon={Search} title="No matching prescriptions" body="Nothing matched your search." />
          ) : (
            <div className="space-y-4">
              {shown.map((p) => {
                const list = medsByRx.get(p.id) || [];
                return (
                  <section key={p.id} className="mv-card p-5 sm:p-6" data-testid={`card-prescription-${p.id}`}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Prescription</p>
                        <h2 className="mv-title mt-1 truncate text-xl font-semibold">{p.doctor_name}</h2>
                        <p className="mt-1 text-xs text-muted-foreground" data-testid={`text-prescription-when-${p.id}`}>
                          {[p.hospital_name, formatDateTime(p.prescription_date, p.prescription_time)].filter(Boolean).join(' · ')}
                        </p>
                        {p.reason && <p className="mt-1 text-xs text-[#72857b]">Reason: {p.reason}</p>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {p.storage_path && (
                          <button onClick={() => openFile(p)} className={ghostButtonCls} data-testid={`button-view-prescription-file-${p.id}`}>
                            <ArrowDownToLine className="h-3.5 w-3.5" /> View file{p.file_size ? ` (${formatFileSize(p.file_size)})` : ''}
                          </button>
                        )}
                        <button onClick={() => setFollowUpFor(p)} className={ghostButtonCls} data-testid={`button-followup-${p.id}`}>
                          <Stethoscope className="h-3.5 w-3.5" /> Follow-up
                        </button>
                        <Link href={`/receipts?new=1&prescription=${p.id}`} className={ghostButtonCls} data-testid={`link-add-receipt-${p.id}`}>
                          <ReceiptIcon className="h-3.5 w-3.5" /> Receipt
                        </Link>
                        <button onClick={() => setModal({ existing: p })} aria-label="Edit prescription" className="rounded-lg p-2 text-muted-foreground hover:bg-[#edf3eb] hover:text-primary" data-testid={`button-edit-prescription-${p.id}`}>
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button onClick={() => remove(p)} aria-label="Delete prescription" className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-700" data-testid={`button-delete-prescription-${p.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 divide-y divide-[#e8eee7] rounded-xl border border-[#e8eee7] bg-[#fbfcf8]">
                      {list.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">No medicines listed.</p>}
                      {list.map((m) => {
                        const status = medicineStatus(m, today);
                        const end = courseEnd(m.start_date, m.duration_days);
                        return (
                          <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`row-medicine-${m.id}`}>
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#edf3eb] text-primary"><Pill className="h-4 w-4" /></span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">
                                {m.medicine_name} <span className="font-normal text-muted-foreground">· {m.dosage}</span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {m.frequency}
                                {m.duration_days ? ` · ${m.duration_days} day${m.duration_days === 1 ? '' : 's'}` : ' · no duration set'}
                                {m.start_date ? ` · from ${formatDate(m.start_date)}` : ''}
                                {end ? ` to ${formatDate(end)}` : ''}
                              </p>
                              {m.notes && <p className="text-xs text-[#72857b]">{m.notes}</p>}
                            </div>
                            <Badge tone={status === 'active' ? 'green' : status === 'upcoming' ? 'blue' : 'gray'}>
                              {status === 'active' ? 'Active' : status === 'upcoming' ? 'Starts later' : 'Completed'}
                            </Badge>
                            <button onClick={() => setReminderFor(m.id)} className={ghostButtonCls} data-testid={`button-set-reminder-${m.id}`}>
                              <Bell className="h-3.5 w-3.5" />
                              {reminderCount.get(m.id) ? `Reminders (${reminderCount.get(m.id)})` : 'Set reminder'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                    {p.notes && <p className="mt-3 rounded-lg bg-[#f2f5ef] p-3 text-xs leading-relaxed text-[#586f64]">{p.notes}</p>}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}

      {modal && (
        <PrescriptionModal
          existing={modal.existing}
          existingMedicines={modal.existing ? medsByRx.get(modal.existing.id) || [] : []}
          onClose={() => setModal(null)}
          onSaved={(message) => {
            setModal(null);
            setNotice({ type: 'success', text: message });
            refreshAll();
          }}
        />
      )}
      {reminderFor && (
        <MedicationReminderModal
          medicines={meds.rows}
          medicineId={reminderFor}
          onClose={() => setReminderFor(null)}
          onSaved={(message) => {
            setReminderFor(null);
            setNotice({ type: 'success', text: message });
            refreshReminders();
          }}
        />
      )}
      {followUpFor && (
        <AppointmentModal
          initial={null}
          defaults={{
            appointment_type: 'follow_up',
            doctor_name: followUpFor.doctor_name,
            hospital_name: followUpFor.hospital_name || '',
            remind_before_minutes: 1440,
          }}
          onClose={() => setFollowUpFor(null)}
          onSaved={(message) => {
            setFollowUpFor(null);
            setNotice({ type: 'success', text: message });
            refreshReminders();
          }}
        />
      )}
    </div>
  );
}
