/* ==========================================================================
   Ithri Inventory — fresh juice table
   - staff: types supply / cooler / supplied / produced; opening stock is
     locked; spoilt / leaking / fermented are logged one entry at a time with
     a "from super stores / from factory" choice.
   - manager: sees the same live table read-only (on the Overview).
   ========================================================================== */

import { Store } from "./store.js";
import { ITHRI_CONFIG } from "./config.js";
import { $, $$, fmt, esc } from "./util.js";
import { FJ_ROWS, splitCaption, categoryLabel, defectsTableHtml } from "./tables.js";
import { session, toast, refreshBadges, saveNow, notifyChanged } from "./shell.js";

const sourceOptions = () =>
  ITHRI_CONFIG.DEFECT_SOURCES.map(s => `<option value="${s.key}">${esc(s.label)}</option>`).join("");

function cellHtml(r, f, c, mode) {
  const id = esc(f.id);
  if (r.type === "input" && mode === "staff") {
    return `<td><input type="number" min="0" step="0.01" data-fj="${id}" data-key="${r.key}" value="${c[r.key]}" aria-label="${esc(r.label)} — ${esc(f.name)}"></td>`;
  }
  if (r.type === "defect") {
    const readout = `<div class="defect-total" data-total>${fmt(c[r.key])}</div><div class="defect-split" data-split>${splitCaption(c.split[r.key])}</div>`;
    if (mode === "staff") {
      return `<td class="defect-cell" data-fj="${id}" data-cat="${r.key}">${readout}
        <div class="defect-inputs">
          <input type="number" min="1" step="1" class="d-qty" placeholder="How many" aria-label="How many — ${esc(r.label)} — ${esc(f.name)}">
          <select class="d-src" aria-label="Where from — ${esc(r.label)} — ${esc(f.name)}">${sourceOptions()}</select>
          <button type="button" class="btn-mini d-add">Add</button>
        </div></td>`;
    }
    return `<td class="locked defect-cell" data-fj="${id}" data-cat="${r.key}">${readout}</td>`;
  }
  return `<td class="locked" data-fj="${id}" data-key="${r.key}">${fmt(c[r.key])}</td>`;
}

function buildTable(table, mode) {
  const flavours = Store.allFreshJuiceMeta();
  const computed = Object.fromEntries(flavours.map(f => [f.id, Store.computedFreshJuice(f.id)]));
  const head = `<thead><tr><th>Description</th>${flavours.map(f => `<th>${esc(f.name)}</th>`).join("")}</tr></thead>`;
  const body = FJ_ROWS.map(r =>
    `<tr><th scope="row">${r.label}</th>${flavours.map(f => cellHtml(r, f, computed[f.id], mode)).join("")}</tr>`
  ).join("");
  table.innerHTML = head + `<tbody>${body}</tbody>`;
}

// Refresh numbers without rebuilding the table, so a remote change never
// steals the cursor from a cell somebody is typing in.
function updateValues(table) {
  Store.allFreshJuiceMeta().forEach(f => {
    const c = Store.computedFreshJuice(f.id);
    $$(`[data-fj="${f.id}"][data-key]`, table).forEach(el => {
      const v = c[el.dataset.key];
      if (el.tagName === "INPUT") {
        if (document.activeElement !== el && Number(el.value) !== v) el.value = v;
      } else {
        el.textContent = fmt(v);
      }
    });
    $$(`td.defect-cell[data-fj="${f.id}"]`, table).forEach(td => {
      $("[data-total]", td).textContent = fmt(c[td.dataset.cat]);
      $("[data-split]", td).textContent = splitCaption(c.split[td.dataset.cat]);
    });
  });
}

export function renderFjTable(table, mode) {
  if (!table) return;
  const flavours = Store.allFreshJuiceMeta();
  const sig = mode + "|" + flavours.map(f => f.id + ":" + f.name).join(",");
  if (table.dataset.sig === sig && table.firstChild) { updateValues(table); return; }
  buildTable(table, mode);
  table.dataset.sig = sig;
}

export function renderDefectList() {
  const box = $("#defectList");
  if (!box) return;
  const day = Store.todayStr();
  const entries = Store.state.defects
    .filter(d => d.date === day || d.status === "pending")
    .sort((a, b) => b.ts - a.ts);
  box.innerHTML = entries.length
    ? defectsTableHtml(entries, { removable: true })
    : `<p class="empty-state">Nothing logged yet today.</p>`;
}

export function renderFresh() {
  if (session.role === "staff") {
    renderFjTable($("#fjTable"), "staff");
    renderDefectList();
  } else if (session.role === "manager") {
    renderFjTable($("#fjOverviewTable"), "view");
  }
}

export function initFresh() {
  const table = $("#fjTable");

  table.addEventListener("input", event => {
    const input = event.target.closest("input[data-fj][data-key]");
    if (!input) return;
    Store.updateFreshJuiceField(input.dataset.fj, input.dataset.key, Math.max(0, Number(input.value) || 0));
    updateValues(table);
    refreshBadges();
  });

  table.addEventListener("click", event => {
    const btn = event.target.closest(".d-add");
    if (!btn) return;
    const td = btn.closest("td");
    const qtyInput = $(".d-qty", td);
    const source = $(".d-src", td).value;
    const qty = Number(qtyInput.value);
    if (!(qty > 0)) { toast("Type how many bottles first.", "warn"); qtyInput.focus(); return; }
    const flavourId = td.dataset.fj, category = td.dataset.cat;
    Store.logDefect({ flavourId, category, source, qty, by: session.role || "staff" });
    qtyInput.value = "";
    const name = Store.labelFor2(flavourId);
    toast(source === "factory"
      ? `Sent to the manager for approval: ${fmt(qty)} ${name} (${categoryLabel(category).toLowerCase()}, from factory).`
      : `Recorded: ${fmt(qty)} ${name} (${categoryLabel(category).toLowerCase()}, from super stores).`, "ok");
    notifyChanged();
  });

  $("#defectList").addEventListener("click", event => {
    const btn = event.target.closest("[data-remove-defect]");
    if (!btn) return;
    if (!confirm("Remove this entry?")) return;
    Store.removeDefect(btn.dataset.removeDefect);
    notifyChanged();
  });

  $("#fjSaveBtn").addEventListener("click", () => saveNow($("#fjSaveBtn")));
}
