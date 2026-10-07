import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link } from 'wouter';
import {
  Bell,
  BellOff,
  BellRing,
  CalendarPlus,
  Check,
  Clock3,
  Edit3,
  LoaderCircle,
  Pill,
  Plus,
  Stethoscope,
  Trash2,
  X,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { recordAudit } from '@/lib/helpers';
import type { Appt, Medicine, MedReminder, ReminderLog } from '@/lib/types';
import {
  addDays,
  courseEnd,
  formatDate,
  formatDateTime,
  formatTime,
  localToday,
  normTime,
  remindLabel,
  toDateStr,
} from '@/lib/datetime';
import {
  describeDays,
  dosesForDate,
  followUpReminders,
  WEEKDAYS,
  type Dose,
  type FollowUpReminder,
} from '@/lib/reminders';
import {
  Badge,
  DataAlert,
  EmptyState,
  Field,
  Modal,
  Notice,
  PageHeading,
  SkeletonRows,
  ghostButtonCls,
  primaryButtonCls,
} from '@/components/common';
import { AppointmentModal } from '@/features/appointment-form';

// -----------------------------------------------------------------------------
// Data + engine
// -----------------------------------------------------------------------------
type RemindersCtx = {
  loading: boolean;
  error: string | null;
  medicines: Medicine[];
  reminders: MedReminder[];
  logs: ReminderLog[];
  appointments: Appt[];
  now: Date;
  todayDoses: Dose[];
  dueDoses: Dose[];
  followUps: FollowUpReminder[];
  dueFollowUps: FollowUpReminder[];
  notifPermission: NotificationPermission | 'unsupported';
  refresh: () => void;
  logDose: (dose: Dose, status: 'taken' | 'skipped') => Promise<string | null>;
  undoDose: (dose: Dose) => Promise<string | null>;
  enableNotifications: () => Promise<void>;
  dismissFollowUp: (key: string) => void;
};

const noop = async () => null;

const RemindersContext = createContext<RemindersCtx>({
  loading: false,
  error: null,
  medicines: [],
  reminders: [],
  logs: [],
  appointments: [],
  now: new Date(),
  todayDoses: [],
  dueDoses: [],
  followUps: [],
  dueFollowUps: [],
  notifPermission: 'unsupported',
  refresh: () => {},
  logDose: noop,
  undoDose: noop,
  enableNotifications: async () => {},
  dismissFollowUp: () => {},
});

export const useReminders = () => useContext(RemindersContext);

const NOTIFIED_KEY = 'mv-notified-reminders';
const DISMISSED_KEY = 'mv-dismissed-followups';

function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]);
  } catch {
    return new Set();
  }
}
function writeSet(key: string, set: Set<string>) {
  try {
    // keep the list bounded
    localStorage.setItem(key, JSON.stringify([...set].slice(-300)));
  } catch {
    /* storage unavailable - reminders still show in-app */
  }
}

function currentPermission(): NotificationPermission | 'unsupported' {
  return typeof window !== 'undefined' && 'Notification' in window
    ? Notification.permission
    : 'unsupported';
}

export function RemindersProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id;
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [reminders, setReminders] = useState<MedReminder[]>([]);
  const [logs, setLogs] = useState<ReminderLog[]>([]);
  const [appointments, setAppointments] = useState<Appt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [reload, setReload] = useState(0);
  const [perm, setPerm] = useState(currentPermission);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readSet(DISMISSED_KEY));
  const today = toDateStr(now);

  // Tick every 20s so due states update without a page reload.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    let live = true;
    async function load() {
      if (!userId || !isSupabaseConfigured) {
        setMedicines([]);
        setReminders([]);
        setLogs([]);
        setAppointments([]);
        return;
      }
      setLoading(true);
      const since = addDays(today, -1);
      const [med, rem, log, appt] = await Promise.all([
        supabase.from('medicines').select('*').order('created_at', { ascending: true }),
        supabase.from('medication_reminders').select('*').order('created_at', { ascending: true }),
        supabase.from('medication_reminder_logs').select('*').gte('scheduled_date', since),
        supabase
          .from('appointments')
          .select('*')
          .gte('appointment_date', since)
          .order('appointment_date', { ascending: true }),
      ]);
      if (!live) return;
      const firstError = med.error || rem.error || log.error || appt.error;
      setError(firstError ? firstError.message : null);
      setMedicines((med.data || []) as Medicine[]);
      setReminders(
        ((rem.data || []) as MedReminder[]).map((r) => ({
          ...r,
          reminder_times: (r.reminder_times || []).map((t) => normTime(t) || t),
          days_of_week: (r.days_of_week || []).map(Number),
        }))
      );
      setLogs((log.data || []) as ReminderLog[]);
      setAppointments((appt.data || []) as Appt[]);
      setLoading(false);
    }
    void load();
    return () => {
      live = false;
    };
    // `today` makes the logs window roll forward at midnight.
  }, [userId, reload, today]);

  const refresh = useCallback(() => setReload((x) => x + 1), []);

  const todayDoses = useMemo(
    () => dosesForDate(today, reminders, medicines, logs, now),
    [today, reminders, medicines, logs, now]
  );
  const dueDoses = useMemo(() => todayDoses.filter((d) => d.status === 'due'), [todayDoses]);
  const followUps = useMemo(() => followUpReminders(appointments, now), [appointments, now]);
  const dueFollowUps = useMemo(
    () => followUps.filter((f) => f.state === 'due' && !dismissed.has(f.key)),
    [followUps, dismissed]
  );

  // Browser notifications (only while MediVault is open in a tab).
  const notifiedRef = useRef<Set<string>>(readSet(NOTIFIED_KEY));
  useEffect(() => {
    if (perm !== 'granted') return;
    const fire = (key: string, title: string, body: string) => {
      if (notifiedRef.current.has(key)) return;
      notifiedRef.current.add(key);
      writeSet(NOTIFIED_KEY, notifiedRef.current);
      try {
        new Notification(title, { body, tag: key });
      } catch {
        /* some browsers block constructing notifications outside a service worker */
      }
    };
    for (const d of dueDoses) {
      // only alert for doses that became due recently, not stale ones from earlier today
      if (now.getTime() - d.at.getTime() > 90 * 60_000) continue;
      fire(
        `dose|${d.key}`,
        'Medication reminder',
        `${d.medicine.medicine_name} (${d.medicine.dosage}) · scheduled for ${formatTime(d.time)}`
      );
    }
    for (const f of dueFollowUps) {
      fire(
        `fu|${f.key}`,
        'Upcoming visit',
        `${f.appt.doctor_name || 'Appointment'} · ${formatDateTime(f.appt.appointment_date, f.appt.appointment_time)}`
      );
    }
  }, [perm, dueDoses, dueFollowUps, now]);

  const logDose = useCallback<RemindersCtx['logDose']>(
    async (dose, status) => {
      if (!userId) return 'You are signed out.';
      const { error: e } = await supabase.from('medication_reminder_logs').upsert(
        {
          user_id: userId,
          reminder_id: dose.reminder.id,
          scheduled_date: dose.date,
          scheduled_time: dose.time,
          status,
          logged_at: new Date().toISOString(),
        },
        { onConflict: 'reminder_id,scheduled_date,scheduled_time' }
      );
      if (e) return e.message;
      await recordAudit(userId, 'dose_logged', `Dose marked ${status}`, {
        reminder_id: dose.reminder.id,
        status,
      });
      refresh();
      return null;
    },
    [userId, refresh]
  );

  const undoDose = useCallback<RemindersCtx['undoDose']>(
    async (dose) => {
      if (!dose.log) return null;
      const { error: e } = await supabase
        .from('medication_reminder_logs')
        .delete()
        .eq('id', dose.log.id);
      if (e) return e.message;
      refresh();
      return null;
    },
    [refresh]
  );

  const enableNotifications = useCallback(async () => {
    if (!('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setPerm(result);
  }, []);

  const dismissFollowUp = useCallback((key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(key);
      writeSet(DISMISSED_KEY, next);
      return next;
    });
  }, []);

  const value: RemindersCtx = {
    loading,
    error,
    medicines,
    reminders,
    logs,
    appointments,
    now,
    todayDoses,
    dueDoses,
    followUps,
    dueFollowUps,
    notifPermission: perm,
    refresh,
    logDose,
    undoDose,
    enableNotifications,
    dismissFollowUp,
  };
  return <RemindersContext.Provider value={value}>{children}</RemindersContext.Provider>;
}

// -----------------------------------------------------------------------------
// "Due now" banner (shown under the header on every page)
// -----------------------------------------------------------------------------
export function DueBanner() {
  const { dueDoses, dueFollowUps, logDose, dismissFollowUp, now } = useReminders();
  const [hiddenSig, setHiddenSig] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const sig = [...dueDoses.map((d) => d.key), ...dueFollowUps.map((f) => f.key)].sort().join(',');
  if (!sig || sig === hiddenSig) return null;

  const shown = dueDoses.slice(0, 3);
  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-5 py-3 md:px-9"
      role="alert"
      data-testid="banner-due-reminders"
    >
      <div className="mx-auto flex max-w-[1180px] items-start gap-3">
        <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1 space-y-2 text-xs text-amber-950">
          {shown.map((d) => (
            <div key={d.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                <strong>{d.medicine.medicine_name}</strong> ({d.medicine.dosage}) was scheduled for{' '}
                {formatTime(d.time)}
              </span>
              <button
                disabled={busyKey === d.key}
                onClick={async () => {
                  setBusyKey(d.key);
                  await logDose(d, 'taken');
                  setBusyKey(null);
                }}
                className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                data-testid={`button-banner-taken-${d.key}`}
              >
                Mark as taken
              </button>
            </div>
          ))}
          {dueDoses.length > shown.length && (
            <Link href="/reminders" className="font-semibold underline">
              +{dueDoses.length - shown.length} more due
            </Link>
          )}
          {dueFollowUps.map((f) => {
            const mins = Math.max(0, Math.round((f.visitAt.getTime() - now.getTime()) / 60000));
            return (
              <div key={f.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>
                  <strong>{f.appt.doctor_name || 'Appointment'}</strong>
                  {f.appt.hospital_name ? ` · ${f.appt.hospital_name}` : ''} ·{' '}
                  {formatDateTime(f.appt.appointment_date, f.appt.appointment_time)}
                  {mins < 180 ? ` (in ${mins} min)` : ''}
                </span>
                <button
                  onClick={() => dismissFollowUp(f.key)}
                  className="rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100"
                  data-testid={`button-dismiss-visit-${f.appt.id}`}
                >
                  Dismiss
                </button>
              </div>
            );
          })}
          <Link href="/reminders" className="inline-block font-semibold underline">
            Open reminders
          </Link>
        </div>
        <button
          onClick={() => setHiddenSig(sig)}
          aria-label="Hide reminder banner"
          className="rounded-lg p-1 text-amber-800 hover:bg-amber-100"
          data-testid="button-hide-banner"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Small reusable rows
// -----------------------------------------------------------------------------
export function DoseRow({
  dose,
  onChanged,
}: {
  dose: Dose;
  onChanged?: (message: string | null) => void;
}) {
  const { logDose, undoDose, now } = useReminders();
  const [busy, setBusy] = useState(false);
  const overdue = dose.status === 'due' && now.getTime() - dose.at.getTime() > 60 * 60_000;

  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    onChanged?.(err);
  };

  return (
    <div
      className="flex flex-wrap items-center gap-3 py-3"
      data-testid={`row-dose-${dose.key}`}
    >
      <div className="w-[74px] shrink-0 text-sm font-semibold tabular-nums">{formatTime(dose.time)}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{dose.medicine.medicine_name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {dose.medicine.dosage} · {dose.medicine.frequency}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {dose.status === 'taken' && <Badge tone="green">Taken</Badge>}
        {dose.status === 'skipped' && <Badge tone="gray">Skipped</Badge>}
        {dose.status === 'due' && <Badge tone={overdue ? 'rose' : 'amber'}>{overdue ? 'Overdue' : 'Due now'}</Badge>}
        {dose.status === 'upcoming' && <Badge tone="blue">Upcoming</Badge>}

        {(dose.status === 'due' || dose.status === 'upcoming') && (
          <>
            <button
              disabled={busy}
              onClick={() => run(() => logDose(dose, 'taken'))}
              className={ghostButtonCls}
              data-testid={`button-dose-taken-${dose.key}`}
            >
              <Check className="h-3.5 w-3.5" /> Taken
            </button>
            <button
              disabled={busy}
              onClick={() => run(() => logDose(dose, 'skipped'))}
              className={ghostButtonCls}
              data-testid={`button-dose-skip-${dose.key}`}
            >
              Skip
            </button>
          </>
        )}
        {(dose.status === 'taken' || dose.status === 'skipped') && (
          <button
            disabled={busy}
            onClick={() => run(() => undoDose(dose))}
            className={ghostButtonCls}
            data-testid={`button-dose-undo-${dose.key}`}
          >
            Undo
          </button>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Medication reminder form (create / edit)
// -----------------------------------------------------------------------------
export function MedicationReminderModal({
  medicines,
  medicineId,
  existing,
  onClose,
  onSaved,
}: {
  medicines: Medicine[];
  medicineId?: string;
  existing?: MedReminder | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user } = useAuth();
  const initialMedicine = existing?.medicine_id || medicineId || medicines[0]?.id || '';
  const med0 = medicines.find((m) => m.id === initialMedicine);

  const [medicine, setMedicine] = useState(initialMedicine);
  const [times, setTimes] = useState<string[]>(
    existing?.reminder_times?.length ? existing.reminder_times.map((t) => normTime(t) || '') : ['']
  );
  const [days, setDays] = useState<number[]>(existing?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState(existing?.start_date || med0?.start_date || localToday());
  const [end, setEnd] = useState(
    existing ? existing.end_date || '' : courseEnd(med0?.start_date || localToday(), med0?.duration_days ?? null) || ''
  );
  const [notes, setNotes] = useState(existing?.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const onMedicineChange = (id: string) => {
    setMedicine(id);
    if (existing) return;
    const m = medicines.find((x) => x.id === id);
    if (m) {
      const s = m.start_date || localToday();
      setStart(s);
      setEnd(courseEnd(s, m.duration_days) || '');
    }
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setError(null);
    const cleaned = [...new Set(times.map((t) => normTime(t)).filter(Boolean) as string[])].sort();
    if (!medicine) return setError('Choose a medicine first.');
    if (cleaned.length === 0) return setError('Enter at least one reminder time.');
    if (days.length === 0) return setError('Choose at least one day of the week.');
    if (end && end < start) return setError('The end date cannot be before the start date.');

    setBusy(true);
    const payload = {
      user_id: user.id,
      medicine_id: medicine,
      reminder_times: cleaned,
      days_of_week: days,
      start_date: start,
      end_date: end || null,
      notes: notes.trim() || null,
    };
    const res = existing
      ? await supabase.from('medication_reminders').update(payload).eq('id', existing.id)
      : await supabase.from('medication_reminders').insert({ ...payload, is_active: true });
    setBusy(false);
    if (res.error) return setError(res.error.message);
    await recordAudit(
      user.id,
      existing ? 'reminder_updated' : 'reminder_created',
      existing ? 'Medication reminder updated' : 'Medication reminder created'
    );
    onSaved(existing ? 'Reminder updated.' : 'Medication reminder added.');
  }

  return (
    <Modal title={existing ? 'Edit medication reminder' : 'Add medication reminder'} close={onClose} size="lg">
      <form onSubmit={submit} className="space-y-4" data-testid="form-med-reminder">
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="alert" data-testid="status-reminder-error">
            {error}
          </div>
        )}
        <div>
          <label htmlFor="reminder-medicine" className="mb-1.5 block text-xs font-semibold text-[#49655b]">
            Medicine
          </label>
          <select
            id="reminder-medicine"
            value={medicine}
            onChange={(e) => onMedicineChange(e.target.value)}
            required
            disabled={Boolean(existing)}
            className="w-full rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 text-sm outline-none focus:border-primary"
            data-testid="select-reminder-medicine"
          >
            {medicines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.medicine_name} · {m.dosage}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-semibold text-[#49655b]">
            Reminder times (you choose them)
          </span>
          <div className="space-y-2">
            {times.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="time"
                  required
                  value={t}
                  onChange={(e) => setTimes((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                  aria-label={`Reminder time ${i + 1}`}
                  className="w-44 rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 text-sm outline-none focus:border-primary"
                  data-testid={`input-reminder-time-${i}`}
                />
                {times.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setTimes((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove time ${i + 1}`}
                    className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {times.length < 12 && (
            <button
              type="button"
              onClick={() => setTimes((prev) => [...prev, ''])}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
              data-testid="button-add-reminder-time"
            >
              <Plus className="h-3.5 w-3.5" /> Add another time
            </button>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-semibold text-[#49655b]">Days</span>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((label, d) => {
              const on = days.includes(d);
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${
                    on ? 'bg-primary text-primary-foreground' : 'border border-[#d9e3da] bg-white text-[#73877d]'
                  }`}
                  data-testid={`button-day-${label.toLowerCase()}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date" name="reminder_start" type="date" required value={start} onChange={(e) => setStart(e.target.value)} />
          <Field label="End date (optional)" name="reminder_end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <Field label="Note (optional)" name="reminder_notes" placeholder="e.g. with breakfast, as written on the prescription" value={notes} onChange={(e) => setNotes(e.target.value)} />

        <p className="text-[11px] leading-5 text-muted-foreground">
          MediVault only reminds you at the times you enter here. Always follow the instructions on your
          prescription or from your doctor or pharmacist.
        </p>

        <button disabled={busy} className={`${primaryButtonCls} w-full`} data-testid="button-save-med-reminder">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {existing ? 'Update reminder' : 'Save reminder'}
        </button>
      </form>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Reminders page
// -----------------------------------------------------------------------------
export function RemindersPage() {
  const {
    loading,
    error,
    medicines,
    reminders,
    followUps,
    todayDoses,
    refresh,
    notifPermission,
    enableNotifications,
    now,
  } = useReminders();
  const { user } = useAuth();
  const [notice, setNotice] = useState<Notice>(null);
  const [modal, setModal] = useState<{ existing: MedReminder | null } | null>(null);
  const [followUpModal, setFollowUpModal] = useState(false);

  const medById = useMemo(() => new Map(medicines.map((m) => [m.id, m])), [medicines]);
  const upcomingFollowUps = followUps.filter((f) => f.state !== 'past');

  const toggleActive = async (r: MedReminder) => {
    const { error: e } = await supabase
      .from('medication_reminders')
      .update({ is_active: !r.is_active })
      .eq('id', r.id);
    if (e) setNotice({ type: 'error', text: e.message });
    else refresh();
  };

  const remove = async (r: MedReminder) => {
    if (!window.confirm('Delete this reminder schedule and its taken/skipped history?')) return;
    const { error: e } = await supabase.from('medication_reminders').delete().eq('id', r.id);
    if (e) setNotice({ type: 'error', text: e.message });
    else {
      await recordAudit(user?.id, 'reminder_deleted', 'Medication reminder deleted');
      setNotice({ type: 'success', text: 'Reminder deleted.' });
      refresh();
    }
  };

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Stay on schedule"
        title="Reminders"
        subtitle="Medication and next-visit reminders built only from the schedules you enter."
        action={
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={() => setFollowUpModal(true)}
              className={ghostButtonCls + ' !py-3 !text-sm'}
              data-testid="button-add-followup"
            >
              <Stethoscope className="h-4 w-4" /> Add follow-up
            </button>
            <button
              onClick={() => setModal({ existing: null })}
              disabled={medicines.length === 0}
              title={medicines.length === 0 ? 'Add a prescription with a medicine first' : undefined}
              className={primaryButtonCls}
              data-testid="button-add-med-reminder"
            >
              <Plus className="h-4 w-4" /> Medication reminder
            </button>
          </div>
        }
      />
      <Notice notice={notice} dismiss={() => setNotice(null)} />

      {error && <DataAlert error={error} retry={refresh} />}

      {/* Browser notification status */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-[#d8e4dd] bg-[#eaf1e8] p-4 text-xs text-[#4d665c]">
        {notifPermission === 'granted' ? (
          <Bell className="h-4 w-4 text-primary" />
        ) : (
          <BellOff className="h-4 w-4 text-primary" />
        )}
        <p className="min-w-0 flex-1 leading-5" data-testid="status-notifications">
          {notifPermission === 'granted'
            ? 'Browser alerts are on. They appear while MediVault is open in a browser tab.'
            : notifPermission === 'denied'
            ? 'Browser alerts are blocked in your browser settings. In-app reminders below still work.'
            : notifPermission === 'unsupported'
            ? 'This browser does not support alerts. In-app reminders below still work.'
            : 'Turn on browser alerts to be notified while MediVault is open in a tab.'}{' '}
          Reminders are not sent when MediVault is closed.
        </p>
        {notifPermission === 'default' && (
          <button onClick={enableNotifications} className={ghostButtonCls} data-testid="button-enable-notifications">
            Enable alerts
          </button>
        )}
      </div>

      {/* Today */}
      <section className="mv-card mb-6 p-5 sm:p-6" data-testid="section-today-doses">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-primary">{formatDate(toDateStr(now))}</p>
            <h2 className="mv-title mt-1 text-2xl font-semibold">Today&apos;s medicines</h2>
          </div>
          <Clock3 className="h-5 w-5 text-primary" />
        </div>
        {loading && reminders.length === 0 ? (
          <SkeletonRows />
        ) : todayDoses.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing scheduled for today. Add a medication reminder to build your schedule.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-[#e8eee7]">
            {todayDoses.map((d) => (
              <DoseRow key={d.key} dose={d} onChanged={(m) => m && setNotice({ type: 'error', text: m })} />
            ))}
          </div>
        )}
      </section>

      {/* Schedules */}
      <section className="mb-6">
        <h2 className="mv-title mb-3 text-2xl font-semibold">Medication schedules</h2>
        {reminders.length === 0 ? (
          <EmptyState
            icon={Pill}
            title={medicines.length === 0 ? 'No medicines yet' : 'No medication reminders yet'}
            body={
              medicines.length === 0
                ? 'Add a prescription with its medicines first, then set reminder times for each one.'
                : 'Choose a medicine and the times you want to be reminded.'
            }
            action={
              medicines.length === 0 ? (
                <Link href="/medicines" className={primaryButtonCls + ' !py-2.5 !text-xs'} data-testid="link-reminders-add-prescription">
                  Add a prescription
                </Link>
              ) : (
                <button onClick={() => setModal({ existing: null })} className={primaryButtonCls + ' !py-2.5 !text-xs'}>
                  <Plus className="h-4 w-4" /> Add medication reminder
                </button>
              )
            }
          />
        ) : (
          <div className="space-y-3">
            {reminders.map((r) => {
              const m = medById.get(r.medicine_id);
              return (
                <div key={r.id} className="mv-card flex flex-wrap items-center gap-4 p-4 sm:p-5" data-testid={`row-reminder-${r.id}`}>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3eb] text-primary">
                    <Pill className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {m?.medicine_name || 'Medicine'} {m ? <span className="font-normal text-muted-foreground">· {m.dosage}</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {r.reminder_times.map((t) => formatTime(t)).join(', ')} · {describeDays(r.days_of_week)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      From {formatDate(r.start_date)}
                      {r.end_date ? ` to ${formatDate(r.end_date)}` : ' (no end date)'}
                    </p>
                    {r.notes && <p className="mt-1 text-xs text-[#72857b]">{r.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={r.is_active ? 'green' : 'gray'}>{r.is_active ? 'Active' : 'Paused'}</Badge>
                    <button onClick={() => toggleActive(r)} className={ghostButtonCls} data-testid={`button-toggle-reminder-${r.id}`}>
                      {r.is_active ? 'Pause' : 'Resume'}
                    </button>
                    <button
                      onClick={() => setModal({ existing: r })}
                      aria-label="Edit reminder"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-[#edf3eb] hover:text-primary"
                      data-testid={`button-edit-reminder-${r.id}`}
                    >
                      <Edit3 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(r)}
                      aria-label="Delete reminder"
                      className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-700"
                      data-testid={`button-delete-reminder-${r.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Follow-ups */}
      <section data-testid="section-followups">
        <h2 className="mv-title mb-3 text-2xl font-semibold">Next visit &amp; follow-up reminders</h2>
        {upcomingFollowUps.length === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            title="No visit reminders"
            body="Add a follow-up with the doctor, hospital, date, time and when you want to be reminded."
            action={
              <button onClick={() => setFollowUpModal(true)} className={primaryButtonCls + ' !py-2.5 !text-xs'} data-testid="button-empty-add-followup">
                <Stethoscope className="h-4 w-4" /> Add follow-up
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {upcomingFollowUps.map((f) => (
              <div key={f.appt.id} className="mv-card flex flex-wrap items-center gap-4 p-4 sm:p-5" data-testid={`row-followup-${f.appt.id}`}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3eb] text-primary">
                  <Stethoscope className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {f.appt.doctor_name || 'Appointment'}
                    {f.appt.appointment_type === 'follow_up' && <span className="ml-2 align-middle"><Badge tone="blue">Follow-up</Badge></span>}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {[f.appt.hospital_name, formatDateTime(f.appt.appointment_date, f.appt.appointment_time)].filter(Boolean).join(' · ')}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Reminder: {remindLabel(f.appt.remind_before_minutes)} ·{' '}
                    {f.state === 'due' ? 'reminding now' : `at ${formatDateTime(toDateStr(f.remindAt), `${String(f.remindAt.getHours()).padStart(2, '0')}:${String(f.remindAt.getMinutes()).padStart(2, '0')}`)}`}
                  </p>
                </div>
                <Badge tone={f.state === 'due' ? 'amber' : 'blue'}>{f.state === 'due' ? 'Reminding' : 'Scheduled'}</Badge>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Visits without a reminder are listed on the{' '}
          <Link href="/appointments" className="font-semibold text-primary hover:underline">Appointments</Link> page.
        </p>
      </section>

      {modal && (
        <MedicationReminderModal
          medicines={medicines}
          existing={modal.existing}
          onClose={() => setModal(null)}
          onSaved={(message) => {
            setModal(null);
            setNotice({ type: 'success', text: message });
            refresh();
          }}
        />
      )}
      {followUpModal && (
        <AppointmentModal
          initial={null}
          defaults={{ appointment_type: 'follow_up', remind_before_minutes: 1440 }}
          onClose={() => setFollowUpModal(false)}
          onSaved={(message) => {
            setFollowUpModal(false);
            setNotice({ type: 'success', text: message });
            refresh();
          }}
        />
      )}
    </div>
  );
}
