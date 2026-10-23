/* ==========================================================================
   Ithri Inventory — Records & History (both staff and manager)
   Three sub-tabs, all read from the saved day reports (plus today's live
   figures):
     Daily Records  — every day as its own block of tables
     Summary        — a week or a month added up
     Spoilt / Leaking / Fermented — every defect entry, from stores or factory
   ========================================================================== */

import { Store } from "./store.js";
import { $, $$, fmt, esc, formatDateLabel, formatDateTime, dateRange, addDays, isoWeekToRange, monthToRange, isoWeekValueOf } from "./util.js";
import { fjTableHtml, materialsTableHtml, defectsTableHtml, categoryLabel } from "./tables.js";

const MAX_DAYS = 62;
const num = v => Number(v) || 0;
let activeSub = "daily";
let dailyToken = 0, summaryToken = 0, lossToken = 0;

const scroll = html => `<div class="table-scroll">${html}</div>`;
const failed = `<p class="empty-state">Couldn't load the saved reports. Check your connection and try again.</p>`;

/* ------------------------------- daily records ----------------------------- */

function closedText(report) {
  const who = report.closedBy === "auto" ? "Closed automatically at the end of the day" : "Closed by the manager";
  return `${who}${report.closedAt ? " · " + formatDateTime(report.closedAt) : ""}`;
}

function dayBlock(d, category) {
  const label = formatDateLabel(d.date);
  let inner;
  if (!d.report) {
    inner = `<p class="report-empty">No report was saved for this day.</p>`;
  } else {
    const r = d.report;
    const status = d.live
      ? `<span class="chip chip-pending">Open today — not closed yet</span>`
      : `<span class="chip chip-noaction">${esc(closedText(r))}</span>`;
    inner = `<div class="day-status">${status}</div>`;
    if (!category || category === "freshjuice") {
      inner += `<div class="records-category-title">Fresh Juice</div>${scroll(fjTableHtml(r.fj))}`;
    }
    if (!category || category === "raw") {
      inner += `<div class="records-category-title">Raw Materials</div>${scroll(materialsTableHtml(r.raw))}`;
    }
    if (!category || category === "other") {
      inner += `<div class="records-category-title">Other Materials</div>${scroll(materialsTableHtml(r.other))}`;
    }
  }
  return `<div class="day-block">
    <div class="day-header">${label}</div>
    ${inner}
    <div class="day-end">— end of ${label} —</div>
  </div>`;
}

async function renderDaily() {
  const token = ++dailyToken;
  const box = $("#recordsDaily");
  let from = $("#recordsFromDate").value || Store.todayStr();
  let to = $("#recordsToDate").value || from;
  if (from > to) [from, to] = [to, from];
  const category = $("#recordsCategoryFilter").value;
  const count = dateRange(from, to).length;
  if (count > MAX_DAYS) {
    box.innerHTML = `<p class="empty-state">That's ${count} days — please pick ${MAX_DAYS} days or fewer, or use the Summary tab for a longer stretch.</p>`;
    return;
  }
  box.innerHTML = `<p class="empty-state">Loading…</p>`;
  let days;
  try { days = await Store.loadDays(from, to); } catch (err) { console.error(err); if (token === dailyToken) box.innerHTML = failed; return; }
  if (token !== dailyToken) return;
  box.innerHTML = days.slice().reverse().map(d => dayBlock(d, category)).join("");
}

/* ---------------------------------- summary -------------------------------- */

// Adds up a list of days (oldest first): opening from the first day, closing
// from the last, everything else summed.
function aggregate(days) {
  const withReport = days.filter(d => d.report);
  const fj = new Map();
  const mats = { raw: new Map(), other: new Map() };

  withReport.forEach(d => {
    (d.report.fj || []).forEach(f => {
      const row = f.row;
      if (!row) return;
      let a = fj.get(f.id);
      if (!a) {
        a = { id: f.id, name: f.name, opening: num(row.opening), produced: 0, supplied: 0, expired: 0, fermented: 0, leaking: 0, writeOff: 0, closing: 0 };
        fj.set(f.id, a);
      }
      a.name = f.name;
      a.produced += num(row.produced);
      a.supplied += num(row.supplied);
      a.expired += num(row.expired);
      a.fermented += num(row.fermented);
      a.leaking += num(row.leaking);
      a.writeOff += num(row.writeOff);
      a.closing = num(row.totalInFreezer);
    });
    ["raw", "other"].forEach(group => (d.report[group] || []).forEach(m => {
      let a = mats[group].get(m.id);
      if (!a) {
        a = { id: m.id, name: m.name, unit: m.unit, bagSize: m.bagSize, opening: num(m.opening), added: 0, used: 0, corrected: 0, closing: 0 };
        mats[group].set(m.id, a);
      }
      a.name = m.name;
      a.unit = m.unit;
      a.added += num(m.added);
      a.used += num(m.used);
      a.corrected += num(m.corrected);
      a.closing = num(m.closing);
    }));
  });

  return {
    daysWithReport: withReport.length,
    includesToday: withReport.some(d => d.live),
    fj: [...fj.values()],
    raw: [...mats.raw.values()],
    other: [...mats.other.values()]
  };
}

function summaryFjTable(rows) {
  if (!rows.length) return `<p class="report-empty">No fresh juice figures in this period.</p>`;
  const body = rows.map(r => `<tr>
    <td class="first-col">${esc(r.name)}</td>
    <td class="num">${fmt(r.opening)}</td><td class="num">${fmt(r.produced)}</td><td class="num">${fmt(r.supplied)}</td>
    <td class="num">${fmt(r.expired)}</td><td class="num">${fmt(r.fermented)}</td><td class="num">${fmt(r.leaking)}</td>
    <td class="num">${fmt(r.writeOff)}</td><td class="num"><strong>${fmt(r.closing)}</strong></td>
  </tr>`).join("");
  return scroll(`<table class="report-table"><thead><tr>
    <th class="first-col">Flavour</th><th class="num">Opening</th><th class="num">Produced</th><th class="num">Supplied</th>
    <th class="num">Spoilt / expired</th><th class="num">Fermented</th><th class="num">Leaking</th>
    <th class="num">Factory losses approved</th><th class="num">Closing</th>
  </tr></thead><tbody>${body}</tbody></table>`);
}

function summaryRange() {
  if ($("#summaryPeriodType").value === "week") {
    const v = $("#summaryWeekInput").value;
    if (!v) return null;
    const [from, to] = isoWeekToRange(v);
    return { from, to, label: `Week of ${formatDateLabel(from)} – ${formatDateLabel(to)}` };
  }
  const v = $("#summaryMonthInput").value;
  if (!v) return null;
  const [from, to] = monthToRange(v);
  const name = new Date(from + "T00:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return { from, to, label: name };
}

async function renderSummary() {
  const token = ++summaryToken;
  const box = $("#summaryBody");
  const range = summaryRange();
  if (!range) { box.innerHTML = `<p class="empty-state">Pick a ${$("#summaryPeriodType").value} to see its summary.</p>`; return; }
  box.innerHTML = `<p class="empty-state">Loading…</p>`;
  let days;
  try { days = await Store.loadDays(range.from, range.to); } catch (err) { console.error(err); if (token === summaryToken) box.innerHTML = failed; return; }
  if (token !== summaryToken) return;

  const agg = aggregate(days);
  box.innerHTML = `
    <p class="summary-meta"><strong>${esc(range.label)}</strong> (${range.from} to ${range.to}) —
      ${agg.daysWithReport} of ${days.length} days have a report${agg.includesToday ? ", including today so far" : ""}.</p>
    <div class="records-category-title">Fresh Juice</div>
    ${summaryFjTable(agg.fj)}
    <div class="records-category-title">Raw Materials</div>
    ${scroll(materialsTableHtml(agg.raw))}
    <div class="records-category-title">Other Materials</div>
    ${scroll(materialsTableHtml(agg.other))}`;
}

/* ------------------------ spoilt / leaking / fermented --------------------- */

async function renderLosses() {
  const token = ++lossToken;
  const box = $("#lossBody");
  let from = $("#lossFrom").value || addDays(Store.todayStr(), -29);
  let to = $("#lossTo").value || Store.todayStr();
  if (from > to) [from, to] = [to, from];
  box.innerHTML = `<p class="empty-state">Loading…</p>`;
  let entries;
  try { entries = await Store.loadDefects(from, to); } catch (err) { console.error(err); if (token === lossToken) box.innerHTML = failed; return; }
  if (token !== lossToken) return;

  const cat = $("#lossCategory").value, src = $("#lossSource").value, status = $("#lossStatus").value;
  entries = entries.filter(d =>
    (!cat || d.category === cat) && (!src || d.source === src) && (!status || d.status === status));

  // Totals count everything except declined entries.
  const counted = entries.filter(d => d.status !== "rejected");
  const sumOf = (c, s) => counted.filter(d => d.category === c && d.source === s).reduce((t, d) => t + num(d.qty), 0);
  const cats = ["expired", "fermented", "leaking"];
  const totals = `<table class="report-table"><thead><tr><th class="first-col">Type</th><th class="num">From super stores</th><th class="num">From factory</th><th class="num">Total</th></tr></thead><tbody>${
    cats.map(c => `<tr><td class="first-col">${esc(categoryLabel(c))}</td><td class="num">${fmt(sumOf(c, "stores"))}</td><td class="num">${fmt(sumOf(c, "factory"))}</td><td class="num"><strong>${fmt(sumOf(c, "stores") + sumOf(c, "factory"))}</strong></td></tr>`).join("")
  }</tbody></table>`;

  box.innerHTML = `
    <p class="summary-meta">${entries.length} entr${entries.length === 1 ? "y" : "ies"} from ${formatDateLabel(from)} to ${formatDateLabel(to)}. Declined entries are listed but not counted in the totals.</p>
    <div class="records-category-title">Totals</div>
    ${scroll(totals)}
    <div class="records-category-title">All entries</div>
    ${scroll(defectsTableHtml(entries, { showDate: true, showBy: true }))}`;
}

/* ------------------------------- sub-tab wiring ---------------------------- */

export function renderRecords() {
  if (activeSub === "daily") renderDaily();
  else if (activeSub === "summary") renderSummary();
  else renderLosses();
}

function showSub(name) {
  activeSub = name;
  $$("#recordsSubtabNav .subtab-btn").forEach(b => b.classList.toggle("active", b.dataset.subtab === name));
  $$(".subtab-panel").forEach(p => p.classList.toggle("active", p.id === "subpanel-" + name));
  renderRecords();
}

// Called on login and after Clear all: point every filter at the open day.
export function resetRecordsFilters() {
  const today = Store.todayStr();
  $("#recordsFromDate").value = today;
  $("#recordsToDate").value = today;
  $("#recordsCategoryFilter").value = "";
  $("#summaryWeekInput").value = isoWeekValueOf(today);
  $("#summaryMonthInput").value = today.slice(0, 7);
  $("#lossFrom").value = addDays(today, -29);
  $("#lossTo").value = today;
  $("#lossCategory").value = ""; $("#lossSource").value = ""; $("#lossStatus").value = "";
}

export function initRecords() {
  $$("#recordsSubtabNav .subtab-btn").forEach(b => b.addEventListener("click", () => showSub(b.dataset.subtab)));

  ["recordsFromDate", "recordsToDate", "recordsCategoryFilter"].forEach(id =>
    $("#" + id).addEventListener("change", renderDaily));
  $("#recordsResetBtn").addEventListener("click", () => { resetRecordsFilters(); renderDaily(); });

  $("#summaryPeriodType").addEventListener("change", () => {
    const week = $("#summaryPeriodType").value === "week";
    $("#summaryWeekInput").hidden = !week;
    $("#summaryMonthInput").hidden = week;
    renderSummary();
  });
  $("#summaryWeekInput").addEventListener("change", renderSummary);
  $("#summaryMonthInput").addEventListener("change", renderSummary);

  ["lossFrom", "lossTo", "lossCategory", "lossSource", "lossStatus"].forEach(id =>
    $("#" + id).addEventListener("change", renderLosses));
}
