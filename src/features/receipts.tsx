import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearch } from 'wouter';
import { ArrowDownToLine, LoaderCircle, Plus, Receipt as ReceiptIcon, Search, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { recordAudit } from '@/lib/helpers';
import type { Prescription, Receipt } from '@/lib/types';
import { formatDateTime, localToday, normTime } from '@/lib/datetime';
import { formatFileSize, removeStoredFiles, signedUrl, uploadPrivateFile } from '@/lib/storage';
import {
  DataAlert,
  EmptyState,
  Field,
  FileDropField,
  Modal,
  Notice,
  PageHeading,
  SelectField,
  SkeletonRows,
  TextAreaField,
  ghostButtonCls,
  primaryButtonCls,
  useRows,
} from '@/components/common';

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'SGD'];

export function formatMoney(amount: number | string, currency: string): string {
  const n = Number(amount);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function ReceiptModal({
  prescriptions,
  presetPrescription,
  onClose,
  onSaved,
}: {
  prescriptions: Prescription[];
  presetPrescription?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    const f = new FormData(e.currentTarget);
    setError(null);
    if (!file) return setError('Please attach the receipt image or PDF.');
    const amount = Number(String(f.get('amount') || ''));
    if (!Number.isFinite(amount) || amount < 0) return setError('Enter a valid amount (0 or more).');

    setBusy(true);
    const up = await uploadPrivateFile(user.id, 'receipts', file);
    if (up.error || !up.data) {
      setBusy(false);
      return setError(`Upload failed: ${up.error}`);
    }

    const { data, error: dbError } = await supabase
      .from('medicine_receipts')
      .insert({
        user_id: user.id,
        prescription_id: String(f.get('prescription_id') || '') || null,
        pharmacy_name: String(f.get('pharmacy_name') || '').trim(),
        purchase_date: String(f.get('purchase_date')),
        purchase_time: normTime(String(f.get('purchase_time') || '')),
        amount,
        currency: String(f.get('currency') || 'INR'),
        notes: String(f.get('notes') || '').trim() || null,
        ...up.data,
      })
      .select('id')
      .single();

    if (dbError) {
      await removeStoredFiles([up.data.storage_path]);
      setBusy(false);
      return setError(`Receipt could not be saved: ${dbError.message}. The uploaded file was removed.`);
    }
    await recordAudit(user.id, 'receipt_uploaded', 'Medicine receipt uploaded', { receipt_id: data?.id });
    setBusy(false);
    onSaved('Receipt saved to your vault.');
  }

  return (
    <Modal title="Add a medicine receipt" close={onClose} size="lg">
      <form onSubmit={submit} className="space-y-4" data-testid="form-receipt">
        {error && (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" data-testid="status-receipt-error">
            {error}
          </div>
        )}
        <FileDropField label="Receipt image or PDF" file={file} onChange={setFile} onError={setError} testId="input-receipt-file" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Pharmacy name" name="pharmacy_name" required placeholder="e.g. City Pharmacy" />
          <Field label="Amount" name="amount" type="number" required placeholder="0.00" />
          <Field label="Purchase date" name="purchase_date" type="date" required defaultValue={localToday()} />
          <Field label="Purchase time (optional)" name="purchase_time" type="time" />
          <SelectField label="Currency" name="currency" defaultValue="INR">
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </SelectField>
          <SelectField label="Linked prescription (optional)" name="prescription_id" defaultValue={presetPrescription || ''}>
            <option value="">None</option>
            {prescriptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.doctor_name} · {formatDateTime(p.prescription_date, p.prescription_time)}
              </option>
            ))}
          </SelectField>
        </div>
        <TextAreaField label="Notes (optional)" name="notes" />
        <button disabled={busy} className={`${primaryButtonCls} w-full`} data-testid="button-save-receipt">
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {busy ? 'Uploading & saving…' : 'Save receipt'}
        </button>
      </form>
    </Modal>
  );
}

export function ReceiptsPage() {
  const { user } = useAuth();
  const receipts = useRows<Receipt>('medicine_receipts', 'purchase_date', false);
  const rx = useRows<Prescription>('prescriptions', 'prescription_date', false);
  const params = useSearch();
  const [notice, setNotice] = useState<Notice>(null);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [preset, setPreset] = useState<string | undefined>();

  // /receipts?new=1&prescription=<id> opens the form (used by the Prescriptions page)
  useEffect(() => {
    const p = new URLSearchParams(params);
    if (p.get('new') === '1') {
      setPreset(p.get('prescription') || undefined);
      setModal(true);
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [params]);

  const q = search.trim().toLowerCase();
  const shown = receipts.rows.filter(
    (r) => !q || `${r.pharmacy_name} ${r.notes || ''} ${r.file_name}`.toLowerCase().includes(q)
  );

  const totals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of shown) map.set(r.currency, (map.get(r.currency) || 0) + Number(r.amount));
    return [...map.entries()];
  }, [shown]);

  const rxById = useMemo(() => new Map(rx.rows.map((p) => [p.id, p])), [rx.rows]);

  const openFile = async (r: Receipt) => {
    const { url, error } = await signedUrl(r.storage_path);
    if (error || !url) return setNotice({ type: 'error', text: `Could not open the file: ${error}` });
    await recordAudit(user?.id, 'document_viewed', 'Medicine receipt viewed', { receipt_id: r.id });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const remove = async (r: Receipt) => {
    if (!window.confirm('Delete this receipt and its stored file? This cannot be undone.')) return;
    const { error } = await supabase.from('medicine_receipts').delete().eq('id', r.id);
    if (error) return setNotice({ type: 'error', text: error.message });
    await removeStoredFiles([r.storage_path]);
    await recordAudit(user?.id, 'receipt_deleted', 'Medicine receipt deleted', { receipt_id: r.id });
    setNotice({ type: 'success', text: 'Receipt deleted.' });
    receipts.refresh();
  };

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Pharmacy purchases"
        title="Medicine Receipts"
        subtitle="Store pharmacy receipts with the pharmacy, exact date and time, and amount."
        action={
          <button
            onClick={() => {
              setPreset(undefined);
              setModal(true);
            }}
            className={primaryButtonCls}
            data-testid="button-add-receipt"
          >
            <Plus className="h-4 w-4" /> Add receipt
          </button>
        }
      />
      <Notice notice={notice} dismiss={() => setNotice(null)} />

      {receipts.error ? (
        <DataAlert error={receipts.error} retry={receipts.refresh} />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by pharmacy…"
                className="w-full rounded-xl border border-[#dce5dc] bg-[#fffefa] py-3 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                data-testid="input-search-receipts"
              />
            </div>
            {totals.length > 0 && (
              <div className="text-xs text-muted-foreground" data-testid="text-receipt-total">
                {shown.length} receipt{shown.length === 1 ? '' : 's'} ·{' '}
                {totals.map(([c, t]) => formatMoney(t, c)).join(' + ')}
              </div>
            )}
          </div>

          {receipts.loading ? (
            <div className="mv-card p-6"><SkeletonRows /></div>
          ) : receipts.rows.length === 0 ? (
            <EmptyState
              icon={ReceiptIcon}
              title="No receipts yet"
              body="Upload a photo or PDF of a pharmacy receipt to keep your medicine purchases together."
              action={
                <button onClick={() => setModal(true)} className={primaryButtonCls + ' !py-2.5 !text-xs'} data-testid="button-empty-add-receipt">
                  <Plus className="h-4 w-4" /> Add your first receipt
                </button>
              }
            />
          ) : shown.length === 0 ? (
            <EmptyState icon={Search} title="No matching receipts" body="Nothing matched your search." />
          ) : (
            <div className="space-y-3">
              {shown.map((r) => {
                const linked = r.prescription_id ? rxById.get(r.prescription_id) : null;
                return (
                  <div key={r.id} className="mv-card flex flex-wrap items-center gap-4 p-4 sm:p-5" data-testid={`row-receipt-${r.id}`}>
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#edf3eb] text-primary">
                      <ReceiptIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.pharmacy_name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground" data-testid={`text-receipt-when-${r.id}`}>
                        {formatDateTime(r.purchase_date, r.purchase_time)} · {formatFileSize(r.file_size)}
                      </p>
                      {linked && <p className="mt-0.5 text-xs text-[#72857b]">For prescription by {linked.doctor_name}</p>}
                      {r.notes && <p className="mt-0.5 text-xs text-[#72857b]">{r.notes}</p>}
                    </div>
                    <div className="text-right text-base font-semibold tabular-nums" data-testid={`text-receipt-amount-${r.id}`}>
                      {formatMoney(r.amount, r.currency)}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => openFile(r)} className={ghostButtonCls} data-testid={`button-view-receipt-${r.id}`}>
                        <ArrowDownToLine className="h-3.5 w-3.5" /> View
                      </button>
                      <button onClick={() => remove(r)} aria-label="Delete receipt" className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-700" data-testid={`button-delete-receipt-${r.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {modal && (
        <ReceiptModal
          prescriptions={rx.rows}
          presetPrescription={preset}
          onClose={() => setModal(false)}
          onSaved={(message) => {
            setModal(false);
            setNotice({ type: 'success', text: message });
            receipts.refresh();
          }}
        />
      )}
    </div>
  );
}
