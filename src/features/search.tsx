import { useMemo, useState } from 'react';
import { Link, useSearch } from 'wouter';
import {
  ArrowRight,
  CalendarDays,
  FileText,
  Pill,
  Receipt as ReceiptIcon,
  ScrollText,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Appt, Doc, Medicine, Prescription, Receipt } from '@/lib/types';
import { combineDateTime, formatDateTime, normTime } from '@/lib/datetime';
import { Badge, DataAlert, EmptyState, PageHeading, SkeletonRows, useRows } from '@/components/common';
import { formatMoney } from '@/features/receipts';

export type SearchType = 'record' | 'prescription' | 'medicine' | 'receipt' | 'appointment';

const TYPE_META: Record<SearchType, { label: string; icon: LucideIcon }> = {
  record: { label: 'Records', icon: FileText },
  prescription: { label: 'Prescriptions', icon: ScrollText },
  medicine: { label: 'Medicines', icon: Pill },
  receipt: { label: 'Receipts', icon: ReceiptIcon },
  appointment: { label: 'Appointments', icon: CalendarDays },
};

type Item = {
  id: string;
  type: SearchType;
  title: string;
  subtitle: string;
  date: string;
  time: string | null;
  at: number;
  doctor: string | null;
  hospital: string | null;
  haystack: string;
  href: string;
  tag?: string;
};

const norm = (s: string | null | undefined) => (s || '').trim();

export function SearchPage() {
  const initialQ = new URLSearchParams(useSearch()).get('q') || '';
  const docs = useRows<Doc>('medical_documents');
  const appts = useRows<Appt>('appointments', 'appointment_date', false);
  const rx = useRows<Prescription>('prescriptions', 'prescription_date', false);
  const meds = useRows<Medicine>('medicines', 'created_at', true);
  const receipts = useRows<Receipt>('medicine_receipts', 'purchase_date', false);

  const [q, setQ] = useState(initialQ);
  const [type, setType] = useState<'all' | SearchType>('all');
  const [doctor, setDoctor] = useState('');
  const [hospital, setHospital] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const loading = docs.loading || appts.loading || rx.loading || meds.loading || receipts.loading;
  const error = docs.error || appts.error || rx.error || meds.error || receipts.error;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const rxById = new Map(rx.rows.map((p) => [p.id, p]));
    const add = (i: Omit<Item, 'at'>) => out.push({ ...i, at: combineDateTime(i.date, i.time).getTime() });

    for (const d of docs.rows) {
      const date = d.document_date || d.created_at.slice(0, 10);
      add({
        id: `d-${d.id}`,
        type: 'record',
        title: d.title || d.file_name,
        subtitle: [d.category, d.doctor_name, d.hospital_name].filter(Boolean).join(' · '),
        date,
        time: d.document_date ? normTime(d.document_time) : null,
        doctor: norm(d.doctor_name) || null,
        hospital: norm(d.hospital_name) || null,
        haystack: [d.title, d.file_name, d.category, d.doctor_name, d.hospital_name, d.description].join(' '),
        href: `/records/${d.id}`,
      });
    }
    for (const p of rx.rows) {
      const names = meds.rows.filter((m) => m.prescription_id === p.id).map((m) => m.medicine_name);
      add({
        id: `p-${p.id}`,
        type: 'prescription',
        title: `Prescription · ${p.doctor_name}`,
        subtitle: [p.hospital_name, names.join(', ')].filter(Boolean).join(' · '),
        date: p.prescription_date,
        time: normTime(p.prescription_time),
        doctor: norm(p.doctor_name) || null,
        hospital: norm(p.hospital_name) || null,
        haystack: [p.doctor_name, p.hospital_name, p.reason, p.notes, p.file_name, names.join(' ')].join(' '),
        href: '/medicines',
      });
    }
    for (const m of meds.rows) {
      const p = rxById.get(m.prescription_id);
      add({
        id: `m-${m.id}`,
        type: 'medicine',
        title: m.medicine_name,
        subtitle: [m.dosage, m.frequency, p ? `Dr. ${p.doctor_name.replace(/^dr\.?\s*/i, '')}` : null]
          .filter(Boolean)
          .join(' · '),
        date: m.start_date || p?.prescription_date || m.created_at.slice(0, 10),
        time: null,
        doctor: norm(p?.doctor_name) || null,
        hospital: norm(p?.hospital_name) || null,
        haystack: [m.medicine_name, m.dosage, m.frequency, m.notes, p?.doctor_name, p?.hospital_name].join(' '),
        href: '/medicines',
      });
    }
    for (const r of receipts.rows) {
      const p = r.prescription_id ? rxById.get(r.prescription_id) : undefined;
      add({
        id: `r-${r.id}`,
        type: 'receipt',
        title: `Receipt · ${r.pharmacy_name}`,
        subtitle: formatMoney(r.amount, r.currency),
        date: r.purchase_date,
        time: normTime(r.purchase_time),
        doctor: norm(p?.doctor_name) || null,
        hospital: norm(p?.hospital_name) || null,
        haystack: [r.pharmacy_name, r.notes, r.file_name, p?.doctor_name, String(r.amount)].join(' '),
        href: '/receipts',
      });
    }
    for (const a of appts.rows) {
      add({
        id: `a-${a.id}`,
        type: 'appointment',
        title: a.doctor_name || (a.appointment_type === 'follow_up' ? 'Follow-up visit' : 'Appointment'),
        subtitle: [a.hospital_name, a.reason].filter(Boolean).join(' · '),
        date: a.appointment_date,
        time: normTime(a.appointment_time),
        doctor: norm(a.doctor_name) || null,
        hospital: norm(a.hospital_name) || null,
        haystack: [a.doctor_name, a.hospital_name, a.reason, a.notes].join(' '),
        href: '/appointments',
        tag: a.appointment_type === 'follow_up' ? 'Follow-up' : undefined,
      });
    }
    return out;
  }, [docs.rows, appts.rows, rx.rows, meds.rows, receipts.rows]);

  const doctors = useMemo(
    () => [...new Set(items.map((i) => i.doctor).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [items]
  );
  const hospitals = useMemo(
    () => [...new Set(items.map((i) => i.hospital).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b)),
    [items]
  );

  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const textMatches = items.filter((i) => {
    const h = i.haystack.toLowerCase();
    return terms.every((t) => h.includes(t));
  });
  const withFilters = textMatches.filter(
    (i) =>
      (!doctor || i.doctor === doctor) &&
      (!hospital || i.hospital === hospital) &&
      (!from || i.date >= from) &&
      (!to || i.date <= to)
  );
  const counts = useMemo(() => {
    const c: Partial<Record<SearchType, number>> = {};
    for (const i of withFilters) c[i.type] = (c[i.type] || 0) + 1;
    return c;
  }, [withFilters]);
  const results = withFilters
    .filter((i) => type === 'all' || i.type === type)
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));

  const hasFilters = Boolean(q || type !== 'all' || doctor || hospital || from || to);
  const clear = () => {
    setQ('');
    setType('all');
    setDoctor('');
    setHospital('');
    setFrom('');
    setTo('');
  };

  const selectCls =
    'w-full rounded-xl border border-[#dce5dc] bg-[#fffefa] px-3.5 py-2.5 text-sm text-[#526c61] outline-none focus:border-primary';

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Find anything"
        title="Search"
        subtitle="Search across medicines, doctors, hospitals, prescriptions, appointments, receipts and records."
      />

      {error ? (
        <DataAlert
          error={error}
          retry={() => {
            docs.refresh();
            appts.refresh();
            rx.refresh();
            meds.refresh();
            receipts.refresh();
          }}
        />
      ) : (
        <>
          <div className="relative mb-4">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Try a medicine, doctor, hospital or pharmacy…"
              className="w-full rounded-xl border border-[#dce5dc] bg-[#fffefa] py-3 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              data-testid="input-global-search"
              autoFocus
            />
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select value={doctor} onChange={(e) => setDoctor(e.target.value)} className={selectCls} data-testid="select-search-doctor" aria-label="Filter by doctor">
              <option value="">All doctors</option>
              {doctors.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <select value={hospital} onChange={(e) => setHospital(e.target.value)} className={selectCls} data-testid="select-search-hospital" aria-label="Filter by hospital">
              <option value="">All hospitals &amp; clinics</option>
              {hospitals.map((h) => (
                <option key={h}>{h}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls} data-testid="input-search-from" />
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} data-testid="input-search-to" />
            </label>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setType('all')}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                type === 'all' ? 'bg-[#dce9df] text-primary' : 'border border-[#e1e9df] bg-white text-[#73877d]'
              }`}
              data-testid="button-search-type-all"
            >
              All ({withFilters.length})
            </button>
            {(Object.keys(TYPE_META) as SearchType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                  type === t ? 'bg-[#dce9df] text-primary' : 'border border-[#e1e9df] bg-white text-[#73877d]'
                }`}
                data-testid={`button-search-type-${t}`}
              >
                {TYPE_META[t].label} ({counts[t] || 0})
              </button>
            ))}
            {hasFilters && (
              <button onClick={clear} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline" data-testid="button-search-clear">
                <X className="h-3.5 w-3.5" /> Clear all
              </button>
            )}
          </div>

          {loading ? (
            <div className="mv-card p-6">
              <SkeletonRows />
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={Search} title="Nothing to search yet" body="Add records, prescriptions, receipts or appointments and they will be searchable here." />
          ) : results.length === 0 ? (
            <EmptyState icon={Search} title="No results" body="Try different words or clear a filter." />
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground" data-testid="text-search-count">
                {results.length} result{results.length === 1 ? '' : 's'}
              </p>
              <div className="mv-card divide-y divide-[#e8eee7] px-4 sm:px-6" data-testid="list-search-results">
                {results.map((i) => {
                  const Icon = TYPE_META[i.type].icon;
                  return (
                    <Link key={i.id} href={i.href} className="flex items-center gap-3 py-3.5 transition hover:opacity-80" data-testid={`row-search-${i.id}`}>
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3eb] text-primary">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{i.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {TYPE_META[i.type].label} · {formatDateTime(i.date, i.time)}
                          {i.subtitle ? ` · ${i.subtitle}` : ''}
                        </p>
                      </div>
                      {i.tag && <Badge tone="blue">{i.tag}</Badge>}
                      <ArrowRight className="h-4 w-4 shrink-0 text-[#91a49a]" />
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
