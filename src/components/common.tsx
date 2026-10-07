import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, FolderOpen, Upload, X, type LucideIcon } from 'lucide-react';
import { formatFileSize, validateFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';

export type Notice = { type: 'error' | 'success' | 'info'; text: string } | null;

export function Notice({ notice, dismiss }: { notice: Notice; dismiss: () => void }) {
  if (!notice) return null;
  const cls =
    notice.type === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-900'
      : notice.type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : 'border-teal-200 bg-teal-50 text-teal-900';
  return (
    <div
      role="status"
      data-testid="status-notice"
      className={`mb-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${cls}`}
    >
      <span>{notice.text}</span>
      <button
        onClick={dismiss}
        aria-label="Dismiss notice"
        data-testid="button-dismiss-notice"
        className="p-0.5 hover:opacity-75"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {eyebrow && (
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="mv-title text-[32px] font-semibold leading-tight md:text-[38px]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function LoadingPage() {
  return (
    <div className="min-h-[60vh] p-6">
      <div className="mx-auto max-w-5xl animate-pulse space-y-4">
        <div className="h-5 w-32 rounded bg-[#e5ece5]" />
        <div className="mt-5 h-10 w-1/2 rounded bg-[#e5ece5]" />
        <div className="mt-3 h-4 w-2/3 rounded bg-[#e5ece5]" />
        <div className="mt-10 h-52 rounded-2xl bg-[#e5ece5]" />
      </div>
    </div>
  );
}

// Data Fetching Hook
export function useRows<T>(table: string, order: string = 'created_at', ascending = false) {
  const { user } = useAuth();
  const userId = user?.id;
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    async function load() {
      if (!userId) {
        setRows([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .order(order, { ascending });
        if (!live) return;
        if (error) {
          setError(error.message);
          setRows([]);
        } else {
          setRows((data || []) as T[]);
          setError(null);
        }
      } catch (err: any) {
        if (!live) return;
        setError(err?.message || 'Failed to load records.');
      } finally {
        if (live) setLoading(false);
      }
    }
    load();
    return () => {
      live = false;
    };
  }, [userId, table, order, ascending, reload]);

  return { rows, loading, error, refresh: () => setReload((x) => x + 1), setRows };
}

export function DataAlert({ error, retry }: { error: string; retry: () => void }) {
  const isSchemaMissing = error.toLowerCase().includes('schema cache') || error.toLowerCase().includes('not find the table');
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 mb-5">
      <div className="flex gap-3">
        <AlertCircle className="h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <p className="text-sm font-semibold text-amber-950">
            {isSchemaMissing ? 'Database tables are being set up' : "We couldn't load this information"}
          </p>
          <p className="mt-1 text-xs leading-5 text-amber-900/80">
            {isSchemaMissing
              ? 'The required database tables were not found in the Supabase project. Run the migration SQL in your Supabase SQL Editor.'
              : `${error}. Check your connection and try again.`}
          </p>
          <button
            onClick={retry}
            className="mt-3 rounded-lg border border-amber-300 bg-white/70 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-white"
            data-testid="button-retry-load"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon = FolderOpen,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mv-card flex flex-col items-center px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#e9f0e8] text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 font-semibold text-base">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="mv-card p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export function SkeletonRows() {
  return (
    <div className="mt-5 animate-pulse space-y-4">
      {[0, 1, 2].map((n) => (
        <div key={n} className="flex gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#e7eee6]" />
          <div className="flex-1">
            <div className="h-3 w-1/2 rounded bg-[#e7eee6]" />
            <div className="mt-2 h-2 w-1/3 rounded bg-[#edf1eb]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  placeholder = '',
  required = false,
  autoComplete,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-xs font-semibold text-[#49655b]">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        data-testid={`input-${name.replaceAll('_', '-')}`}
        className="w-full rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 text-sm outline-none transition placeholder:text-[#a2b0a7] focus:border-primary focus:ring-2 focus:ring-primary/10"
      />
    </div>
  );
}

export function Modal({
  title,
  close,
  children,
  size = 'md',
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  size?: 'md' | 'lg' | 'xl';
}) {
  const width = size === 'xl' ? 'max-w-3xl' : size === 'lg' ? 'max-w-2xl' : 'max-w-lg';
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#1d3933]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[92dvh] w-full ${width} overflow-y-auto rounded-t-[24px] bg-[#fbfcf8] p-5 shadow-2xl sm:rounded-[24px] sm:p-7`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="mv-title text-2xl font-semibold">{title}</h2>
          <button
            onClick={close}
            aria-label="Close dialog"
            className="rounded-lg p-2 hover:bg-muted"
            data-testid="button-close-dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Extra form building blocks (same visual language as Field)
// -----------------------------------------------------------------------------
const inputCls =
  'w-full rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 text-sm outline-none transition placeholder:text-[#a2b0a7] focus:border-primary focus:ring-2 focus:ring-primary/10';

export function SelectField({
  label,
  name,
  value,
  defaultValue,
  onChange,
  required = false,
  children,
}: {
  label: string;
  name: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-xs font-semibold text-[#49655b]">
        {label}
      </label>
      <select
        id={name}
        name={name}
        required={required}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        data-testid={`select-${name.replaceAll('_', '-')}`}
        className={inputCls}
      >
        {children}
      </select>
    </div>
  );
}

export function TextAreaField({
  label,
  name,
  rows = 3,
  placeholder,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  name: string;
  rows?: number;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-xs font-semibold text-[#49655b]">
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        rows={rows}
        placeholder={placeholder}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        data-testid={`input-${name.replaceAll('_', '-')}`}
        className={`${inputCls} resize-y`}
      />
    </div>
  );
}

const badgeTones = {
  green: 'bg-[#e5f1e6] text-[#477461]',
  amber: 'bg-[#fbf0dc] text-[#8a6420]',
  rose: 'bg-rose-50 text-rose-700',
  gray: 'bg-[#f0efeb] text-[#748078]',
  blue: 'bg-[#e4eef4] text-[#2f6483]',
} as const;

export function Badge({
  tone = 'green',
  children,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export const primaryButtonCls =
  'mv-button inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-50';

export const ghostButtonCls =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-[#d9e3da] bg-white px-3.5 py-2.5 text-xs font-semibold text-[#44695d] transition hover:bg-[#f3f7f1] disabled:opacity-50';

/** Compact drag-and-drop / browse file picker for PDF, JPG and PNG (max 20 MB). */
export function FileDropField({
  file,
  onChange,
  onError,
  label,
  testId = 'input-file',
  hint = 'PDF, PNG, JPG, JPEG · up to 20 MB',
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  onError: (message: string) => void;
  label: string;
  testId?: string;
  hint?: string;
}) {
  const [drag, setDrag] = useState(false);
  const choose = (f: File | null) => {
    if (!f) {
      onChange(null);
      return;
    }
    const problem = validateFile(f);
    if (problem) {
      onError(problem);
      return;
    }
    onChange(f);
  };
  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold text-[#49655b]">{label}</span>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          choose(e.dataTransfer.files[0] || null);
        }}
        className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 transition ${
          drag
            ? 'border-primary bg-[#e9f1e9]'
            : 'border-[#c9d9cc] bg-[#f6f8f3] hover:border-primary/50'
        }`}
      >
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          onChange={(e) => {
            choose(e.target.files?.[0] || null);
            e.target.value = '';
          }}
          className="sr-only"
          data-testid={testId}
        />
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm">
          {file ? <CheckCircle2 className="h-5 w-5" /> : <Upload className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {file ? file.name : 'Choose a file or drop it here'}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {file ? formatFileSize(file.size) : hint}
          </span>
        </span>
        {file && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              onChange(null);
            }}
            aria-label="Remove selected file"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </label>
    </div>
  );
}

