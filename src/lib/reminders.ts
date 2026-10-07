// Reminder scheduling logic.
//
// Everything here is derived ONLY from schedules the user typed in (reminder times,
// weekdays, start/end dates, "remind me N minutes before"). Nothing is inferred from
// a medicine's name, dosage or frequency, and nothing here gives medical advice.

import { combineDateTime, normTime, parseDate } from '@/lib/datetime';
import type { Appt, Medicine, MedReminder, ReminderLog } from '@/lib/types';

export type DoseStatus = 'taken' | 'skipped' | 'due' | 'upcoming';

export type Dose = {
  key: string;
  reminder: MedReminder;
  medicine: Medicine;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  at: Date;
  status: DoseStatus;
  log?: ReminderLog;
};

export const doseKey = (reminderId: string, date: string, time: string) =>
  `${reminderId}|${date}|${time}`;

/** Does this reminder schedule fall on the given calendar date? */
export function reminderActiveOn(r: MedReminder, date: string): boolean {
  if (!r.is_active) return false;
  if (date < r.start_date) return false;
  if (r.end_date && date > r.end_date) return false;
  return r.days_of_week.includes(parseDate(date).getDay());
}

/** All scheduled doses on one date, soonest first, with their taken/due status. */
export function dosesForDate(
  date: string,
  reminders: MedReminder[],
  medicines: Medicine[],
  logs: ReminderLog[],
  now: Date = new Date()
): Dose[] {
  const medById = new Map(medicines.map((m) => [m.id, m]));
  const logByKey = new Map<string, ReminderLog>();
  for (const l of logs) {
    const t = normTime(l.scheduled_time);
    if (t) logByKey.set(doseKey(l.reminder_id, l.scheduled_date, t), l);
  }

  const out: Dose[] = [];
  for (const r of reminders) {
    if (!reminderActiveOn(r, date)) continue;
    const medicine = medById.get(r.medicine_id);
    if (!medicine) continue;
    const seen = new Set<string>();
    for (const raw of r.reminder_times) {
      const time = normTime(raw);
      if (!time || seen.has(time)) continue;
      seen.add(time);
      const key = doseKey(r.id, date, time);
      const log = logByKey.get(key);
      const at = combineDateTime(date, time);
      const status: DoseStatus = log ? log.status : at.getTime() <= now.getTime() ? 'due' : 'upcoming';
      out.push({ key, reminder: r, medicine, date, time, at, status, log });
    }
  }
  out.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      a.medicine.medicine_name.localeCompare(b.medicine.medicine_name)
  );
  return out;
}

export type FollowUpState = 'scheduled' | 'due' | 'past';

export type FollowUpReminder = {
  appt: Appt;
  visitAt: Date;
  remindAt: Date;
  state: FollowUpState;
  key: string;
};

/**
 * Visit/follow-up reminders: appointments that have BOTH a time and a user-chosen
 * "remind me" lead time. `due` = the reminder moment has passed but the visit hasn't.
 */
export function followUpReminders(appts: Appt[], now: Date = new Date()): FollowUpReminder[] {
  const out: FollowUpReminder[] = [];
  for (const appt of appts) {
    if (appt.remind_before_minutes === null || appt.remind_before_minutes === undefined) continue;
    if (!normTime(appt.appointment_time)) continue;
    if (appt.status && appt.status !== 'scheduled') continue;
    const visitAt = combineDateTime(appt.appointment_date, appt.appointment_time);
    const remindAt = new Date(visitAt.getTime() - appt.remind_before_minutes * 60_000);
    const state: FollowUpState =
      now.getTime() >= visitAt.getTime() ? 'past' : now.getTime() >= remindAt.getTime() ? 'due' : 'scheduled';
    out.push({ appt, visitAt, remindAt, state, key: `visit|${appt.id}|${remindAt.getTime()}` });
  }
  out.sort((a, b) => a.visitAt.getTime() - b.visitAt.getTime());
  return out;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "Every day" / "Mon, Wed, Fri" */
export function describeDays(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return 'Every day';
  return set.map((d) => WEEKDAYS[d]).join(', ');
}
