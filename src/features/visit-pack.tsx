import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import {
  Briefcase,
  CalendarDays,
  Copy,
  FileText,
  Link2,
  LoaderCircle,
  Receipt as ReceiptIcon,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { useProfile } from '@/lib/profile';
import { hashToken, recordAudit } from '@/lib/helpers';
import type { Appt, Doc, Medicine, Prescription, Receipt } from '@/lib/types';
import { formatAge, formatDateTime } from '@/lib/datetime';
import {
  DataAlert,
  Field,
  Notice,
  PageHeading,
  SelectField,
  SkeletonRows,
  TextAreaField,
  primaryButtonCls,
  useRows,
} from '@/components/common';
import { formatMoney } from '@/features/receipts';

type Section = {
  key: 'docs' | 'rx' | 'receipts' | 'appts';
  label: string;
  icon: LucideIcon;
  items: { id: string; title: string; sub: string }[];
};

export function VisitPackPage() {
  const { user } = useAuth();
  const { profile, age } = useProfile();
  const docs = useRows<Doc>('medical_documents');
  const rx = useRows<Prescription>('prescriptions', 'prescription_date', false);
  const meds = useRows<Medicine>('medicines', 'created_at', true);
  const receipts = useRows<Receipt>('medicine_receipts', 'purchase_date', false);
  const appts = useRows<Appt>('appointments', 'appointment_date', false);

  const [selected, setSelected] = useState<Record<Section['key'], string[]>>({
    docs: [],
    rx: [],
    receipts: [],
    appts: [],
  });
  const [title, setTitle] = useState('');
  const [recipient, setRecipient] = useState('');
  const [note, setNote] = useState('');
  const [includePatient, setIncludePatient] = useState(false);
  const [permission, setPermission] = useState<'VIEW' | 'VIEW_DOWNLOAD'>('VIEW');
  const [expiryHours, setExpiryHours] = useState('24');
  const [maxViews, setMaxViews] = useState('20');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [link, setLink] = useState('');

  const sections: Section[] = useMemo(() => {
    const medNames = new Map<string, string[]>();
    for (const m of meds.rows) {
      const list = medNames.get(m.prescription_id) || [];
      list.push(m.medicine_name);
      medNames.set(m.prescription_id, list);
    }
    return [
      {
        key: 'docs',
        label: 'Medical records',
        icon: FileText,
        items: docs.rows.map((d) => ({
          id: d.id,
          title: d.title || d.file_name,
          sub: [d.category, d.document_date ? formatDateTime(d.document_date, d.document_time) : null]
            .filter(Boolean)
            .join(' · '),
        })),
      },
      {
        key: 'rx',
        label: 'Prescriptions & medicines',
        icon: ScrollText,
        items: rx.rows.map((p) => ({
          id: p.id,
          title: `${p.doctor_name}${p.hospital_name ? ` · ${p.hospital_name}` : ''}`,
          sub: [formatDateTime(p.prescription_date, p.prescription_time), (medNames.get(p.id) || []).join(', ')]
            .filter(Boolean)
            .join(' · '),
        })),
      },
      {
        key: 'receipts',
        label: 'Medicine receipts',
        icon: ReceiptIcon,
        items: receipts.rows.map((r) => ({
          id: r.id,
          title: r.pharmacy_name,
          sub: `${formatDateTime(r.purchase_date, r.purchase_time)} · ${formatMoney(r.amount, r.currency)}`,
        })),
      },
      {
        key: 'appts',
        label: 'Appointments & follow-ups',
        icon: CalendarDays,
        items: appts.rows.map((a) => ({
          id: a.id,
          title: `${a.doctor_name || 'Appointment'}${a.hospital_name ? ` · ${a.hospital_name}` : ''}`,
          sub: `${a.appointment_type === 'follow_up' ? 'Follow-up · ' : ''}${formatDateTime(
            a.appointment_date,
            a.appointment_time
          )}`,
        })),
      },
    ];
  }, [docs.rows, rx.rows, meds.rows, receipts.rows, appts.rows]);

  const total = selected.docs.length + selected.rx.length + selected.receipts.length + selected.appts.length;
  const loading = docs.loading || rx.loading || receipts.loading || appts.loading;
  const error = docs.error || rx.error || meds.error || receipts.error || appts.error;

  const toggle = (key: Section['key'], id: string) =>
    setSelected((prev) => ({
      ...prev,
      [key]: prev[key].includes(id) ? prev[key].filter((x) => x !== id) : [...prev[key], id],
    }));
  const setAll = (s: Section, on: boolean) =>
    setSelected((prev) => ({ ...prev, [s.key]: on ? s.items.map((i) => i.id) : [] }));

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (total === 0) {
      setNotice({ type: 'error', text: 'Select at least one item to include in the pack.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    setLink('');

    let shareId: string | null = null;
    try {
      const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const hash = await hashToken(rawToken);
      const expiresAt = new Date(Date.now() + (parseInt(expiryHours, 10) || 24) * 3600_000).toISOString();

      const { data: share, error: shareError } = await supabase
        .from('shares')
        .insert({
          user_id: user.id,
          recipient: recipient.trim(),
          permission,
          token_hash: hash,
          expires_at: expiresAt,
          max_views: parseInt(maxViews, 10) || 20,
          view_count: 0,
          kind: 'visit_pack',
          title: title.trim() || `Visit pack for ${recipient.trim()}`,
          note: note.trim() || null,
          include_patient_info: includePatient,
        })
        .select('id')
        .single();
      if (shareError || !share) throw shareError || new Error('Could not create the share.');
      shareId = share.id as string;

      if (selected.docs.length) {
        const { error: e1 } = await supabase
          .from('shared_documents')
          .insert(selected.docs.map((document_id) => ({ share_id: shareId, document_id })));
        if (e1) throw e1;
      }
      const extra = [
        ...selected.rx.map((item_id) => ({ share_id: shareId, item_type: 'prescription', item_id })),
        ...selected.receipts.map((item_id) => ({ share_id: shareId, item_type: 'receipt', item_id })),
        ...selected.appts.map((item_id) => ({ share_id: shareId, item_type: 'appointment', item_id })),
      ];
      if (extra.length) {
        const { error: e2 } = await supabase.from('share_items').insert(extra);
        if (e2) throw e2;
      }

      setLink(`${window.location.origin}/share/${rawToken}`);
      setNotice({
        type: 'success',
        text: 'Visit pack created. Copy the secure link and give it to your doctor.',
      });
      // Audit metadata carries counts only, never health information.
      await recordAudit(user.id, 'visit_pack_created', 'Doctor visit pack created', {
        share_id: shareId,
        permission,
        documents: selected.docs.length,
        prescriptions: selected.rx.length,
        receipts: selected.receipts.length,
        appointments: selected.appts.length,
      });
      setSelected({ docs: [], rx: [], receipts: [], appts: [] });
    } catch (err: any) {
      // never leave a half-built share behind
      if (shareId) await supabase.from('shares').delete().eq('id', shareId);
      setNotice({ type: 'error', text: err?.message || 'Could not create the visit pack.' });
    } finally {
      setBusy(false);
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setNotice({ type: 'success', text: 'Share link copied to clipboard!' });
    } catch {
      setNotice({ type: 'error', text: 'Could not access the clipboard. Please copy the link manually.' });
    }
  };

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Before you see your doctor"
        title="Doctor Visit Pack"
        subtitle="Pick the records you want your doctor to see and share them through a temporary, revocable secure link."
      />
      <Notice notice={notice} dismiss={() => setNotice(null)} />

      {error ? (
        <DataAlert
          error={error}
          retry={() => {
            docs.refresh();
            rx.refresh();
            meds.refresh();
            receipts.refresh();
            appts.refresh();
          }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <section className="space-y-4" data-testid="pack-selection">
            <h2 className="text-sm font-semibold">1. Choose what to include</h2>
            {loading ? (
              <div className="mv-card p-6"><SkeletonRows /></div>
            ) : (
              sections.map((s) => (
                <div key={s.key} className="mv-card p-4 sm:p-5" data-testid={`pack-section-${s.key}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#edf3eb] text-primary">
                        <s.icon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold">{s.label}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {selected[s.key].length} of {s.items.length} selected
                        </p>
                      </div>
                    </div>
                    {s.items.length > 0 && (
                      <div className="flex gap-3 text-xs font-semibold text-primary">
                        <button type="button" onClick={() => setAll(s, true)} className="hover:underline" data-testid={`button-pack-all-${s.key}`}>
                          Select all
                        </button>
                        <button type="button" onClick={() => setAll(s, false)} className="hover:underline" data-testid={`button-pack-none-${s.key}`}>
                          Clear
                        </button>
                      </div>
                    )}
                  </div>
                  {s.items.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">Nothing here yet.</p>
                  ) : (
                    <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-[#e1e9df] bg-white p-2">
                      {s.items.map((i) => {
                        const checked = selected[s.key].includes(i.id);
                        return (
                          <label
                            key={i.id}
                            className={`flex cursor-pointer items-start gap-2.5 rounded-lg p-2 text-xs transition ${
                              checked ? 'bg-[#eaf1e8] text-[#245c4f]' : 'hover:bg-muted/40'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(s.key, i.id)}
                              className="mt-0.5 accent-[#47796b]"
                              data-testid={`check-pack-${s.key}-${i.id}`}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{i.title}</span>
                              {i.sub && <span className="block truncate text-[11px] text-muted-foreground">{i.sub}</span>}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </section>

          <section className="mv-card h-fit p-5 sm:p-6 lg:sticky lg:top-24">
            <div className="flex gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e9f1e8] text-primary">
                <Briefcase className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">2. Pack details</h2>
                <p className="mt-0.5 text-xs text-muted-foreground" data-testid="text-pack-count">
                  {total} item{total === 1 ? '' : 's'} selected
                </p>
              </div>
            </div>

            <form onSubmit={create} className="mt-5 space-y-4" data-testid="form-visit-pack">
              <Field label="Doctor or clinic" name="pack_recipient" required placeholder="e.g. Dr. Wilson / City Heart Clinic" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
              <Field label="Pack title (optional)" name="pack_title" placeholder="e.g. Follow-up visit, 12 Oct" value={title} onChange={(e) => setTitle(e.target.value)} />
              <TextAreaField label="Note for your doctor (optional)" name="pack_note" placeholder="Anything you want to mention, in your own words" value={note} onChange={(e) => setNote(e.target.value)} />

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-[#e1e9df] bg-[#f8faf5] p-3 text-xs">
                <input type="checkbox" checked={includePatient} onChange={(e) => setIncludePatient(e.target.checked)} className="mt-0.5 accent-[#47796b]" data-testid="check-pack-include-patient" />
                <span>
                  <span className="block font-semibold">Include my name and age</span>
                  <span className="text-[11px] text-muted-foreground">
                    {profile?.full_name || 'Your name'}
                    {age ? `, ${formatAge(age)}` : ' (add your date of birth in Profile to include your age)'}. Your date of birth is never shared.
                  </span>
                </span>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label="Access" name="pack_permission" value={permission} onChange={(e) => setPermission(e.target.value as 'VIEW' | 'VIEW_DOWNLOAD')}>
                  <option value="VIEW">View only</option>
                  <option value="VIEW_DOWNLOAD">View &amp; download</option>
                </SelectField>
                <SelectField label="Link expires" name="pack_expiry" value={expiryHours} onChange={(e) => setExpiryHours(e.target.value)}>
                  <option value="1">1 hour</option>
                  <option value="6">6 hours</option>
                  <option value="24">24 hours</option>
                  <option value="72">3 days</option>
                  <option value="168">7 days</option>
                </SelectField>
              </div>
              <SelectField label="Maximum opens" name="pack_max_views" value={maxViews} onChange={(e) => setMaxViews(e.target.value)}>
                <option value="5">5 opens</option>
                <option value="10">10 opens</option>
                <option value="20">20 opens</option>
                <option value="50">50 opens</option>
              </SelectField>

              {link && (
                <div className="rounded-xl border border-[#d5e2d4] bg-[#f2f6ef] p-3.5">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#60786e]">Secure pack link</p>
                  <div className="flex gap-2">
                    <input readOnly value={link} className="min-w-0 flex-1 rounded-lg border border-[#dce6db] bg-white px-2.5 py-2 text-xs" data-testid="input-pack-link" />
                    <button type="button" onClick={copy} className="rounded-lg bg-primary px-3 text-white hover:brightness-95" aria-label="Copy link" data-testid="button-copy-pack-link">
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Anyone with this link can open the selected items until it expires or you revoke it on the{' '}
                    <Link href="/sharing" className="font-semibold text-primary hover:underline">Sharing</Link> page.
                  </p>
                </div>
              )}

              <button disabled={busy || total === 0} className={`${primaryButtonCls} w-full`} data-testid="button-create-pack">
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                Create secure visit pack
              </button>
              <p className="flex gap-2 text-[11px] leading-5 text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                Only what you tick is shared. The link works for a limited time and number of opens, and you can revoke it at any moment.
              </p>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
