/* ==========================================================================
   Ithri Inventory — small shared helpers (no app logic in here)
   ========================================================================== */

export const $ = (sel, ctx) => (ctx || document).querySelector(sel);
export const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

export function fmt(n) {
  n = Number(n) || 0;
  return (Math.round(n * 100) / 100).toString();
}

// Escape text before it goes into innerHTML (material / flavour names are typed by users).
export function esc(s) {
  return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]
  ));
}

export const pluralize = (n, unit) => (Number(n) === 1 ? unit : unit + "s");
export const amountWithUnit = (n, unit) => `${fmt(n)} ${pluralize(n, unit)}`;

/* ------------------------------- dates ----------------------------------- */
// Dates are plain "YYYY-MM-DD" strings. All the maths is done in UTC day-steps
// so it can never slip a day because of the device's time zone.

export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dateRange(fromStr, toStr, cap = 400) {
  const out = [];
  let d = fromStr;
  while (d <= toStr && out.length < cap) { out.push(d); d = addDays(d, 1); }
  return out;
}

export function formatDateLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatTime(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

// "2026-W40" (what <input type="week"> gives) -> [monday, sunday]
export function isoWeekToRange(weekValue) {
  const [yearStr, weekStr] = weekValue.split("-W");
  const year = Number(yearStr), week = Number(weekStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)];
}

// "2026-09" (what <input type="month"> gives) -> [first day, last day]
export function monthToRange(monthValue) {
  const [yearStr, monthStr] = monthValue.split("-");
  const year = Number(yearStr), month = Number(monthStr);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [`${yearStr}-${monthStr}-01`, `${yearStr}-${monthStr}-${String(lastDay).padStart(2, "0")}`];
}

// The ISO week ("YYYY-Www") a given "YYYY-MM-DD" date falls in.
export function isoWeekValueOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
