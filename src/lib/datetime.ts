// Date / time helpers.
//
// MediVault stores event dates (DATE) and times (TIME) as the user's local wall-clock
// values. Everything here works in the user's local timezone and never goes through
// toISOString() (which is UTC and shifts dates around midnight).

const pad = (n: number) => String(n).padStart(2, '0');

/** Date -> YYYY-MM-DD in local time. */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Today's date as YYYY-MM-DD in the user's local timezone. */
export function localToday(): string {
  return toDateStr(new Date());
}

/** Current local time as HH:MM. */
export function localNowTime(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** YYYY-MM-DD -> local Date at 00:00. */
export function parseDate(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** "14:30:00" | "14:30" -> "14:30". null/empty -> null. */
export function normTime(t?: string | null): string | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(t);
  if (!m) return null;
  return `${pad(Number(m[1]))}:${m[2]}`;
}

/** Local Date for a stored date + optional time (no time => 00:00). */
export function combineDateTime(date: string, time?: string | null): Date {
  const d = parseDate(date);
  const t = normTime(time);
  if (t) {
    const [hh, mm] = t.split(':').map(Number);
    d.setHours(hh, mm, 0, 0);
  }
  return d;
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

/** e.g. "Wed, 7 Oct 2026" */
export function formatDate(date: string): string {
  return parseDate(date).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** e.g. "3:30 PM" */
export function formatTime(time?: string | null): string {
  const t = normTime(time);
  if (!t) return '';
  const [hh, mm] = t.split(':').map(Number);
  return new Date(2000, 0, 1, hh, mm).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** e.g. "Wed, 7 Oct 2026 · 3:30 PM" (time omitted when none stored). */
export function formatDateTime(date: string, time?: string | null): string {
  const t = formatTime(time);
  return t ? `${formatDate(date)} · ${t}` : formatDate(date);
}

/** A stored timestamptz -> local, full date + time. */
export function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export type Age = { years: number; months: number; days: number };

/**
 * Exact current age from a date of birth (YYYY-MM-DD), in the local timezone.
 * Returns null for a missing or future date of birth.
 */
export function calcAge(dob?: string | null, now: Date = new Date()): Age | null {
  if (!dob) return null;
  const b = parseDate(dob);
  if (Number.isNaN(b.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (b > today) return null;

  // Whole months elapsed = the largest n where (birth date + n months) <= today.
  // "Birth date + n months" is clamped to the last day of a shorter month (e.g. the
  // 31st -> 28th), so the leftover days can never go negative.
  const by = b.getFullYear();
  const bm = b.getMonth();
  const bd = b.getDate();
  const anchor = (n: number): Date => {
    const first = new Date(by, bm + n, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(bd, lastDay));
  };

  let totalMonths = (today.getFullYear() - by) * 12 + (today.getMonth() - bm);
  if (anchor(totalMonths) > today) totalMonths -= 1;

  const a = anchor(totalMonths);
  const days = Math.round(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86400000
  );
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12, days };
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** Short form: "34 years" (or months / days for infants). */
export function formatAge(age: Age | null): string {
  if (!age) return '';
  if (age.years >= 1) return plural(age.years, 'year');
  if (age.months >= 1) return plural(age.months, 'month');
  return plural(age.days, 'day');
}

/** Long form: "34 years, 2 months, 5 days". */
export function formatAgeDetailed(age: Age | null): string {
  if (!age) return '';
  return [plural(age.years, 'year'), plural(age.months, 'month'), plural(age.days, 'day')].join(
    ', '
  );
}

/** Whole days from `from` to `to` (YYYY-MM-DD), DST-safe. */
export function daysBetween(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
    Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86400000);
}

/** Last day of a medicine course: start + duration - 1. */
export function courseEnd(start: string | null, durationDays: number | null): string | null {
  if (!start || !durationDays) return null;
  return addDays(start, durationDays - 1);
}

export const REMIND_OPTIONS: { value: number; label: string }[] = [
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 360, label: '6 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
  { value: 10080, label: '1 week before' },
];

export function remindLabel(minutes?: number | null): string {
  if (minutes === null || minutes === undefined) return 'No reminder';
  return (
    REMIND_OPTIONS.find((o) => o.value === minutes)?.label ??
    (minutes === 0 ? 'At the time of the visit' : `${minutes} minutes before`)
  );
}
