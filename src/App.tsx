import { useEffect, useMemo, useState, createContext, useContext, type ReactNode, type FormEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Session, User } from '@supabase/supabase-js';
import { Route, Switch, Link, useLocation, Router as WouterRouter } from 'wouter';
import {
  Activity, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCircle2,
  ChevronDown, Clock3, FileText, Fingerprint, Heart, House, KeyRound, LockKeyhole, LogOut, Menu,
  Plus, Search, Settings, Share2, Shield, ShieldCheck, Sparkles, Trash2, Upload, UserRound, X,
  AlertCircle, Eye, EyeOff, Link2, Copy, Ban, Bell, CalendarPlus, LoaderCircle, ClipboardList,
  FileClock, FolderOpen, Edit3, type LucideIcon
} from 'lucide-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

// Types
type AuthCtx = {
  session: Session | null;
  user: User | null;
  ready: boolean;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthCtx>({
  session: null,
  user: null,
  ready: false,
  refresh: async () => {},
});

const useAuth = () => useContext(AuthContext);

type Doc = {
  id: string;
  user_id?: string;
  title: string;
  category: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  document_date: string | null;
  doctor_name: string | null;
  hospital_name: string | null;
  description: string | null;
  extracted_text: string | null;
  ai_summary: string | null;
  ai_status: string | null;
  created_at: string;
};

type Appt = {
  id: string;
  user_id?: string;
  doctor_name: string | null;
  hospital_name: string | null;
  appointment_date: string;
  appointment_time: string | null;
  reason: string | null;
  notes: string | null;
  status: string | null;
  created_at?: string;
};

type ShareItem = {
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
  documents?: Doc[];
};

type AuditLog = {
  id: string;
  user_id?: string;
  action: string;
  event_type?: string;
  title: string;
  metadata?: Record<string, any> | string | null;
  created_at: string;
};

type Notice = { type: 'error' | 'success' | 'info'; text: string } | null;

// Helpers
async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function recordAudit(
  userId: string | undefined,
  action: string,
  title: string,
  metadata?: Record<string, any>
) {
  if (!userId || !isSupabaseConfigured) return;
  try {
    await supabase.from('audit_logs').insert({
      user_id: userId,
      action,
      event_type: action,
      title,
      metadata: metadata || {},
    });
  } catch {
    // Audit log insertion fails silently if table is not yet migrated
  }
}

// Auth Provider
function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = async () => {
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    const { data } = await supabase.auth.getSession();
    setSession(data.session);
    setReady(true);
  };

  useEffect(() => {
    let alive = true;
    if (!isSupabaseConfigured) {
      setReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (alive) {
        setSession(data.session);
        setReady(true);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      if (alive) {
        setSession(next);
        setReady(true);
      }
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, ready, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Notice & Alerts
function ConfigNotice() {
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div>
          <strong className="block font-semibold">Connect MediVault to Supabase</strong>
          <p className="mt-1 text-xs text-amber-900/80 leading-relaxed">
            Configure <code>NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
            <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> in your environment variables to enable secure authentication and records.
          </p>
        </div>
      </div>
    </div>
  );
}

function Notice({ notice, dismiss }: { notice: Notice; dismiss: () => void }) {
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

function Brand({ light = false }: { light?: boolean }) {
  return (
    <Link
      href="/"
      className={`flex items-center gap-2.5 ${light ? 'text-white' : 'text-foreground'}`}
      data-testid="link-brand"
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-xl ${
          light ? 'bg-white/15' : 'bg-primary text-primary-foreground'
        }`}
      >
        <Heart className="h-[18px] w-[18px]" strokeWidth={2.4} />
      </span>
      <span className="font-bold tracking-tight text-lg">MediVault</span>
    </Link>
  );
}

// Navigation & Shell
const navGroups: {
  title: string;
  items: { label: string; href: string; icon: LucideIcon }[];
}[] = [
  {
    title: 'Workspace',
    items: [
      { label: 'Overview', href: '/dashboard', icon: House },
      { label: 'My records', href: '/records', icon: FolderOpen },
      { label: 'Timeline', href: '/timeline', icon: FileClock },
      { label: 'Appointments', href: '/appointments', icon: CalendarDays },
    ],
  },
  {
    title: 'Your care',
    items: [
      { label: 'Sharing', href: '/sharing', icon: Share2 },
      { label: 'Security Activity', href: '/security', icon: Activity },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Profile', href: '/profile', icon: UserRound },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const [signing, setSigning] = useState(false);

  const signOut = async () => {
    setSigning(true);
    await recordAudit(user?.id, 'logout', 'User logged out');
    await supabase.auth.signOut();
    setSigning(false);
  };

  return (
    <div className="min-h-[100dvh] md:flex bg-[#f9faf5]">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col border-r border-[#dce7df] bg-[#eef4ef] px-5 py-6 transition-transform duration-200 md:sticky md:top-0 md:h-[100dvh] md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between">
          <Brand />
          <button
            className="md:hidden p-1 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            data-testid="button-close-menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-8 rounded-2xl border border-[#d8e4dd] bg-[#f8faf5] p-3.5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#dce9df] text-sm font-semibold text-[#315f53]">
              {(user?.user_metadata?.full_name || user?.email || 'M')
                .slice(0, 1)
                .toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {user?.user_metadata?.full_name || 'Your account'}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {user?.email || 'Private space'}
              </div>
            </div>
          </div>
        </div>

        <nav className="mt-7 flex-1 space-y-6 overflow-y-auto">
          {navGroups.map((group) => (
            <div key={group.title}>
              <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.15em] text-[#789087]">
                {group.title}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active =
                    loc === item.href ||
                    (item.href === '/records' && loc.startsWith('/records/')) ||
                    (item.href === '/security' && loc === '/activity');
                  return (
                    <Link
                      href={item.href}
                      key={item.href}
                      onClick={() => setOpen(false)}
                      data-testid={`link-nav-${item.label
                        .toLowerCase()
                        .replaceAll(' ', '-')}`}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${
                        active
                          ? 'bg-[#dce9df] text-[#245c4f]'
                          : 'text-[#536c63] hover:bg-white/70 hover:text-[#245c4f]'
                      }`}
                    >
                      <item.icon className="h-[17px] w-[17px]" />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="rounded-2xl border border-[#d8e4dd] bg-[#f7faf5] p-3.5">
          <div className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-semibold">Your records stay yours</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Protected with Row Level Security.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={signOut}
          disabled={signing}
          data-testid="button-sign-out"
          className="mt-4 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#60766e] hover:bg-white/70 transition"
        >
          {signing ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="h-4 w-4" />
          )}
          Sign out
        </button>
      </aside>

      {/* Mobile overlay */}
      {open && (
        <button
          className="fixed inset-0 z-30 bg-[#102c26]/30 backdrop-blur-sm md:hidden"
          aria-label="Close navigation overlay"
          onClick={() => setOpen(false)}
          data-testid="button-overlay-close"
        />
      )}

      {/* Main Content Area */}
      <div className="min-w-0 flex-1 flex flex-col min-h-[100dvh]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-[#e1e9e2]/90 bg-[#fafbf7]/90 px-5 backdrop-blur-md md:px-9">
          <button
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted md:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            data-testid="button-open-menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
            <LockKeyhole className="h-3.5 w-3.5 text-primary" />
            Your personal health space
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-xs font-semibold">
                {user?.user_metadata?.full_name || 'Welcome'}
              </div>
              <div className="text-[10px] text-muted-foreground">Private account</div>
            </div>
            <div className="grid h-9 w-9 place-items-center rounded-full border border-[#dce7df] bg-[#e7efe8] text-sm font-bold text-primary">
              {(user?.user_metadata?.full_name || user?.email || 'M')
                .slice(0, 1)
                .toUpperCase()}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1180px] px-5 py-8 md:px-9 md:py-10 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (ready && !user) navigate('/login');
  }, [ready, user, navigate]);

  if (!isSupabaseConfigured) {
    return (
      <main className="mx-auto max-w-xl px-5 py-20">
        <Brand />
        <h1 className="mv-title mt-10 text-3xl font-semibold">
          A secure home for your health history.
        </h1>
        <p className="mb-6 mt-3 text-muted-foreground text-sm leading-relaxed">
          MediVault requires Supabase credentials before private records can be accessed.
        </p>
        <ConfigNotice />
      </main>
    );
  }

  if (!ready || !user) return <LoadingPage />;
  return <AppShell>{children}</AppShell>;
}

function PageHeading({
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

function LoadingPage() {
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
function useRows<T>(table: string, order: string = 'created_at', ascending = false) {
  const { user } = useAuth();
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    async function load() {
      if (!user) {
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
  }, [user, table, order, ascending, reload]);

  return { rows, loading, error, refresh: () => setReload((x) => x + 1), setRows };
}

function DataAlert({ error, retry }: { error: string; retry: () => void }) {
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

function EmptyState({
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

function Stat({
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

function SkeletonRows() {
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

// -----------------------------------------------------------------------------
// PUBLIC LANDING & AUTH PAGES
// -----------------------------------------------------------------------------
function Landing() {
  return (
    <div className="min-h-[100dvh] overflow-hidden bg-[#f9faf5] text-[#1d3933]">
      <header className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-10">
        <Brand />
        <div className="hidden items-center gap-8 text-sm text-[#58716a] md:flex">
          <a href="#how" className="hover:text-primary transition">How it works</a>
          <a href="#privacy" className="hover:text-primary transition">Privacy</a>
          <a href="#sharing" className="hover:text-primary transition">Sharing</a>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="px-3 py-2 text-sm font-semibold text-[#42685d] hover:text-primary transition"
            data-testid="link-login"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="mv-button rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm"
            data-testid="link-get-started"
          >
            Get started
          </Link>
        </div>
      </header>

      <main>
        <section className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 pb-20 pt-14 md:grid-cols-[1.05fr_.95fr] md:px-10 md:pb-28 md:pt-20">
          <div className="relative z-10 mv-enter">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#d9e6dc] bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-[#51776a]">
              <ShieldCheck className="h-4 w-4" />
              Private health record management
            </div>
            <h1 className="mv-title max-w-2xl text-[44px] font-semibold leading-[1.05] tracking-tight sm:text-6xl md:text-[68px]">
              Your medical history, <span className="text-[#3b7263]">organized.</span>
            </h1>
            <p className="mt-6 max-w-lg text-[16px] leading-7 text-[#667b73]">
              A secure, private space for test results, prescriptions, provider visits, and appointments that make your health records accessible when you need them.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="mv-button inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground shadow-sm"
                data-testid="link-hero-signup"
              >
                Create your private space <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#how"
                className="rounded-full px-4 py-3 text-sm font-semibold text-[#4c6b61] hover:text-primary transition"
              >
                See how it works
              </a>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[500px] mv-enter">
            <div className="rounded-[28px] border border-[#d9e5db] bg-[#f3f6ef] p-4 shadow-lg">
              <div className="rounded-[22px] bg-[#fbfcf8] p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6d887e]">
                      Your Health, In View
                    </p>
                    <p className="mt-1 text-xl font-semibold">Alex Morgan</p>
                  </div>
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e5efe6] text-primary">
                    <Activity className="h-5 w-5" />
                  </span>
                </div>
                <div className="mt-6 space-y-3">
                  <div className="flex items-center gap-3 rounded-xl border border-[#e4ebe2] bg-white p-3.5">
                    <FileText className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">CBC Blood Test</p>
                      <p className="text-xs text-muted-foreground">03 Oct 2026 · Lab result</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-[#e4ebe2] bg-white p-3.5">
                    <FileText className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-semibold">MRI Report</p>
                      <p className="text-xs text-muted-foreground">18 Sep 2026 · Imaging</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 rounded-xl border border-[#e4ebe2] bg-white p-3.5">
                    <CalendarDays className="h-5 w-5 text-[#cc9a5b]" />
                    <div>
                      <p className="text-sm font-semibold">Cardiology Consultation</p>
                      <p className="text-xs text-muted-foreground">Upcoming visit</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function AuthLayout({
  children,
  title,
  kicker,
}: {
  children: ReactNode;
  title: string;
  kicker: string;
}) {
  return (
    <div className="grid min-h-[100dvh] bg-[#f8faf5] lg:grid-cols-[.85fr_1.15fr]">
      <aside className="relative hidden overflow-hidden bg-[#214e43] px-12 py-10 text-[#f5f7f0] lg:flex lg:flex-col">
        <Brand light />
        <div className="relative z-10 my-auto max-w-lg pb-14">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10">
            <Heart className="h-6 w-6" />
          </span>
          <p className="mt-7 text-xs font-bold uppercase tracking-[.17em] text-[#bdd5c5]">
            Your health, in view
          </p>
          <h2 className="mv-title mt-4 text-5xl font-semibold leading-tight">
            A clearer picture starts with a little organization.
          </h2>
          <p className="mt-5 max-w-sm text-sm leading-7 text-[#c5d8cb]">
            Keep your records close, your timeline clear, and your sharing in your hands.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#c1d4c8]">
          <LockKeyhole className="h-4 w-4" />
          Private by default with Supabase Row Level Security
        </div>
      </aside>
      <main className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[420px] mv-enter">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>
          <p className="text-xs font-bold uppercase tracking-[.16em] text-primary">{kicker}</p>
          <h1 className="mv-title mt-3 text-4xl font-semibold">{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder = '',
  required = false,
  autoComplete,
  value,
  onChange,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  value?: string;
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
        onChange={onChange}
        data-testid={`input-${name.replaceAll('_', '-')}`}
        className="w-full rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 text-sm outline-none transition placeholder:text-[#a2b0a7] focus:border-primary focus:ring-2 focus:ring-primary/10"
      />
    </div>
  );
}

function AuthPage({ mode }: { mode: 'login' | 'signup' | 'forgot' }) {
  const { user, ready, refresh } = useAuth();
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (ready && user) navigate('/dashboard');
  }, [ready, user, navigate]);

  const signup = mode === 'signup';
  const forgot = mode === 'forgot';

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isSupabaseConfigured) {
      setNotice({
        type: 'error',
        text: 'Supabase credentials are not configured. Check your environment variables.',
      });
      return;
    }
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    setBusy(true);
    setNotice(null);

    let error: any = null;

    if (forgot) {
      const r = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      error = r.error;
      if (!error) {
        setNotice({
          type: 'success',
          text: 'If an account exists for that email, a password recovery link has been sent.',
        });
      }
    } else if (signup) {
      const full_name = String(form.get('full_name') || '').trim();
      const r = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      error = r.error;
      if (!error) {
        if (r.data.session) {
          await recordAudit(r.data.user?.id, 'login', 'User signed up & logged in');
          setNotice({ type: 'success', text: 'Your account is ready.' });
          await refresh();
          navigate('/dashboard');
        } else {
          setNotice({
            type: 'success',
            text: 'Account created! Please check your email to confirm, or if auto-confirm is enabled, you can log in now.',
          });
        }
      }
    } else {
      const r = await supabase.auth.signInWithPassword({ email, password });
      error = r.error;
      if (!error) {
        await recordAudit(r.data.user?.id, 'login', 'User logged in');
        await refresh();
        navigate('/dashboard');
      }
    }

    if (error) {
      const msg = error.message || 'An error occurred';
      if (msg.includes('rate limit')) {
        setNotice({
          type: 'error',
          text: 'Supabase email send rate limit exceeded. Please enable "Auto Confirm Email" in your Supabase Authentication settings or wait an hour.',
        });
      } else {
        setNotice({ type: 'error', text: msg });
      }
    }
    setBusy(false);
  }

  const title = signup
    ? 'Create your account'
    : forgot
    ? 'Reset your password'
    : 'Welcome back';

  return (
    <AuthLayout
      title={title}
      kicker={
        signup
          ? 'A private space, just for you'
          : forgot
          ? 'Account recovery'
          : 'Your health, in view'
      }
    >
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {signup
          ? 'Start organizing your health history in one secure place.'
          : forgot
          ? 'Enter your account email to receive a password recovery link.'
          : 'Sign in to access your private medical records.'}
      </p>
      <div className="mt-6">
        <Notice notice={notice} dismiss={() => setNotice(null)} />
      </div>
      <form onSubmit={submit} className="mt-5 space-y-4" data-testid={`form-${mode}`}>
        {signup && (
          <Field
            label="Full name"
            name="full_name"
            autoComplete="name"
            placeholder="Alex Morgan"
            required
          />
        )}
        <Field
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="alex.morgan@example.com"
          required
        />
        {!forgot && (
          <div>
            <div className="mb-1.5 flex justify-between">
              <label className="text-xs font-semibold text-[#49655b]" htmlFor="password">
                Password
              </label>
              {mode === 'login' && (
                <Link
                  href="/forgot-password"
                  className="text-xs font-semibold text-primary hover:underline"
                  data-testid="link-forgot-password"
                >
                  Forgot password?
                </Link>
              )}
            </div>
            <div className="relative">
              <input
                id="password"
                name="password"
                data-testid="input-password"
                type={show ? 'text' : 'password'}
                autoComplete={signup ? 'new-password' : 'current-password'}
                minLength={8}
                required
                placeholder="At least 8 characters"
                className="w-full rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 pr-11 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Hide password' : 'Show password'}
                data-testid="button-toggle-password"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}
        <button
          disabled={busy}
          className="mv-button flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          data-testid="button-submit-auth"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
          {busy
            ? 'Please wait'
            : forgot
            ? 'Send recovery link'
            : signup
            ? 'Create account'
            : 'Sign in'}
          {!busy && <ArrowRight className="h-4 w-4" />}
        </button>
      </form>
      <p className="mt-7 text-center text-sm text-muted-foreground">
        {signup
          ? 'Already have an account?'
          : forgot
          ? 'Remembered your password?'
          : 'New to MediVault?'}{' '}
        <Link
          href={signup || forgot ? '/login' : '/signup'}
          className="font-semibold text-primary hover:underline"
          data-testid="link-auth-switch"
        >
          {signup || forgot ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </AuthLayout>
  );
}

function Callback() {
  const { refresh } = useAuth();
  const [, navigate] = useLocation();
  const [msg, setMsg] = useState('Verifying your session…');

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (!active) return;
      if (error || !data.session) {
        setMsg('This verification link may have expired. Please sign in again.');
        return;
      }
      await refresh();
      if (active) navigate('/dashboard');
    });
    return () => {
      active = false;
    };
  }, [navigate, refresh]);

  return (
    <div className="grid min-h-[100dvh] place-items-center px-5 bg-[#f9faf5]">
      <div className="mv-card max-w-md p-8 text-center">
        <Brand />
        <div className="mx-auto mt-8 grid h-12 w-12 place-items-center rounded-full bg-[#e8f0e7] text-primary">
          <LoaderCircle className="h-5 w-5 animate-spin" />
        </div>
        <h1 className="mv-title mt-5 text-2xl font-semibold">Secure sign-in</h1>
        <p className="mt-2 text-sm text-muted-foreground" data-testid="status-auth-callback">
          {msg}
        </p>
        <Link href="/login" className="mt-5 inline-block text-sm font-semibold text-primary">
          Return to sign in
        </Link>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// DASHBOARD
// -----------------------------------------------------------------------------
function Dashboard() {
  const { user } = useAuth();
  const docs = useRows<Doc>('medical_documents');
  const appts = useRows<Appt>('appointments', 'appointment_date', true);

  const upcoming = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return appts.rows
      .filter((a) => a.appointment_date >= today)
      .slice(0, 3);
  }, [appts.rows]);

  const errors = docs.error || appts.error;

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Your private health space"
        title={`Good to see you${
          user?.user_metadata?.full_name
            ? `, ${user.user_metadata.full_name.split(' ')[0]}`
            : ''
        }.`}
        subtitle="A clear view of your records, appointments, and care history."
        action={
          <Link
            href="/records/upload"
            className="mv-button inline-flex items-center gap-2 self-start rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm"
            data-testid="link-upload-document"
          >
            <Plus className="h-4 w-4" />
            Add a record
          </Link>
        }
      />

      {errors && (
        <DataAlert
          error={errors}
          retry={() => {
            docs.refresh();
            appts.refresh();
          }}
        />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat
          icon={FileText}
          label="Total Records"
          value={docs.loading ? '—' : String(docs.rows.length)}
          sub="Documents in your vault"
        />
        <Stat
          icon={CalendarDays}
          label="Upcoming Appointments"
          value={appts.loading ? '—' : String(upcoming.length)}
          sub="Scheduled care visits"
        />
        <Stat
          icon={ShieldCheck}
          label="Security Status"
          value="Protected"
          sub="Private RLS encryption"
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
        {/* Recent Records */}
        <section className="mv-card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-primary">Your records</p>
              <h2 className="mv-title mt-1 text-2xl font-semibold">Recently added</h2>
            </div>
            <Link
              href="/records"
              className="text-xs font-semibold text-primary hover:underline"
              data-testid="link-all-records"
            >
              View all ({docs.rows.length})
            </Link>
          </div>

          {docs.loading ? (
            <SkeletonRows />
          ) : docs.rows.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                icon={FileText}
                title="No records added yet"
                body="Add your medical documents, lab reports, or prescriptions to begin."
                action={
                  <Link
                    href="/records/upload"
                    className="mv-button inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"
                    data-testid="link-empty-upload"
                  >
                    <Upload className="h-4 w-4" />
                    Upload your first record
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="mt-5 divide-y divide-[#e8eee7]">
              {docs.rows.slice(0, 4).map((d) => (
                <div key={d.id} className="flex items-center gap-3 py-3.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3eb] text-primary">
                    <FileText className="h-5 w-5" />
                  </span>
                  <Link
                    href={`/records/${d.id}`}
                    className="min-w-0 flex-1 hover:opacity-80 transition"
                  >
                    <p className="truncate text-sm font-semibold">{d.title || d.file_name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {d.category || 'Record'} ·{' '}
                      {d.document_date
                        ? new Date(d.document_date + 'T12:00:00').toLocaleDateString()
                        : new Date(d.created_at).toLocaleDateString()}
                    </p>
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Upcoming Appointments */}
        <section className="mv-card p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-primary">Schedule</p>
              <h2 className="mv-title mt-1 text-2xl font-semibold">Appointments</h2>
            </div>
            <Link
              href="/appointments"
              className="text-xs font-semibold text-primary hover:underline"
              data-testid="link-all-appointments"
            >
              Calendar
            </Link>
          </div>

          {appts.loading ? (
            <SkeletonRows />
          ) : upcoming.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                icon={CalendarDays}
                title="No upcoming visits"
                body="Keep track of your scheduled consultations and checkups."
                action={
                  <Link
                    href="/appointments"
                    className="text-xs font-semibold text-primary hover:underline"
                    data-testid="link-add-appointment"
                  >
                    Add an appointment
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              {upcoming.map((a) => (
                <div
                  key={a.id}
                  className="flex gap-3.5 rounded-xl bg-[#f3f6f0] p-3.5 border border-[#e1e9df]"
                  data-testid={`card-appointment-${a.id}`}
                >
                  <div className="min-w-12 rounded-lg bg-white px-2 py-2 text-center border border-[#d8e2d8]">
                    <div className="text-[9px] font-bold uppercase text-primary">
                      {new Date(a.appointment_date + 'T12:00:00').toLocaleDateString(undefined, {
                        month: 'short',
                      })}
                    </div>
                    <div className="text-lg font-bold">
                      {new Date(a.appointment_date + 'T12:00:00').getDate()}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{a.doctor_name || 'Appointment'}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {a.hospital_name || 'Clinic/Hospital'} {a.appointment_time ? `· ${a.appointment_time}` : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="mt-8 rounded-2xl bg-[#eaf1e8] p-5 sm:flex sm:items-center sm:justify-between sm:px-7">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-primary">
            <LockKeyhole className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">Your records are private by default</p>
            <p className="mt-1 text-xs leading-5 text-[#657b70]">
              Create a secure, temporary share link whenever you need to share with a provider.
            </p>
          </div>
        </div>
        <Link
          href="/sharing"
          className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary sm:mt-0 hover:underline"
          data-testid="link-dashboard-sharing"
        >
          Manage secure shares <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}

// -----------------------------------------------------------------------------
// MEDICAL RECORDS & UPLOAD
// -----------------------------------------------------------------------------
function RecordRow({
  doc,
  onDelete,
}: {
  doc: Doc;
  onDelete?: (id: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-3 py-3.5 hover:bg-black/[0.01] transition"
      data-testid={`row-record-${doc.id}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf3eb] text-primary">
        <FileText className="h-5 w-5" />
      </span>
      <Link
        href={`/records/${doc.id}`}
        className="min-w-0 flex-1"
        data-testid={`link-record-${doc.id}`}
      >
        <p className="truncate text-sm font-semibold">{doc.title || doc.file_name}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {doc.category || 'Record'} ·{' '}
          {doc.document_date
            ? new Date(doc.document_date + 'T12:00:00').toLocaleDateString()
            : new Date(doc.created_at).toLocaleDateString()}{' '}
          · {(doc.file_size / 1024 / 1024).toFixed(2)} MB
        </p>
      </Link>
      {onDelete && (
        <button
          onClick={() => onDelete(doc.id)}
          aria-label={`Delete ${doc.title}`}
          className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-700 transition"
          data-testid={`button-delete-record-${doc.id}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function Records() {
  const { user } = useAuth();
  const { rows, loading, error, refresh } = useRows<Doc>('medical_documents');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [notice, setNotice] = useState<Notice>(null);

  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter(Boolean) as string[])),
    [rows]
  );

  const filtered = rows.filter(
    (d) =>
      (d.title + ' ' + d.file_name + ' ' + (d.doctor_name || '') + ' ' + (d.hospital_name || ''))
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (category === 'all' || d.category === category)
  );

  const remove = async (id: string) => {
    if (!window.confirm('Delete this record and its stored file? This cannot be undone.'))
      return;
    const doc = rows.find((x) => x.id === id);
    if (!doc) return;

    // Remove from Supabase Storage
    const { error: storageError } = await supabase.storage
      .from('medical-records')
      .remove([doc.storage_path]);
    if (storageError) {
      setNotice({
        type: 'error',
        text: `The file could not be removed from storage: ${storageError.message}`,
      });
      return;
    }

    // Remove metadata from medical_documents
    const { error: dbError } = await supabase.from('medical_documents').delete().eq('id', id);
    if (dbError) {
      setNotice({ type: 'error', text: dbError.message });
    } else {
      await recordAudit(user?.id, 'document_deleted', 'Medical record deleted', {
        document_id: id,
      });
      setNotice({ type: 'success', text: 'Record deleted.' });
      refresh();
    }
  };

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Your library"
        title="Medical Records"
        subtitle="Documents and diagnostic reports stored in your private vault."
        action={
          <Link
            href="/records/upload"
            className="mv-button inline-flex items-center gap-2 self-start rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm"
            data-testid="link-add-record"
          >
            <Plus className="h-4 w-4" />
            Add a record
          </Link>
        }
      />

      <Notice notice={notice} dismiss={() => setNotice(null)} />

      {error ? (
        <DataAlert error={error} retry={refresh} />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search records by title, doctor, or clinic…"
                className="w-full rounded-xl border border-[#dce5dc] bg-[#fffefa] py-3 pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition"
                data-testid="input-search-records"
              />
            </div>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-xl border border-[#dce5dc] bg-[#fffefa] px-4 py-3 text-sm text-[#526c61] outline-none focus:border-primary transition"
              data-testid="select-record-category"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option value={c} key={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {loading ? (
            <div className="mv-card p-6">
              <SkeletonRows />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No records in your vault"
              body="Your uploaded medical documents will appear here."
              action={
                <Link
                  href="/records/upload"
                  className="mv-button inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"
                  data-testid="link-records-empty-upload"
                >
                  <Upload className="h-4 w-4" />
                  Upload your first record
                </Link>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matching records"
              body="No records matched your search filter."
              action={
                <button
                  onClick={() => {
                    setSearch('');
                    setCategory('all');
                  }}
                  className="text-sm font-semibold text-primary hover:underline"
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </button>
              }
            />
          ) : (
            <div className="mv-card divide-y divide-[#e8eee7] px-4 sm:px-6">
              {filtered.map((doc) => (
                <RecordRow key={doc.id} doc={doc} onDelete={remove} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function UploadPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [drag, setDrag] = useState(false);
  const maxSize = 20 * 1024 * 1024; // 20 MB

  const choose = (f: File | null) => {
    setNotice(null);
    if (!f) {
      setFile(null);
      return;
    }
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowed.includes(f.type) && !/\.(pdf|png|jpg|jpeg)$/i.test(f.name)) {
      setNotice({
        type: 'error',
        text: 'Invalid file format. Please choose a PDF, JPEG, or PNG file.',
      });
      return;
    }
    if (f.size > maxSize) {
      setNotice({
        type: 'error',
        text: 'File exceeds 20 MB limit. Please select a smaller document.',
      });
      return;
    }
    setFile(f);
  };

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !user) return;
    setBusy(true);
    setNotice(null);

    const f = new FormData(e.currentTarget);
    const id = crypto.randomUUID();
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const storagePath = `${user.id}/${id}.${ext}`;

    // 1. Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('medical-records')
      .upload(storagePath, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });

    if (uploadError) {
      setNotice({
        type: 'error',
        text: `Upload to storage failed: ${uploadError.message}. Make sure the 'medical-records' bucket exists.`,
      });
      setBusy(false);
      return;
    }

    // 2. Save metadata to medical_documents
    const payload = {
      id,
      user_id: user.id,
      title: String(f.get('title') || file.name.replace(/\.[^.]+$/, '')),
      category: String(f.get('category') || 'Other'),
      file_name: file.name,
      storage_path: storagePath,
      mime_type: file.type || 'application/octet-stream',
      file_size: file.size,
      document_date: String(f.get('document_date') || '') || null,
      doctor_name: String(f.get('doctor_name') || '') || null,
      hospital_name: String(f.get('hospital_name') || '') || null,
      description: String(f.get('description') || '') || null,
      ai_status: 'not_requested',
    };

    const { error: dbError } = await supabase.from('medical_documents').insert(payload);

    if (dbError) {
      // Clean up orphaned storage file
      await supabase.storage.from('medical-records').remove([storagePath]);
      setNotice({
        type: 'error',
        text: `Database record could not be saved: ${dbError.message}. The uploaded file was removed.`,
      });
      setBusy(false);
      return;
    }

    // 3. Record Audit Log
    await recordAudit(user.id, 'document_uploaded', 'Medical record uploaded', {
      document_id: id,
      title: payload.title,
    });

    setNotice({ type: 'success', text: 'Document successfully saved to your vault!' });
    setBusy(false);
    setTimeout(() => navigate('/records'), 600);
  }

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Add to your history"
        title="Upload Medical Document"
        subtitle="Add a report, lab result, or prescription to your private records."
      />
      <Notice notice={notice} dismiss={() => setNotice(null)} />

      <form
        onSubmit={submit}
        className="grid gap-6 lg:grid-cols-[1fr_340px]"
        data-testid="form-upload-record"
      >
        <section className="mv-card p-5 sm:p-7">
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
            className={`flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-5 text-center transition ${
              drag
                ? 'border-primary bg-[#e9f1e9]'
                : 'border-[#c9d9cc] bg-[#f6f8f3] hover:border-primary/50'
            }`}
          >
            <input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => choose(e.target.files?.[0] || null)}
              className="sr-only"
              data-testid="input-upload-file"
            />
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white text-primary shadow-sm">
              {file ? <CheckCircle2 className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
            </span>
            <p className="mt-4 text-sm font-semibold">
              {file ? file.name : 'Choose a file or drop it here'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, PNG, JPG, JPEG · up to 20 MB</p>
            <span className="mt-4 rounded-xl border border-[#d8e3d9] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#44695d]">
              Browse files
            </span>
          </label>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Field
              label="Document title"
              name="title"
              placeholder={file?.name.replace(/\.[^.]+$/, '') || 'e.g. CBC Blood Test'}
              required
            />
            <div>
              <label
                className="mb-1.5 block text-xs font-semibold text-[#49655b]"
                htmlFor="category"
              >
                Category
              </label>
              <select
                id="category"
                name="category"
                defaultValue="Lab result"
                className="w-full rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 text-sm outline-none focus:border-primary"
                data-testid="select-upload-category"
              >
                {[
                  'Lab result',
                  'Imaging',
                  'Prescription',
                  'Consultation',
                  'Vaccination',
                  'Discharge summary',
                  'Insurance',
                  'Other',
                ].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
            <Field label="Document date" name="document_date" type="date" />
            <Field label="Doctor or provider" name="doctor_name" placeholder="Optional" />
            <Field label="Clinic or hospital" name="hospital_name" placeholder="Optional" />
            <div className="sm:col-span-2">
              <label
                htmlFor="description"
                className="mb-1.5 block text-xs font-semibold text-[#49655b]"
              >
                Notes
              </label>
              <textarea
                id="description"
                name="description"
                rows={3}
                placeholder="Add context or notes (optional)"
                className="w-full resize-y rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 text-sm outline-none focus:border-primary"
                data-testid="input-description"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!file || busy}
            className="mv-button mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto shadow-sm"
            data-testid="button-save-upload"
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {busy ? 'Uploading & saving…' : 'Save medical document'}
          </button>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-[#eaf1e8] p-5 border border-[#d8e4dd]">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="mt-3 text-sm font-semibold">Private Supabase Storage</h3>
            <p className="mt-2 text-xs leading-5 text-[#627a6f]">
              Files are saved in your private Supabase storage bucket under your user ID. They are never public.
            </p>
          </div>
          <div className="mv-card p-5">
            <h3 className="text-sm font-semibold">Upload Guarantees</h3>
            <ul className="mt-3 space-y-2.5 text-xs leading-5 text-muted-foreground">
              <li className="flex gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                Row Level Security strictly enforced
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                Original file integrity preserved
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                No artificial or fabricated summaries
              </li>
            </ul>
          </div>
        </aside>
      </form>
    </div>
  );
}

function RecordDetail({ id }: { id: string }) {
  const { user } = useAuth();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [, navigate] = useLocation();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('medical_documents')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      setError(error.message);
      setDoc(null);
    } else if (!data) {
      setError('Record not found.');
      setDoc(null);
    } else {
      setDoc(data as Doc);
      setError(null);
      // Record view audit
      await recordAudit(user?.id, 'document_viewed', 'Medical record viewed', {
        document_id: id,
      });
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [id]);

  const openFile = async () => {
    if (!doc) return;
    const { data, error } = await supabase.storage
      .from('medical-records')
      .createSignedUrl(doc.storage_path, 120);

    if (error) {
      setNotice({ type: 'error', text: `Could not generate download link: ${error.message}` });
      return;
    }
    if (data?.signedUrl) {
      await recordAudit(user?.id, 'document_downloaded', 'Medical record downloaded', {
        document_id: doc.id,
      });
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const remove = async () => {
    if (!doc || !window.confirm('Delete this record and its file? This cannot be undone.'))
      return;
    await supabase.storage.from('medical-records').remove([doc.storage_path]);
    const { error } = await supabase.from('medical_documents').delete().eq('id', doc.id);
    if (error) {
      setNotice({ type: 'error', text: error.message });
    } else {
      await recordAudit(user?.id, 'document_deleted', 'Medical record deleted', {
        document_id: doc.id,
      });
      navigate('/records');
    }
  };

  if (loading) return <LoadingPage />;
  if (error) {
    return (
      <div>
        <Link
          href="/records"
          className="mb-6 inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> All records
        </Link>
        <DataAlert error={error} retry={load} />
      </div>
    );
  }
  if (!doc) return null;

  return (
    <div className="mv-enter">
      <Link
        href="/records"
        className="mb-6 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
        data-testid="link-back-records"
      >
        <ArrowLeft className="h-4 w-4" /> All records
      </Link>
      <PageHeading
        eyebrow={doc.category || 'Medical record'}
        title={doc.title || doc.file_name}
        subtitle={`Added on ${new Date(doc.created_at).toLocaleDateString()}`}
        action={
          <div className="flex gap-2.5">
            <button
              onClick={openFile}
              className="mv-button inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm"
              data-testid="button-open-record"
            >
              <ArrowDownToLine className="h-4 w-4" /> Download / View file
            </button>
            <button
              onClick={remove}
              className="rounded-xl border border-rose-200 bg-white px-3 py-2.5 text-rose-700 hover:bg-rose-50 transition"
              aria-label="Delete record"
              data-testid="button-delete-record"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        }
      />
      <Notice notice={notice} dismiss={() => setNotice(null)} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="mv-card p-6">
          <h2 className="text-sm font-semibold">Record details</h2>
          <dl className="mt-4 divide-y divide-[#e7ede6]">
            {[
              ['File name', doc.file_name],
              ['Category', doc.category],
              [
                'Document date',
                doc.document_date
                  ? new Date(doc.document_date + 'T12:00:00').toLocaleDateString()
                  : null,
              ],
              ['Provider / Doctor', doc.doctor_name],
              ['Clinic or hospital', doc.hospital_name],
              ['File size', `${(doc.file_size / 1024 / 1024).toFixed(2)} MB`],
              ['Notes', doc.description],
            ]
              .filter((x) => x[1])
              .map(([label, value]) => (
                <div className="flex justify-between gap-4 py-3 text-sm" key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="max-w-[65%] text-right font-medium">{value}</dd>
                </div>
              ))}
          </dl>
        </section>

        <aside className="rounded-2xl bg-[#eaf1e8] p-5 border border-[#d8e4dd]">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="mt-3 font-semibold text-sm">AI Summary</h2>
          <div className="mt-3 rounded-xl border border-[#d7e4d7] bg-white/80 p-3.5">
            <p className="text-xs leading-relaxed text-[#536b60]">
              {doc.ai_summary || 'AI summary unavailable.'}
            </p>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            AI document summarization is non-diagnostic and strictly informational.
          </p>
        </aside>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// MEDICAL TIMELINE
// -----------------------------------------------------------------------------
function Timeline() {
  const docs = useRows<Doc>('medical_documents');
  const appts = useRows<Appt>('appointments', 'appointment_date', false);
  const [year, setYear] = useState('all');

  const events = useMemo(() => {
    const docEvents = docs.rows.map((d) => ({
      id: `d-${d.id}`,
      date: d.document_date || d.created_at.slice(0, 10),
      title: d.title || d.file_name,
      type: d.category || 'Record',
      href: `/records/${d.id}`,
      icon: FileText,
    }));

    const apptEvents = appts.rows.map((a) => ({
      id: `a-${a.id}`,
      date: a.appointment_date,
      title: a.doctor_name || 'Appointment',
      type: 'Appointment',
      href: '/appointments',
      icon: CalendarDays,
    }));

    return [...docEvents, ...apptEvents].sort((a, b) => b.date.localeCompare(a.date));
  }, [docs.rows, appts.rows]);

  const years = useMemo(
    () => Array.from(new Set(events.map((x) => x.date.slice(0, 4)))),
    [events]
  );

  const filtered = year === 'all' ? events : events.filter((x) => x.date.startsWith(year));
  const error = docs.error || appts.error;

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Your care history"
        title="Medical Timeline"
        subtitle="Chronological record of your documents, diagnostic reports, and medical visits."
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

      {error ? (
        <DataAlert
          error={error}
          retry={() => {
            docs.refresh();
            appts.refresh();
          }}
        />
      ) : docs.loading || appts.loading ? (
        <div className="mv-card p-6">
          <SkeletonRows />
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="Your timeline starts here"
          body="Upload records or schedule appointments to build your chronological medical timeline."
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
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No events in this year"
          body="Select another year or choose 'All years' to view entries."
        />
      ) : (
        <div className="mv-card p-5 sm:p-8">
          <div className="relative space-y-5 before:absolute before:bottom-5 before:left-[70px] before:top-5 before:w-px before:bg-[#d6e2d6] sm:before:left-[91px]">
            {filtered.map((event) => (
              <div
                key={event.id}
                className="relative grid grid-cols-[58px_24px_1fr] items-start gap-3 sm:grid-cols-[78px_26px_1fr] sm:gap-4"
                data-testid={`timeline-event-${event.id}`}
              >
                <div className="pt-3 text-right font-mono text-[10px] text-[#788e83]">
                  {new Date(event.date + 'T12:00:00').toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
                <span className="z-10 mt-3 grid h-6 w-6 place-items-center rounded-full border-4 border-[#e5efe4] bg-[#4c8070]">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                </span>
                <Link
                  href={event.href}
                  className="flex items-center gap-3 rounded-xl border border-[#e3ebe2] bg-[#fbfcf8] p-3.5 hover:border-primary/50 transition"
                  data-testid={`link-event-${event.id}`}
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eaf1e8] text-primary">
                    <event.icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{event.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {event.type}
                    </span>
                  </div>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-[#91a49a]" />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// APPOINTMENTS
// -----------------------------------------------------------------------------
function Appointments() {
  const { user } = useAuth();
  const { rows, loading, error, refresh } = useRows<Appt>('appointments', 'appointment_date', true);
  const [dialog, setDialog] = useState(false);
  const [editingAppt, setEditingAppt] = useState<Appt | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'upcoming' | 'past' | 'all'>('upcoming');

  const today = new Date().toISOString().slice(0, 10);
  const shown = rows
    .filter((a) =>
      filter === 'all'
        ? true
        : filter === 'upcoming'
        ? a.appointment_date >= today
        : a.appointment_date < today
    )
    .sort((a, b) =>
      filter === 'past'
        ? b.appointment_date.localeCompare(a.appointment_date)
        : a.appointment_date.localeCompare(b.appointment_date)
    );

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);

    const payload = {
      user_id: user.id,
      doctor_name: String(f.get('doctor_name') || '') || null,
      hospital_name: String(f.get('hospital_name') || '') || null,
      appointment_date: String(f.get('appointment_date')),
      appointment_time: String(f.get('appointment_time') || '') || null,
      reason: String(f.get('reason') || '') || null,
      notes: String(f.get('notes') || '') || null,
      status: 'scheduled',
    };

    let saveError: any = null;

    if (editingAppt) {
      const { error } = await supabase
        .from('appointments')
        .update(payload)
        .eq('id', editingAppt.id);
      saveError = error;
    } else {
      const { error } = await supabase.from('appointments').insert(payload);
      saveError = error;
    }

    setBusy(false);

    if (saveError) {
      setNotice({ type: 'error', text: saveError.message });
    } else {
      await recordAudit(
        user.id,
        editingAppt ? 'appointment_updated' : 'appointment_created',
        editingAppt ? 'Appointment updated' : 'Appointment scheduled'
      );
      setNotice({
        type: 'success',
        text: editingAppt ? 'Appointment updated.' : 'Appointment added to your schedule.',
      });
      setDialog(false);
      setEditingAppt(null);
      refresh();
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this appointment?')) return;
    const { error } = await supabase.from('appointments').delete().eq('id', id);
    if (error) {
      setNotice({ type: 'error', text: error.message });
    } else {
      await recordAudit(user?.id, 'appointment_deleted', 'Appointment deleted');
      setNotice({ type: 'success', text: 'Appointment removed.' });
      refresh();
    }
  }

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Care planning"
        title="Appointments"
        subtitle="Organize upcoming consultations, diagnostic visits, and provider notes."
        action={
          <button
            onClick={() => {
              setEditingAppt(null);
              setDialog(true);
            }}
            className="mv-button inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm"
            data-testid="button-new-appointment"
          >
            <CalendarPlus className="h-4 w-4" />
            Add appointment
          </button>
        }
      />

      <Notice notice={notice} dismiss={() => setNotice(null)} />

      <div className="mb-5 flex gap-2">
        {(
          [
            ['upcoming', 'Upcoming'],
            ['past', 'Past'],
            ['all', 'All'],
          ] as const
        ).map(([v, l]) => (
          <button
            key={v}
            onClick={() => setFilter(v)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              filter === v
                ? 'bg-[#dce9df] text-primary'
                : 'bg-white text-[#73877d] hover:bg-white/80 border border-[#e1e9df]'
            }`}
            data-testid={`button-appointment-filter-${v}`}
          >
            {l}
          </button>
        ))}
      </div>

      {error ? (
        <DataAlert error={error} retry={refresh} />
      ) : loading ? (
        <div className="mv-card p-6">
          <SkeletonRows />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={filter === 'past' ? 'No past appointments' : 'No upcoming appointments'}
          body="Keep visit reminders and doctor consultations together with your medical files."
          action={
            <button
              onClick={() => {
                setEditingAppt(null);
                setDialog(true);
              }}
              className="mv-button inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground"
              data-testid="button-empty-add-appointment"
            >
              <CalendarPlus className="h-4 w-4" /> Schedule an appointment
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {shown.map((a) => (
            <div
              key={a.id}
              className="mv-card flex items-center gap-4 p-4 sm:p-5"
              data-testid={`row-appointment-${a.id}`}
            >
              <div className="min-w-[58px] rounded-xl bg-[#edf3eb] px-2 py-2 text-center border border-[#d8e2d8]">
                <div className="text-[10px] font-bold uppercase text-primary">
                  {new Date(a.appointment_date + 'T12:00:00').toLocaleDateString(undefined, {
                    month: 'short',
                  })}
                </div>
                <div className="text-xl font-bold">
                  {new Date(a.appointment_date + 'T12:00:00').getDate()}
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {new Date(a.appointment_date + 'T12:00:00').getFullYear()}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{a.doctor_name || 'Appointment'}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[a.hospital_name, a.appointment_time].filter(Boolean).join(' · ') ||
                    'No location or time added'}
                </p>
                {a.reason && <p className="mt-1 truncate text-xs text-[#72857b]">{a.reason}</p>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setEditingAppt(a);
                    setDialog(true);
                  }}
                  aria-label="Edit appointment"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-[#edf3eb] hover:text-primary transition"
                  data-testid={`button-edit-appointment-${a.id}`}
                >
                  <Edit3 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => remove(a.id)}
                  aria-label="Delete appointment"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-rose-50 hover:text-rose-700 transition"
                  data-testid={`button-delete-appointment-${a.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <Modal
          title={editingAppt ? 'Edit appointment' : 'Add an appointment'}
          close={() => {
            setDialog(false);
            setEditingAppt(null);
          }}
        >
          <form onSubmit={save} className="space-y-4" data-testid="form-appointment">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Provider or Doctor"
                name="doctor_name"
                placeholder="e.g. Dr. Sarah Jenkins"
                defaultValue={editingAppt?.doctor_name || ''}
              />
              <Field
                label="Clinic or Hospital"
                name="hospital_name"
                placeholder="e.g. Metro Health Center"
                defaultValue={editingAppt?.hospital_name || ''}
              />
              <Field
                label="Date"
                name="appointment_date"
                type="date"
                required
                defaultValue={editingAppt?.appointment_date || today}
              />
              <Field
                label="Time"
                name="appointment_time"
                type="time"
                defaultValue={editingAppt?.appointment_time || ''}
              />
            </div>
            <Field
              label="Reason or visit type"
              name="reason"
              placeholder="e.g. Annual physical checkup"
              defaultValue={editingAppt?.reason || ''}
            />
            <div>
              <label
                className="mb-1.5 block text-xs font-semibold text-[#49655b]"
                htmlFor="appointment-notes"
              >
                Notes
              </label>
              <textarea
                id="appointment-notes"
                name="notes"
                rows={3}
                defaultValue={editingAppt?.notes || ''}
                className="w-full rounded-xl border border-[#d9e3da] bg-white px-3.5 py-3 text-sm outline-none focus:border-primary"
                data-testid="input-appointment-notes"
              />
            </div>
            <button
              disabled={busy}
              className="mv-button flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              data-testid="button-save-appointment"
            >
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {editingAppt ? 'Update appointment' : 'Save appointment'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#1d3933]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
      onClick={close}
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-[24px] bg-[#fbfcf8] p-5 shadow-2xl sm:rounded-[24px] sm:p-7"
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
// SECURE SHARING
// -----------------------------------------------------------------------------
function Sharing() {
  const { user } = useAuth();
  const docs = useRows<Doc>('medical_documents');
  const shares = useRows<ShareItem>('shares');
  const [notice, setNotice] = useState<Notice>(null);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [recipient, setRecipient] = useState('');
  const [permission, setPermission] = useState<'VIEW' | 'VIEW_DOWNLOAD'>('VIEW');
  const [expiryHours, setExpiryHours] = useState('24');
  const [busy, setBusy] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');

  const toggleSelect = (id: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (selectedDocIds.length === 0) {
      setNotice({ type: 'error', text: 'Please select at least one medical document to share.' });
      return;
    }
    setBusy(true);
    setNotice(null);

    try {
      const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const hash = await hashToken(rawToken);

      const hours = parseInt(expiryHours, 10) || 24;
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

      // 1. Insert into shares table
      const { data: shareData, error: shareError } = await supabase
        .from('shares')
        .insert({
          user_id: user.id,
          recipient: recipient.trim() || 'Provider',
          permission,
          token_hash: hash,
          expires_at: expiresAt,
          max_views: 20,
          view_count: 0,
        })
        .select()
        .single();

      if (shareError) throw shareError;

      // 2. Insert into shared_documents table
      const shareId = shareData.id;
      const docInserts = selectedDocIds.map((docId) => ({
        share_id: shareId,
        document_id: docId,
      }));

      const { error: linkDocsError } = await supabase
        .from('shared_documents')
        .insert(docInserts);

      if (linkDocsError) throw linkDocsError;

      // 3. Build public link
      const url = `${window.location.origin}/share/${rawToken}`;
      setGeneratedLink(url);
      setNotice({
        type: 'success',
        text: 'Secure sharing link generated! Copy and provide it to the recipient.',
      });

      // 4. Audit Log
      await recordAudit(user.id, 'share_created', 'Secure share link created', {
        share_id: shareId,
        recipient,
        permission,
        document_count: selectedDocIds.length,
      });

      shares.refresh();
      setSelectedDocIds([]);
      setRecipient('');
    } catch (err: any) {
      setNotice({ type: 'error', text: err?.message || 'Could not create secure share link.' });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (shareId: string) => {
    if (!window.confirm('Revoke this secure share? The recipient will immediately lose access.'))
      return;
    const { error } = await supabase
      .from('shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', shareId);

    if (error) {
      setNotice({ type: 'error', text: error.message });
    } else {
      await recordAudit(user?.id, 'share_revoked', 'Secure share link revoked', {
        share_id: shareId,
      });
      setNotice({ type: 'success', text: 'Share link has been revoked.' });
      shares.refresh();
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(generatedLink);
      setNotice({ type: 'success', text: 'Share link copied to clipboard!' });
    } catch {
      setNotice({
        type: 'error',
        text: 'Could not access clipboard automatically. Please copy the link manually.',
      });
    }
  };

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="You decide what to share"
        title="Secure Sharing"
        subtitle="Create temporary, revocable access to selected records with time expiration and view-level controls."
      />

      <Notice notice={notice} dismiss={() => setNotice(null)} />

      <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* Share Creation Form */}
        <section className="mv-card p-5 sm:p-6">
          <div className="flex gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e9f1e8] text-primary">
              <Share2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Generate Secure Link</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Time-limited and revocable at any moment.
              </p>
            </div>
          </div>

          <form onSubmit={create} className="mt-5 space-y-4" data-testid="form-create-share">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[#49655b]">
                1. Select records to share
              </label>
              {docs.loading ? (
                <SkeletonRows />
              ) : docs.rows.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  No records available. Please upload records first.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-xl border border-[#d9e3da] bg-white p-2">
                  {docs.rows.map((d) => {
                    const checked = selectedDocIds.includes(d.id);
                    return (
                      <label
                        key={d.id}
                        className={`flex items-center gap-2.5 rounded-lg p-2 text-xs cursor-pointer transition ${
                          checked ? 'bg-[#eaf1e8] text-[#245c4f]' : 'hover:bg-muted/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(d.id)}
                          className="accent-[#47796b]"
                        />
                        <span className="font-medium truncate flex-1">{d.title || d.file_name}</span>
                        <span className="text-[10px] text-muted-foreground">{d.category}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <Field
              label="2. Recipient name or clinic"
              name="recipient"
              placeholder="e.g. Dr. Wilson / City Health Lab"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              required
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[#49655b]">
                  3. Access Permission
                </label>
                <select
                  value={permission}
                  onChange={(e) => setPermission(e.target.value as any)}
                  className="w-full rounded-xl border border-[#d9e3da] bg-white px-3.5 py-3 text-sm outline-none focus:border-primary"
                  data-testid="select-share-permission"
                >
                  <option value="VIEW">VIEW Only</option>
                  <option value="VIEW_DOWNLOAD">VIEW & DOWNLOAD</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[#49655b]">
                  4. Link Expiration
                </label>
                <select
                  value={expiryHours}
                  onChange={(e) => setExpiryHours(e.target.value)}
                  className="w-full rounded-xl border border-[#d9e3da] bg-white px-3.5 py-3 text-sm outline-none focus:border-primary"
                  data-testid="select-share-expiration"
                >
                  <option value="1">1 hour</option>
                  <option value="6">6 hours</option>
                  <option value="24">24 hours</option>
                  <option value="72">3 days</option>
                  <option value="168">7 days</option>
                </select>
              </div>
            </div>

            {generatedLink && (
              <div className="rounded-xl border border-[#d5e2d4] bg-[#f2f6ef] p-3.5">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[#60786e]">
                  Active Share Link
                </p>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={generatedLink}
                    className="min-w-0 flex-1 rounded-lg border border-[#dce6db] bg-white px-2.5 py-2 text-xs"
                    data-testid="input-generated-share-link"
                  />
                  <button
                    type="button"
                    onClick={copy}
                    className="rounded-lg bg-primary px-3 text-white hover:brightness-95"
                    data-testid="button-copy-share-link"
                  >
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <button
              disabled={selectedDocIds.length === 0 || busy}
              className="mv-button flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 shadow-sm"
              data-testid="button-create-share"
            >
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Generate secure share
            </button>
          </form>
        </section>

        {/* Existing Shares List */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="mv-title text-2xl font-semibold">Existing Shares</h2>
            <span className="text-xs text-muted-foreground">{shares.rows.length} total</span>
          </div>

          {shares.error ? (
            <DataAlert error={shares.error} retry={shares.refresh} />
          ) : shares.loading ? (
            <div className="mv-card p-5">
              <SkeletonRows />
            </div>
          ) : shares.rows.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="No shares generated"
              body="When you create secure links for healthcare providers, they will appear here."
            />
          ) : (
            <div className="space-y-3">
              {shares.rows.map((sh) => {
                const isExpired = new Date(sh.expires_at) <= new Date();
                const isRevoked = Boolean(sh.revoked_at);
                const inactive = isExpired || isRevoked;

                return (
                  <div
                    key={sh.id}
                    className="mv-card p-4 transition"
                    data-testid={`row-share-${sh.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`mt-0.5 grid h-9 w-9 place-items-center rounded-xl ${
                          inactive ? 'bg-[#f0efeb] text-[#859087]' : 'bg-[#e8f1e8] text-primary'
                        }`}
                      >
                        <Link2 className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">
                          Recipient: {sh.recipient || 'Shared link'}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {isRevoked
                            ? 'Revoked'
                            : isExpired
                            ? 'Expired'
                            : `Expires ${new Date(sh.expires_at).toLocaleString()}`}{' '}
                          · Permission: {sh.permission}
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                          inactive
                            ? 'bg-[#f0efeb] text-[#748078]'
                            : 'bg-[#e5f1e6] text-[#477461]'
                        }`}
                      >
                        {isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                      </span>
                    </div>

                    {!inactive && (
                      <div className="mt-3 flex items-center justify-between border-t border-[#edf1eb] pt-2.5">
                        <span className="text-[11px] text-muted-foreground">
                          Opens: {sh.view_count || 0} / {sh.max_views || '∞'}
                        </span>
                        <button
                          onClick={() => revoke(sh.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 hover:underline"
                          data-testid={`button-revoke-share-${sh.id}`}
                        >
                          <Ban className="h-3.5 w-3.5" /> Revoke access
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// PUBLIC SHARE VIEWER (/share/:token)
// -----------------------------------------------------------------------------
function SharePublic({ token }: { token: string }) {
  type PublicShareRecord = {
    share_id: string;
    permission: 'VIEW' | 'VIEW_DOWNLOAD';
    recipient: string;
    expires_at: string;
    document_id: string;
    title: string;
    category: string;
    file_name: string;
    mime_type: string;
    file_size: number;
    storage_path: string;
    document_date: string | null;
    description: string | null;
  };

  const [state, setState] = useState<'checking' | 'valid' | 'invalid' | 'error'>('checking');
  const [items, setItems] = useState<PublicShareRecord[]>([]);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});
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
        const { data, error } = await supabase.rpc('get_medical_share', {
          p_token_hash: hash,
        });

        if (error) throw error;
        const records = (data || []) as PublicShareRecord[];

        if (!records || records.length === 0) {
          if (live) {
            setState('invalid');
            setMessage('This secure share link is invalid, expired, or has been revoked.');
          }
          return;
        }

        if (live) {
          setItems(records);
          setState('valid');

          // Generate signed URLs if permission allows VIEW_DOWNLOAD or viewing
          const urls: Record<string, string> = {};
          for (const item of records) {
            const { data: signed } = await supabase.storage
              .from('medical-records')
              .createSignedUrl(item.storage_path, 300);
            if (signed?.signedUrl) {
              urls[item.document_id] = signed.signedUrl;
            }
          }
          setDownloadUrls(urls);
        }
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
          ) : state === 'valid' && items.length > 0 ? (
            <div className="mv-enter">
              <div className="mb-5 flex items-center gap-2 rounded-xl border border-[#cfe1d1] bg-[#eaf3e9] px-4 py-3 text-xs text-[#426e57]">
                <ShieldCheck className="h-4 w-4" />
                Valid temporary medical share. Only the selected documents are accessible.
              </div>

              <section className="mv-card p-6 sm:p-8">
                <p className="text-xs font-bold uppercase tracking-wider text-primary">
                  Shared for: {items[0].recipient}
                </p>
                <h1 className="mv-title mt-2 text-3xl font-semibold">Shared Medical Records</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Expires {new Date(items[0].expires_at).toLocaleString()} · Access level:{' '}
                  {items[0].permission}
                </p>

                <div className="mt-6 divide-y divide-[#e8eee7]">
                  {items.map((doc) => (
                    <div key={doc.document_id} className="py-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className="text-[10px] font-bold uppercase text-primary">
                            {doc.category || 'Record'}
                          </span>
                          <h3 className="text-lg font-semibold">{doc.title || doc.file_name}</h3>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Date:{' '}
                            {doc.document_date
                              ? new Date(doc.document_date + 'T12:00:00').toLocaleDateString()
                              : 'Not specified'}
                          </p>
                          {doc.description && (
                            <p className="mt-2 text-xs leading-relaxed text-[#586f64] bg-[#f2f5ef] p-3 rounded-lg">
                              {doc.description}
                            </p>
                          )}
                        </div>
                        {downloadUrls[doc.document_id] && (
                          <a
                            href={downloadUrls[doc.document_id]}
                            target="_blank"
                            rel="noreferrer"
                            className="mv-button shrink-0 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm"
                            data-testid="link-open-shared-file"
                          >
                            <ArrowDownToLine className="h-4 w-4" />
                            {items[0].permission === 'VIEW_DOWNLOAD' ? 'Download' : 'View'}
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
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
              <Link
                href="/"
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
                data-testid="link-share-home"
              >
                Go to MediVault <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// SECURITY ACTIVITY / AUDIT LOGS
// -----------------------------------------------------------------------------
function ActivityPage() {
  const { rows, loading, error, refresh } = useRows<AuditLog>('audit_logs', 'created_at', false);

  const iconFor = (action: string) => {
    if (action.includes('share')) return <Share2 className="h-4 w-4" />;
    if (action.includes('upload') || action.includes('document'))
      return <FileText className="h-4 w-4" />;
    if (action.includes('login') || action.includes('logout'))
      return <KeyRound className="h-4 w-4" />;
    if (action.includes('appointment')) return <CalendarDays className="h-4 w-4" />;
    return <Activity className="h-4 w-4" />;
  };

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Account transparency"
        title="Security Activity"
        subtitle="Immutable audit log of all account sessions, uploads, views, and sharing actions."
      />

      <div className="mb-5 flex gap-3 rounded-xl bg-[#eaf1e8] p-4 text-xs leading-5 text-[#627a6f] border border-[#d8e4dd]">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        Audit logs contain event timestamps and security metadata only. Protected health information is never logged.
      </div>

      {error ? (
        <DataAlert error={error} retry={refresh} />
      ) : loading ? (
        <div className="mv-card p-6">
          <SkeletonRows />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No activity recorded"
          body="Your security events (logins, uploads, shares, revocations) will appear here."
        />
      ) : (
        <div className="mv-card divide-y divide-[#e8eee7] px-5 sm:px-7">
          {rows.map((item) => (
            <div
              key={item.id}
              className="flex gap-3.5 py-4 items-start"
              data-testid={`row-activity-${item.id}`}
            >
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#edf3eb] text-primary">
                {iconFor(item.action || item.event_type || '')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{item.title || 'Security event'}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()} · Action: {item.action}
                </p>
                {item.metadata && (
                  <p className="mt-1 break-words text-xs text-[#74877e] font-mono bg-[#f4f7f2] p-2 rounded-lg">
                    {typeof item.metadata === 'string'
                      ? item.metadata
                      : JSON.stringify(item.metadata)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// PROFILE & SETTINGS
// -----------------------------------------------------------------------------
function Profile() {
  const { user } = useAuth();
  const [name, setName] = useState(String(user?.user_metadata?.full_name || ''));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    setName(String(user?.user_metadata?.full_name || ''));
  }, [user?.id, user?.user_metadata?.full_name]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setNotice(null);

    const { error: authError } = await supabase.auth.updateUser({
      data: { full_name: name.trim() },
    });

    if (authError) {
      setBusy(false);
      setNotice({ type: 'error', text: authError.message });
      return;
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert(
        { id: user.id, full_name: name.trim(), email: user.email || '' },
        { onConflict: 'id' }
      );

    setBusy(false);
    if (profileError) {
      setNotice({
        type: 'error',
        text: 'Auth metadata updated, but profile table update failed: ' + profileError.message,
      });
    } else {
      await recordAudit(user.id, 'profile_updated', 'Profile updated');
      setNotice({ type: 'success', text: 'Your profile has been updated.' });
    }
  }

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Your account"
        title="Profile"
        subtitle="Manage personal information associated with your MediVault account."
      />
      <Notice notice={notice} dismiss={() => setNotice(null)} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <form onSubmit={save} className="mv-card p-5 sm:p-7" data-testid="form-profile">
          <h2 className="text-sm font-semibold">Personal details</h2>
          <div className="mt-5 space-y-4">
            <div>
              <label
                htmlFor="profile-name"
                className="mb-1.5 block text-xs font-semibold text-[#49655b]"
              >
                Full name
              </label>
              <input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 text-sm outline-none focus:border-primary"
                data-testid="input-profile-name"
              />
            </div>
            <div>
              <label
                htmlFor="profile-email"
                className="mb-1.5 block text-xs font-semibold text-[#49655b]"
              >
                Email address
              </label>
              <input
                id="profile-email"
                value={user?.email || ''}
                readOnly
                className="w-full rounded-xl border border-[#e1e7df] bg-[#f3f6f0] px-3.5 py-3 text-sm text-muted-foreground"
                data-testid="input-profile-email"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Email is managed through your authentication provider.
              </p>
            </div>
          </div>
          <button
            disabled={busy}
            className="mv-button mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 shadow-sm"
            data-testid="button-save-profile"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Save changes
          </button>
        </form>

        <aside className="rounded-2xl bg-[#eaf1e8] p-5 border border-[#d8e4dd]">
          <UserRound className="h-5 w-5 text-primary" />
          <h3 className="mt-3 text-sm font-semibold">Account Identity</h3>
          <p className="mt-2 text-xs leading-5 text-[#627a6f]">
            Your sign-in identity ensures only you can access your encrypted health vault and records.
          </p>
        </aside>
      </div>
    </div>
  );
}

function SettingsPage() {
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get('new_password') || '');
    if (password.length < 8) {
      setNotice({ type: 'error', text: 'Password must be at least 8 characters long.' });
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setNotice({ type: 'error', text: error.message });
    } else {
      setNotice({ type: 'success', text: 'Your password has been securely updated.' });
      e.currentTarget.reset();
    }
  }

  return (
    <div className="mv-enter">
      <PageHeading
        eyebrow="Account controls"
        title="Settings"
        subtitle="Security options for your MediVault authentication."
      />
      <Notice notice={notice} dismiss={() => setNotice(null)} />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="mv-card p-5 sm:p-7">
          <div className="flex gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#e9f1e8] text-primary">
              <KeyRound className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Change password</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Set a strong password to protect your private health data.
              </p>
            </div>
          </div>
          <form
            onSubmit={changePassword}
            className="mt-5 max-w-md space-y-4"
            data-testid="form-change-password"
          >
            <div>
              <label
                htmlFor="new-password"
                className="mb-1.5 block text-xs font-semibold text-[#49655b]"
              >
                New password
              </label>
              <div className="relative">
                <input
                  id="new-password"
                  type={show ? 'text' : 'password'}
                  name="new_password"
                  minLength={8}
                  required
                  className="w-full rounded-xl border border-[#d9e3da] bg-[#fffefa] px-3.5 py-3 pr-11 text-sm outline-none focus:border-primary"
                  data-testid="input-new-password"
                />
                <button
                  type="button"
                  onClick={() => setShow(!show)}
                  aria-label="Toggle password visibility"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  data-testid="button-toggle-new-password"
                >
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <button
              disabled={busy}
              className="mv-button inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50 shadow-sm"
              data-testid="button-update-password"
            >
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Update password
            </button>
          </form>
        </section>

        <aside className="space-y-4">
          <div className="rounded-2xl bg-[#eaf1e8] p-5 border border-[#d8e4dd]">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <h3 className="mt-3 text-sm font-semibold">Row Level Security</h3>
            <p className="mt-2 text-xs leading-5 text-[#627a6f]">
              Access to medical records is restricted strictly to authenticated session owners.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// ROUTER SETUP
// -----------------------------------------------------------------------------
function AppRoutes() {
  const [location] = useLocation();

  return (
    <ErrorBoundary resetKey={location}>
      <Switch>
        {/* Public Routes */}
        <Route path="/" component={Landing} />
        <Route path="/login">
          <AuthPage mode="login" />
        </Route>
        <Route path="/signup">
          <AuthPage mode="signup" />
        </Route>
        <Route path="/forgot-password">
          <AuthPage mode="forgot" />
        </Route>
        <Route path="/auth/callback" component={Callback} />
        <Route path="/share/:token">
          {(params) => <SharePublic token={params.token} />}
        </Route>

        {/* Authenticated Routes */}
        <Route path="/dashboard">
          <Protected>
            <Dashboard />
          </Protected>
        </Route>

        <Route path="/records">
          <Protected>
            <Records />
          </Protected>
        </Route>
        <Route path="/records/upload">
          <Protected>
            <UploadPage />
          </Protected>
        </Route>
        <Route path="/upload">
          <Protected>
            <UploadPage />
          </Protected>
        </Route>
        <Route path="/records/:id">
          {(params) => (
            <Protected>
              <RecordDetail id={params.id} />
            </Protected>
          )}
        </Route>

        <Route path="/timeline">
          <Protected>
            <Timeline />
          </Protected>
        </Route>
        <Route path="/appointments">
          <Protected>
            <Appointments />
          </Protected>
        </Route>
        <Route path="/sharing">
          <Protected>
            <Sharing />
          </Protected>
        </Route>
        <Route path="/security">
          <Protected>
            <ActivityPage />
          </Protected>
        </Route>
        <Route path="/activity">
          <Protected>
            <ActivityPage />
          </Protected>
        </Route>
        <Route path="/profile">
          <Protected>
            <Profile />
          </Protected>
        </Route>
        <Route path="/settings">
          <Protected>
            <SettingsPage />
          </Protected>
        </Route>

        {/* Catch-all 404 */}
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
