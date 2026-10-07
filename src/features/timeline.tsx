import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowRight,
  CalendarDays,
  FileClock,
  FileText,
  FlaskConical,
  Pill,
  Plus,
  Receipt as ReceiptIcon,
  ScrollText,
  Search,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react';
import type { Appt, Doc, Medicine, Prescription, Receipt } from '@/lib/types';
import { combineDateTime, formatTime, localToday, normTime, parseDate } from '@/lib/datetime';
import { Badge, DataAlert, EmptyState, PageHeading, SkeletonRows, useRows } from '@/components/common';
import { formatMoney } from '@/features/receipts';

export type TimelineKind =
  | 'consultations'
  | 'tests'
  | 'prescriptions'
  | 'medicines'
  | 'receipts'
  | 'appointments'
  | 'records';

const KIND_META: Record<TimelineKind, { label: string; icon: LucideIcon }> = {
  consultations: { label: 'Consultations', icon: Stethoscope },
  tests: { label: 'Tests', icon: FlaskConical },
  prescriptions: { label: 'Prescriptions', icon: ScrollText },
  medicines: { label: 'Medicines', icon: Pill },
  receipts: { label: 'Receipts', icon: ReceiptIcon },
  appointments: { label: 'Appointments', icon: CalendarDays },
  records: { label: 'Other records', icon: FileText },
};

type TimelineEvent = {
  id: string;
  kind: TimelineKind;
  date: string;
  time: string | null;
  at: number;
  title: string;
  subtitle: string;
  tag?: string;
  href: string;
};

function docKind(category: string | null): TimelineKind {
  switch (category) {
    case 'Consultation':
      return 'consultations';
    case 'Lab result':
    case 'Imaging':
      return 'tests';
    case 'Prescription':
      return 'prescriptions';
    default:
      return 'records';
  }
}

/** One chronological list from every health record type. */
export function buildTimelineEvents(
  docs: Doc[],
  appts: Appt[],
  prescriptions: Prescription[],
  medicines: Medicine[],
  receipts: Receipt[]
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const rxById = new Map(prescriptions.map((p) => [p.id, p]));
  const medCount = new Map<string, number>();
  for (const m of medicines) medCount.set(m.prescription_id, (medCount.get(m.prescription_id) || 0) + 1);

  const push = (e: Omit<TimelineEvent, 'at'>) =>
    events.push({ ...e, at: combineDateTime(e.date, e.time).getTime() });

  for (const d of docs) {
    const date = d.document_date || d.created_at.slice(0, 10);
    push({
      id: `d-${d.id}`,
      kind: docKind(d.category),
      date,
      time: d.document_date ? normTime(d.document_time) : null,
      title: d.title || d.file_name,
      subtitle: [d.category || 'Record', d.doctor_name, d.hospital_name].filter(Boolean).join(' · '),
      href: `/records/${d.id}`,
    });
  }

  for (const p of prescriptions) {
    const n = medCount.get(p.id) || 0;
    push({
      id: `p-${p.id}`,
      kind: 'prescriptions',
      date: p.prescription_date,
      time: normTime(p.prescription_time),
      title: `Prescription · ${p.doctor_name}`,
      subtitle: [p.hospital_name, `${n} medicine${n === 1 ? '' : 's'}`].filter(Boolean).join(' · '),
      href: '/medicines',
    });
  }

  for (const m of medicines) {
    const rx = rxById.get(m.prescription_id);
    const date = m.start_date || rx?.prescription_date;
    if (!date) continue;
    // A medicine that starts on the prescription day inherits that visit's time.
    const time = rx && rx.prescription_date === date ? normTime(rx.prescription_time) : null;
    push({
      id: `m-${m.id}`,
      kind: 'medicines',
      date,
      time,
      title: `Started ${m.medicine_name}`,
      subtitle: [
        m.dosage,
        m.frequency,
        m.duration_days ? `${m.duration_days} day${m.duration_days === 1 ? '' : 's'}` : null,
        rx ? `Dr. ${rx.doctor_name.replace(/^dr\.?\s*/i, '')}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      href: '/medicines',
    });
  }

  for (const r of receipts) {
    push({
      id: `r-${r.id}`,
      kind: 'receipts',
      date: r.purchase_date,
      time: normTime(r.purchase_time),
      title: `Receipt · ${r.pharmacy_name}`,
      subtitle: formatMoney(r.amount, r.currency),
      href: '/receipts',
    });
  }

  for (const a of appts) {
    push({
      id: `a-${a.id}`,
      kind: 'appointments',
      date: a.appointment_date,
      time: normTime(a.appointment_time),
      title: a.doctor_name || (a.appointment_type === 'follow_up' ? 'Follow-up visit' : 'Appointment'),
      subtitle: [a.hospital_name, a.reason].filter(Boolean).join(' · ') || 'Appointment',
      tag: a.appointment_type === 'follow_up' ? 'Follow-up' : undefined,
      href: '/appointments',
    });
  }

  // newest first; same instant -> stable by id
  return events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

export function TimelinePage() {
  const docs = useRows<Doc>('medical_documents');
  const appts = useRows<Appt>('appointments', 'appointment_date', false);
  const rx = useRows<Prescription>('prescriptions', 'prescription_date', false);
  const meds = useRows<Medicine>('medicines', 'created_at', true);
  const receipts = useRows<Receipt>('medicine_receipts', 'purchase_date', false);
  const [year, setYear] = useState('all');
  const [kind, setKind] = useState<'all' | TimelineKind>('all');

  const loading = docs.loading || appts.loading || rx.loading || meds.loading || receipts.loading;
  // The core tables must load; the newer tables degrade gracefully if not yet migrated.
  const coreError = docs.error || appts.error;
  const newTablesError = rx.error || meds.error || receipts.error;

  const events = useMemo(
    () => buildTimelineEvents(docs.rows, appts.rows, rx.rows, meds.rows, receipts.rows),
    [docs.rows, appts.rows, rx.rows, meds.rows, receipts.rows]
  );

  const years = useMemo(() => Array.from(new Set(events.map((x) => x.date.slice(0, 4)))), [events]);
  const counts = useMemo(() => {
    const c: Partial<Record<TimelineKind, number>> = {};
    for (const e of events) c[e.kind] = (c[e.kind] || 0) + 1;
    return c;
  }, [events]);

  const filtered = events.filter(
    (x) => (year === 'all' || x.date.startsWith(year)) && (kind === 'all' || x.kind === kind)
  );
  const nowMs = Date.now();
  const today = localToday();

  const retry = () => {
    docs.refresh();
    appts.refresh();
    rx.refresh();
    meds.refresh();
    receipts.refresh();
  };

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Your care history"
        title="Medical Timeline"
        subtitle="Consultations, tests, prescriptions, medicines, receipts and appointments in exact date-and-time order."
        action={
          <select
            value={year}
            onChange={(e) => setYear(e.target.value)}
            className="rounded-xl border border-[#dce5dc] bg-[#fffefa] px-4 py-2.5 text-sm outline-none focus:border-primary"
            data-testid="select-timeline-year"
          >
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        }
      />

      {newTablesError && !coreError && <DataAlert error={newTablesError} retry={retry} />}

      {coreError ? (
        <DataAlert error={coreError} retry={retry} />
      ) : loading ? (
        <div className="mv-card p-6">
          <SkeletonRows />
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="Your timeline starts here"
          body="Upload records, add prescriptions or receipts, or schedule appointments to build your timeline."
          action={
            <Link
              href="/records/upload"
              className="mv-button inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"
              data-testid="link-timeline-upload"
            >
              <Plus className="h-4 w-4" /> Add your first record
            </Link>
          }
        />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-2" data-testid="timeline-kind-filters">
            <button
              onClick={() => setKind('all')}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                kind === 'all' ? 'bg-[#dce9df] text-primary' : 'border border-[#e1e9df] bg-white text-[#73877d] hover:bg-white/80'
              }`}
              data-testid="button-timeline-kind-all"
            >
              All ({events.length})
            </button>
            {(Object.keys(KIND_META) as TimelineKind[])
              .filter((k) => counts[k])
              .map((k) => (
                <button
                  key={k}
                  onClick={() => setKind(k)}
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                    kind === k ? 'bg-[#dce9df] text-primary' : 'border border-[#e1e9df] bg-white text-[#73877d] hover:bg-white/80'
                  }`}
                  data-testid={`button-timeline-kind-${k}`}
                >
                  {KIND_META[k].label} ({counts[k]})
                </button>
              ))}
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No events match"
              body="Select another year or event type to view entries."
            />
          ) : (
            <div className="mv-card p-5 sm:p-8">
              <div className="relative space-y-5 before:absolute before:bottom-5 before:left-[92px] before:top-5 before:w-px before:bg-[#d6e2d6] sm:before:left-[112px]">
                {filtered.map((event) => {
                  const Icon = KIND_META[event.kind].icon;
                  const d = parseDate(event.date);
                  const upcoming = event.at > nowMs && event.date >= today;
                  return (
                    <div
                      key={event.id}
                      className="relative grid grid-cols-[76px_24px_1fr] items-start gap-3 sm:grid-cols-[96px_26px_1fr] sm:gap-4"
                      data-testid={`timeline-event-${event.id}`}
                    >
                      <div className="pt-2.5 text-right" data-testid={`timeline-when-${event.id}`}>
                        <div className="font-mono text-[10px] leading-tight text-[#788e83]">
                          {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          <br />
                          {d.getFullYear()}
                        </div>
                        {event.time && (
                          <div className="mt-0.5 font-mono text-[10px] font-semibold text-[#4c6b61]">
                            {formatTime(event.time)}
                          </div>
                        )}
                      </div>
                      <span className="z-10 mt-3 grid h-6 w-6 place-items-center rounded-full border-4 border-[#e5efe4] bg-[#4c8070]">
                        <span className="h-1.5 w-1.5 rounded-full bg-white" />
                      </span>
                      <Link
                        href={event.href}
                        className="flex items-center gap-3 rounded-xl border border-[#e3ebe2] bg-[#fbfcf8] p-3.5 transition hover:border-primary/50"
                        data-testid={`link-event-${event.id}`}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eaf1e8] text-primary">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{event.title}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {KIND_META[event.kind].label}
                            {event.subtitle ? ` · ${event.subtitle}` : ''}
                          </span>
                        </div>
                        {event.tag && <Badge tone="blue">{event.tag}</Badge>}
                        {upcoming && <Badge tone="amber">Upcoming</Badge>}
                        <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-[#91a49a]" />
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
