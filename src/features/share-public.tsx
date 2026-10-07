import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  LoaderCircle,
  LockKeyhole,
  Pill,
  Receipt as ReceiptIcon,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { hashToken } from '@/lib/helpers';
import { formatDate, formatDateTime, formatTimestamp } from '@/lib/datetime';
import { signedUrl } from '@/lib/storage';
import { Badge } from '@/components/common';
import { Brand } from '@/components/brand';
import { formatMoney } from '@/features/receipts';

type PackDoc = {
  document_id: string;
  title: string;
  category: string | null;
  file_name: string;
  storage_path: string;
  document_date: string | null;
  document_time?: string | null;
  doctor_name?: string | null;
  hospital_name?: string | null;
  description: string | null;
};
type PackMedicine = {
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration_days: number | null;
  start_date: string | null;
  notes: string | null;
};
type PackRx = {
  prescription_id: string;
  doctor_name: string;
  hospital_name: string | null;
  prescription_date: string;
  prescription_time: string | null;
  reason: string | null;
  notes: string | null;
  file_name: string | null;
  storage_path: string | null;
  medicines: PackMedicine[];
};
type PackReceipt = {
  receipt_id: string;
  pharmacy_name: string;
  purchase_date: string;
  purchase_time: string | null;
  amount: number;
  currency: string;
  notes: string | null;
  file_name: string;
  storage_path: string;
};
type PackAppt = {
  appointment_id: string;
  appointment_type: string;
  doctor_name: string | null;
  hospital_name: string | null;
  appointment_date: string;
  appointment_time: string | null;
  reason: string | null;
  notes: string | null;
};
type Pack = {
  share: {
    id: string;
    kind: string | null;
    title: string | null;
    note: string | null;
    permission: 'VIEW' | 'VIEW_DOWNLOAD';
    recipient: string;
    expires_at: string;
  };
  patient: { full_name: string | null; age_years: number | null; age_months: number | null } | null;
  documents: PackDoc[];
  prescriptions: PackRx[];
  receipts: PackReceipt[];
  appointments: PackAppt[];
};

/** Older databases (migration not applied yet) only have the legacy documents-only RPC. */
async function loadLegacy(hash: string): Promise<Pack | null> {
  const { data, error } = await supabase.rpc('get_medical_share', { p_token_hash: hash });
  if (error) throw error;
  const rows = (data || []) as any[];
  if (rows.length === 0) return null;
  return {
    share: {
      id: rows[0].share_id,
      kind: 'documents',
      title: null,
      note: null,
      permission: rows[0].permission,
      recipient: rows[0].recipient,
      expires_at: rows[0].expires_at,
    },
    patient: null,
    documents: rows.map((r) => ({
      document_id: r.document_id,
      title: r.title,
      category: r.category,
      file_name: r.file_name,
      storage_path: r.storage_path,
      document_date: r.document_date,
      description: r.description,
    })),
    prescriptions: [],
    receipts: [],
    appointments: [],
  };
}

/**
 * Fetch the pack once per page load. Every successful call counts as one "open" against
 * the link's view limit, so duplicate calls (React StrictMode re-running effects in
 * development, quick re-renders) must share a single request.
 */
const inflight = new Map<string, Promise<Pack | null>>();
function loadPack(hash: string): Promise<Pack | null> {
  const existing = inflight.get(hash);
  if (existing) return existing;
  const p = (async () => {
    // One call = one counted view.
    const { data, error } = await supabase.rpc('get_share_pack', { p_token_hash: hash });
    if (error) {
      const missing =
        error.code === 'PGRST202' ||
        error.code === '42883' ||
        /could not find the function|does not exist/i.test(error.message);
      if (!missing) throw error;
      return loadLegacy(hash);
    }
    return (data as Pack | null) ?? null;
  })();
  inflight.set(hash, p);
  // allow a deliberate later reload to count as a new open
  window.setTimeout(() => inflight.delete(hash), 5000);
  return p;
}

export function SharePublic({ token }: { token: string }) {
  const [state, setState] = useState<'checking' | 'valid' | 'invalid' | 'error'>('checking');
  const [pack, setPack] = useState<Pack | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('Verifying temporary access…');

  useEffect(() => {
    let live = true;
    async function verify() {
      if (!isSupabaseConfigured) {
        setState('error');
        setMessage('MediVault storage is not connected.');
        return;
      }
      try {
        const hash = await hashToken(token);
        const result = await loadPack(hash);

        if (!result) {
          if (live) {
            setState('invalid');
            setMessage('This secure share link is invalid, expired, or has been revoked.');
          }
          return;
        }
        if (!live) return;
        setPack(result);
        setState('valid');

        const paths = [
          ...result.documents.map((d) => d.storage_path),
          ...result.prescriptions.map((p) => p.storage_path),
          ...result.receipts.map((r) => r.storage_path),
        ].filter(Boolean) as string[];
        const map: Record<string, string> = {};
        for (const path of paths) {
          const { url } = await signedUrl(path, 300);
          if (url) map[path] = url;
        }
        if (live) setUrls(map);
      } catch (err: any) {
        if (live) {
          setState('error');
          setMessage(err?.message || 'Unable to verify this secure link.');
        }
      }
    }
    void verify();
    return () => {
      live = false;
    };
  }, [token]);

  const FileLink = ({ path }: { path: string | null }) =>
    path && urls[path] ? (
      <a
        href={urls[path]}
        target="_blank"
        rel="noreferrer"
        className="mv-button inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm"
        data-testid="link-open-shared-file"
      >
        <ArrowDownToLine className="h-4 w-4" />
        {pack?.share.permission === 'VIEW_DOWNLOAD' ? 'Download' : 'View'}
      </a>
    ) : null;

  const heading = (icon: React.ReactNode, label: string, count: number) => (
    <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      {icon}
      {label} <span className="text-xs font-normal text-muted-foreground">({count})</span>
    </h2>
  );

  const age =
    pack?.patient && pack.patient.age_years !== null
      ? pack.patient.age_years >= 1
        ? `${pack.patient.age_years} year${pack.patient.age_years === 1 ? '' : 's'}`
        : `${pack.patient.age_months ?? 0} month${pack.patient.age_months === 1 ? '' : 's'}`
      : null;

  return (
    <div className="min-h-[100dvh] bg-[#f7f9f4] px-5 py-8">
      <div className="mx-auto max-w-3xl">
        <Brand />
        <div className="mt-12">
          {state === 'checking' ? (
            <div className="mv-card p-8 text-center">
              <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">{message}</p>
            </div>
          ) : state === 'valid' && pack ? (
            <div className="mv-enter space-y-6">
              <div className="flex items-center gap-2 rounded-xl border border-[#cfe1d1] bg-[#eaf3e9] px-4 py-3 text-xs text-[#426e57]">
                <ShieldCheck className="h-4 w-4" />
                Valid temporary medical share. Only the items the patient selected are accessible.
              </div>

              <section className="mv-card p-6 sm:p-8" data-testid="share-header">
                <p className="text-xs font-bold uppercase tracking-wider text-primary">
                  Shared for: {pack.share.recipient}
                </p>
                <h1 className="mv-title mt-2 text-3xl font-semibold">
                  {pack.share.title || (pack.share.kind === 'visit_pack' ? 'Doctor Visit Pack' : 'Shared Medical Records')}
                </h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Expires {formatTimestamp(pack.share.expires_at)} · Access level: {pack.share.permission}
                </p>
                {pack.patient && (
                  <p className="mt-4 flex items-center gap-2 text-sm" data-testid="share-patient">
                    <UserRound className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{pack.patient.full_name || 'Patient'}</span>
                    {age && <span className="text-muted-foreground">· {age}</span>}
                  </p>
                )}
                {pack.share.note && (
                  <p className="mt-4 rounded-lg bg-[#f2f5ef] p-3 text-xs leading-relaxed text-[#586f64]" data-testid="share-note">
                    <span className="mb-1 block font-semibold text-[#44695d]">Note from the patient</span>
                    {pack.share.note}
                  </p>
                )}
              </section>

              {pack.documents.length > 0 && (
                <section className="mv-card p-6" data-testid="section-share-documents">
                  {heading(null, 'Medical records', pack.documents.length)}
                  <div className="divide-y divide-[#e8eee7]">
                    {pack.documents.map((doc) => (
                      <div key={doc.document_id} className="py-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <span className="text-[10px] font-bold uppercase text-primary">{doc.category || 'Record'}</span>
                            <h3 className="text-lg font-semibold">{doc.title || doc.file_name}</h3>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {doc.document_date ? formatDateTime(doc.document_date, doc.document_time) : 'Date not specified'}
                              {doc.doctor_name ? ` · ${doc.doctor_name}` : ''}
                              {doc.hospital_name ? ` · ${doc.hospital_name}` : ''}
                            </p>
                            {doc.description && (
                              <p className="mt-2 rounded-lg bg-[#f2f5ef] p-3 text-xs leading-relaxed text-[#586f64]">{doc.description}</p>
                            )}
                          </div>
                          <FileLink path={doc.storage_path} />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {pack.prescriptions.length > 0 && (
                <section className="mv-card p-6" data-testid="section-share-prescriptions">
                  {heading(<Pill className="h-4 w-4 text-primary" />, 'Prescriptions & medicines', pack.prescriptions.length)}
                  <div className="space-y-5">
                    {pack.prescriptions.map((p) => (
                      <div key={p.prescription_id} className="rounded-xl border border-[#e3ebe2] p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-base font-semibold">{p.doctor_name}</h3>
                            <p className="text-xs text-muted-foreground">
                              {[p.hospital_name, formatDateTime(p.prescription_date, p.prescription_time)].filter(Boolean).join(' · ')}
                            </p>
                            {p.reason && <p className="mt-1 text-xs text-[#72857b]">Reason: {p.reason}</p>}
                          </div>
                          <FileLink path={p.storage_path} />
                        </div>
                        <ul className="mt-3 divide-y divide-[#edf1eb] text-sm">
                          {p.medicines.map((m, i) => (
                            <li key={i} className="py-2" data-testid="share-medicine">
                              <span className="font-semibold">{m.medicine_name}</span>{' '}
                              <span className="text-muted-foreground">· {m.dosage} · {m.frequency}</span>
                              <span className="block text-xs text-muted-foreground">
                                {m.duration_days ? `${m.duration_days} day${m.duration_days === 1 ? '' : 's'}` : 'No duration set'}
                                {m.start_date ? ` · from ${formatDate(m.start_date)}` : ''}
                              </span>
                              {m.notes && <span className="block text-xs text-[#72857b]">{m.notes}</span>}
                            </li>
                          ))}
                        </ul>
                        {p.notes && <p className="mt-2 rounded-lg bg-[#f2f5ef] p-3 text-xs text-[#586f64]">{p.notes}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {pack.receipts.length > 0 && (
                <section className="mv-card p-6" data-testid="section-share-receipts">
                  {heading(<ReceiptIcon className="h-4 w-4 text-primary" />, 'Medicine receipts', pack.receipts.length)}
                  <div className="divide-y divide-[#e8eee7]">
                    {pack.receipts.map((r) => (
                      <div key={r.receipt_id} className="flex items-center justify-between gap-4 py-3">
                        <div>
                          <p className="text-sm font-semibold">{r.pharmacy_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(r.purchase_date, r.purchase_time)} · {formatMoney(r.amount, r.currency)}
                          </p>
                          {r.notes && <p className="text-xs text-[#72857b]">{r.notes}</p>}
                        </div>
                        <FileLink path={r.storage_path} />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {pack.appointments.length > 0 && (
                <section className="mv-card p-6" data-testid="section-share-appointments">
                  {heading(<CalendarDays className="h-4 w-4 text-primary" />, 'Appointments & follow-ups', pack.appointments.length)}
                  <div className="divide-y divide-[#e8eee7]">
                    {pack.appointments.map((a) => (
                      <div key={a.appointment_id} className="py-3">
                        <p className="text-sm font-semibold">
                          {a.doctor_name || 'Appointment'}{' '}
                          {a.appointment_type === 'follow_up' && <Badge tone="blue">Follow-up</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[a.hospital_name, formatDateTime(a.appointment_date, a.appointment_time)].filter(Boolean).join(' · ')}
                        </p>
                        {a.reason && <p className="text-xs text-[#72857b]">{a.reason}</p>}
                        {a.notes && <p className="text-xs text-[#72857b]">{a.notes}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <p className="text-center text-[11px] text-muted-foreground">
                This pack contains information entered or uploaded by the patient. MediVault does not provide diagnosis or medical advice.
              </p>
            </div>
          ) : (
            <div className="mv-card p-8 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#f5ece2] text-[#947049]">
                <LockKeyhole className="h-5 w-5" />
              </span>
              <h1 className="mv-title mt-4 text-2xl font-semibold">
                {state === 'invalid' ? 'Link Expired or Revoked' : 'Unable to Verify'}
              </h1>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground" data-testid="status-public-share">
                {message}
              </p>
              <Link href="/" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline" data-testid="link-share-home">
                Go to MediVault <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
