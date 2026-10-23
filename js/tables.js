/* ==========================================================================
   Ithri Inventory — table builders shared by the WhatsApp report, the
   manager's Overview and Records & History. They take plain data (live or
   from a saved day report) and return HTML, so a past day looks exactly like
   the day it was closed.
   ========================================================================== */

import { ITHRI_CONFIG } from "./config.js";
import { esc, fmt, pluralize, formatDateLabel, formatTime } from "./util.js";

// type: opening = locked for staff, input = staff types it, calc = worked out,
//       defect = spoilt/leaking/fermented (logged one entry at a time),
//       writeoff = approved factory losses taken off the stock
export const FJ_ROWS = [
  { key: "opening", label: "Opening stock", type: "opening" },
  { key: "forSupply", label: "Quantity for supply", type: "input" },
  { key: "cooler", label: "Quantity in the cooler", type: "input" },
  { key: "remainingInFreezer", label: "Quantity remaining in the freezer", type: "calc", locked: true },
  { key: "supplied", label: "Quantity supplied", type: "input" },
  { key: "notSupplied", label: "Quantity not supplied", type: "calc", locked: true },
  { key: "expired", label: "Quantity spoilt / expired", type: "defect" },
  { key: "fermented", label: "Quantity fermented", type: "defect" },
  { key: "leaking", label: "Quantity leaking", type: "defect" },
  { key: "produced", label: "Quantity produced", type: "input" },
  { key: "writeOff", label: "Factory losses approved (taken off stock)", type: "writeoff" },
  { key: "totalInFreezer", label: "Total in the freezer", type: "calc", locked: true }
];

export const categoryLabel = key =>
  (ITHRI_CONFIG.DEFECT_CATEGORIES.find(c => c.key === key) || { label: key }).label;
export const sourceLabel = key =>
  (ITHRI_CONFIG.DEFECT_SOURCES.find(s => s.key === key) || { label: key }).label;

export function defectStatusLabel(d) {
  switch (d.status) {
    case "pending": return "Waiting for manager";
    case "approved": return "Approved — taken off stock";
    case "rejected": return "Declined";
    default: return "No approval needed";
  }
}

export function splitCaption(split) {
  if (!split) return "";
  const stores = Number(split.stores) || 0, factory = Number(split.factory) || 0;
  if (stores + factory === 0) return "";
  return `Stores ${fmt(stores)} · Factory ${fmt(factory)}`;
}

/* ------------------------------ fresh juice ------------------------------ */

// list = [{ id, name, row }] where row is a computed fresh juice row
// (live, or saved inside a day report). A missing row or field shows "—".
export function fjTableHtml(list) {
  if (!list || !list.length) return "";
  const head = `<th class="first-col">Description</th>` +
    list.map(f => `<th class="num">${esc(f.name)}</th>`).join("");
  const rows = FJ_ROWS.map(r => {
    const cells = list.map(f => {
      const row = f.row;
      if (!row || row[r.key] === undefined) return `<td class="num">—</td>`;
      let html = fmt(row[r.key]);
      if (r.type === "defect") {
        const note = splitCaption(row.split && row.split[r.key]);
        if (note) html += `<div class="cell-note">${note}</div>`;
      }
      return `<td class="num">${html}</td>`;
    }).join("");
    return `<tr class="${r.locked ? "locked-row" : ""}"><td class="first-col">${r.label}</td>${cells}</tr>`;
  }).join("");
  return `<table class="report-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

/* ------------------------------- materials ------------------------------- */

const withUnit = (n, unit) => `${fmt(n)} ${pluralize(n, unit)}`;

// Opening / added (bought) / used / closing. "Added" is its own column so a day
// with a purchase still adds up: opening + added - used = closing. If the
// manager corrected the stock that day, a small note under the closing figure
// says by how much. With overview:true the closing cell also shows the bag
// count, and the last column is headed "In stock now".
export function materialsTableHtml(list, { overview = false } = {}) {
  if (!list || !list.length) return `<p class="report-empty">Nothing tracked yet.</p>`;
  const rows = list.map(s => {
    const corrected = Number(s.corrected) || 0;
    const notes = [
      overview && s.bagSize ? `${fmt(s.closing / s.bagSize)} bag(s)` : "",
      corrected ? `stock corrected ${corrected > 0 ? "+" : "−"}${fmt(Math.abs(corrected))}` : ""
    ].filter(Boolean);
    return `<tr>
      <td class="first-col">${esc(s.name)}</td>
      <td class="num">${withUnit(s.opening, s.unit)}</td>
      <td class="num">${s.added ? withUnit(s.added, s.unit) : "—"}</td>
      <td class="num">${withUnit(s.used || 0, s.unit)}</td>
      <td class="num"><strong>${withUnit(s.closing, s.unit)}</strong>${notes.map(n => `<div class="cell-note">${n}</div>`).join("")}</td>
    </tr>`;
  }).join("");
  return `<table class="report-table">
    <thead><tr><th class="first-col">Description</th><th class="num">Opening Stock</th><th class="num">Added (bought)</th><th class="num">Amount Used</th><th class="num">${overview ? "In stock now" : "Closing Stock"}</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/* ------------------------- spoilt / leaking / fermented ------------------ */

export function defectsTableHtml(entries, { showDate = false, showBy = false, removable = false } = {}) {
  if (!entries || !entries.length) return `<p class="report-empty">Nothing logged.</p>`;
  const rows = entries.map(d => `<tr>
    ${showDate ? `<td>${formatDateLabel(d.date)}${d.ts ? `<div class="cell-note">${formatTime(d.ts)}</div>` : ""}</td>` : (d.ts ? `<td>${formatTime(d.ts)}</td>` : "<td></td>")}
    <td class="first-col">${esc(d.flavourName)}</td>
    <td>${esc(categoryLabel(d.category))}</td>
    <td class="num"><strong>${fmt(d.qty)}</strong></td>
    <td>${esc(sourceLabel(d.source))}</td>
    <td><span class="chip chip-${esc(d.status)}">${esc(defectStatusLabel(d))}</span></td>
    ${showBy ? `<td>${esc(d.by || "")}</td>` : ""}
    ${removable ? `<td>${(d.status === "pending" || d.status === "noaction") ? `<button type="button" class="btn-mini btn-mini-danger" data-remove-defect="${esc(d.id)}" title="Remove this entry">✕</button>` : ""}</td>` : ""}
  </tr>`).join("");
  return `<table class="report-table defect-table">
    <thead><tr><th>${showDate ? "Date" : "Time"}</th><th class="first-col">Flavour</th><th>What</th><th class="num">How many</th><th>Where from</th><th>Status</th>${showBy ? "<th>Entered by</th>" : ""}${removable ? "<th></th>" : ""}</tr></thead>
    <tbody>${rows}</tbody></table>`;
}

/* -------------------------------- preform -------------------------------- */

export function preformHtml(pf) {
  if (!pf) return "";
  return `
    <div class="report-line"><span>Preform bags sent to factory</span><strong>${fmt(pf.sentToday)}</strong></div>
    <div class="report-line"><span>Bottles retrieved from factory</span><strong>${fmt(pf.receivedToday)}</strong></div>
    <div class="report-line"><span>Preform bags still at factory</span><strong>${fmt(pf.bagsAtFactory)}</strong></div>`;
}
