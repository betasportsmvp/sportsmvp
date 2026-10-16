/**
 * Calendar-date helpers. Attendance dates are plain `YYYY-MM-DD` strings in the group's
 * timezone; arithmetic is done in UTC so it never shifts across daylight-saving changes.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function toUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE.test(value) && fromUtc(toUtc(value)) === value;
}

export function isIsoMonth(value: unknown): value is string {
  return typeof value === "string" && ISO_MONTH.test(value) && isIsoDate(`${value}-01`);
}

/** The calendar date at `at` in `timeZone`, as `YYYY-MM-DD`. */
export function localDate(timeZone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function addMonths(month: string, months: number): string {
  const d = toUtc(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return fromUtc(d).slice(0, 7);
}

export function monthRange(month: string): { first: string; last: string } {
  const first = `${month}-01`;
  return { first, last: addDays(`${addMonths(month, 1)}-01`, -1) };
}

/** Weeks (Monday first) covering `month`; days outside the month are null. */
export function monthGrid(month: string): (string | null)[][] {
  const { first, last } = monthRange(month);
  const lead = (toUtc(first).getUTCDay() + 6) % 7;
  const days: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  while (days.length % 7) days.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

export type EditPolicy = "editable" | "future" | "locked";

/** Mirrors the rule enforced by `upsert_attendance`, so the UI can explain it up front. */
export function attendanceEditPolicy(opts: {
  date: string;
  today: string;
  backdateDays: number;
  isAdmin: boolean;
}): EditPolicy {
  if (opts.date > opts.today) return "future";
  if (!opts.isAdmin && opts.date < addDays(opts.today, -opts.backdateDays)) return "locked";
  return "editable";
}

/** Formats a `YYYY-MM-DD` date for display without shifting it into another timezone. */
export function formatDate(date: string, options: Intl.DateTimeFormatOptions = {}): string {
  return toUtc(date).toLocaleDateString("en-GB", { timeZone: "UTC", ...options });
}

export function formatMonth(month: string): string {
  return formatDate(`${month}-01`, { month: "long", year: "numeric" });
}

/** A timestamp shown in the group's timezone, e.g. "17 Oct, 18:20". */
export function formatTimestamp(at: string | Date, timeZone: string): string {
  return new Date(at).toLocaleString("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
