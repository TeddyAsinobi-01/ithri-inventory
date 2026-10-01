/* ==========================================================================
   Ithri Inventory — App
   Wires the DOM to the Store. Store syncs to Firestore (see store.js) —
   this file waits for the initial load before rendering, and shows a
   small status indicator while saves happen.
   ========================================================================== */

import { Store } from "./store.js";
import { ITHRI_CONFIG } from "./config.js";

const $ = (sel, ctx) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

let rawSelectedUnit = "manual";
let otherSelectedUnit = "manual";

function fmt(n) {
  n = Number(n) || 0;
  return (Math.round(n * 100) / 100).toString();
}

/* ---------------------------- Date helpers -------------------------------- */

// Inclusive list of "YYYY-MM-DD" strings from fromStr to toStr. Done in pure
// UTC day-steps so it can't shift a day under a non-UTC local timezone.
function dateRange(fromStr, toStr) {
  const out = [];
  let d = new Date(fromStr + "T00:00:00Z");
  const end = new Date(toStr + "T00:00:00Z");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

function formatDateLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// "YYYY-Www" (native <input type="week"> value) -> [mondayStr, sundayStr]
function isoWeekToRange(weekValue) {
  const [yearStr, weekStr] = weekValue.split("-W");
  const year = Number(yearStr), week = Number(weekStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // Monday=1 .. Sunday=7
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return [monday.toISOString().slice(0, 10), sunday.toISOString().slice(0, 10)];
}

// "YYYY-MM" (native <input type="month"> value) -> [firstDayStr, lastDayStr]
function monthToRange(monthValue) {
  const [yearStr, monthStr] = monthValue.split("-");
  const year = Number(yearStr), month = Number(monthStr);
  const from = `${yearStr}-${monthStr}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return [from, to];
}

/* ---------------------------- Tabs --------------------------------------- */

function initTabs() {
  $$(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  $("#notifBellBtn").addEventListener("click", () => switchTab("notifications"));
}

function switchTab(tab) {
  $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + tab));
  $("#urgentCard").hidden = tab !== "freshjuice" || Store.lowStockList().length === 0;
  if (tab === "notifications") renderNotifications();
  if (tab === "records") renderRecordsDaily();
}

/* ---------------------------- Notifications ------------------------------ */

function refreshNotificationBadges() {
  const low = Store.lowStockList();
  const count = low.length;
  const badge = $("#notifCount");
  badge.hidden = count === 0;
  badge.textContent = count;
  $("#tabDot").hidden = count === 0;
  renderUrgentCard(low);
}

function renderUrgentCard(low) {
  const card = $("#urgentCard");
  const activeTab = $(".tab-btn.active")?.dataset.tab;
  if (!low.length) { card.hidden = true; return; }
  card.hidden = activeTab !== "freshjuice";
  $("#urgentList").innerHTML = low.map(m => `<span>${m.name}</span>`).join("");
}

function renderNotifications() {
  const low = Store.lowStockList();
  const grid = $("#notifCardGrid");
  $("#notifEmptyState").hidden = low.length !== 0;
  grid.innerHTML = low.map(m => {
    const s = Store.stockOf(m.id);
    const key = Object.keys(s)[0];
    const amt = s[key];
    const bagInfo = m.bagSize ? ` (${fmt(Store.bagsFor(m, amt))} bag(s))` : "";
    return `<div class="mat-card low">
      <h4>${m.name}</h4>
      <div class="qty">${fmt(amt)} ${m.unit}${amt === 1 ? "" : "s"}</div>
      <div class="sub">${bagInfo.trim()} · threshold: ${m.threshold} ${m.thresholdType}</div>
    </div>`;
  }).join("");
}

/* ---------------------------- Fresh Juice --------------------------------- */

const FJ_ROWS = [
  { key: "opening", label: "Opening stock", editable: true },
  { key: "forSupply", label: "Quantity for supply", editable: true },
  { key: "cooler", label: "Quantity in the cooler", editable: true },
  { key: "remainingInFreezer", label: "Quantity remaining in the freezer", editable: false },
  { key: "supplied", label: "Quantity supplied", editable: true },
  { key: "notSupplied", label: "Quantity not supplied", editable: false },
  { key: "expired", label: "Quantity expired", editable: true },
  { key: "fermented", label: "Quantity fermented", editable: true },
  { key: "leaking", label: "Quantity leaking", editable: true },
  { key: "produced", label: "Quantity produced", editable: true },
  { key: "totalInFreezer", label: "Total in the freezer", editable: false }
];

function renderFreshJuiceTable() {
  const flavours = Store.allFreshJuiceMeta();
  const head = $("#fjTable thead tr");
  head.innerHTML = "<th>Description</th>" + flavours.map(f => `<th>${f.name}</th>`).join("");

  const body = $("#fjTableBody");
  body.innerHTML = FJ_ROWS.map(row => {
    const cells = flavours.map(f => {
      const c = Store.computedFreshJuice(f.id);
      const val = c[row.key];
      if (row.editable) {
        return `<td><input type="number" min="0" step="0.01" data-fj="${f.id}" data-field="${row.key}" value="${val}"></td>`;
      }
      return `<td class="locked" data-fj-locked="${f.id}" data-field="${row.key}">${fmt(val)}</td>`;
    }).join("");
    return `<tr><th scope="row">${row.label}</th>${cells}</tr>`;
  }).join("");

  body.querySelectorAll("input[data-fj]").forEach(inp => {
    inp.addEventListener("input", () => {
      const id = inp.dataset.fj, field = inp.dataset.field;
      Store.updateFreshJuiceField(id, field, Number(inp.value) || 0);
      refreshFreshJuiceLockedCells(id);
      refreshNotificationBadges();
    });
  });
}

function refreshFreshJuiceLockedCells(id) {
  const c = Store.computedFreshJuice(id);
  ["remainingInFreezer", "notSupplied", "totalInFreezer"].forEach(field => {
    const td = $(`[data-fj-locked="${id}"][data-field="${field}"]`);
    if (td) td.textContent = fmt(c[field]);
  });
}

function initFreshJuice() {
  renderFreshJuiceTable();
  $("#fjSaveBtn").addEventListener("click", async () => {
    const btn = $("#fjSaveBtn");
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Saving…";
    await Store.persistState();
    btn.textContent = "Saved ✓";
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1200);
  });
}

/* ---------------------------- Raw Materials ------------------------------- */

function renderRawUnitOptions() {
  const id = $("#rawMaterialSelect").value;
  const m = Store.findMaterial(id);
  const action = $("#rawActionSelect").value;
  const box = $("#rawUnitOptions");
  const amountInput = $("#rawAmountInput");
  box.innerHTML = "";
  rawSelectedUnit = "manual";

  if (action === "use" || !m || !m.bagSize) {
    amountInput.placeholder = m ? `Amount (${m.unit}s)` : "Amount";
    return;
  }

  const options = [{ key: "bag", label: "Bag" }];
  if (m.hasHalfBag) options.push({ key: "halfbag", label: "Half bag" });
  options.push({ key: "manual", label: `Manual (${m.unit}s)` });

  options.forEach((o, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = o.label;
    if (i === 0) { b.classList.add("selected"); rawSelectedUnit = o.key; }
    b.addEventListener("click", () => {
      rawSelectedUnit = o.key;
      box.querySelectorAll("button").forEach(x => x.classList.remove("selected"));
      b.classList.add("selected");
      amountInput.placeholder = o.key === "manual" ? `Amount (${m.unit}s)` : "Number of bags";
    });
    box.appendChild(b);
  });
  amountInput.placeholder = "Number of bags";
}

function renderRawCards() {
  const grid = $("#rawCardGrid");
  grid.innerHTML = Store.state.materials.raw.map(m => {
    const s = Store.stockOf(m.id);
    const key = Object.keys(s)[0];
    const amt = s[key];
    const low = Store.isBelowThreshold(m);
    const bucketLine = `${fmt(amt)} ${m.unit}${amt === 1 ? "" : "s"}`;
    const bagCount = m.bagSize ? fmt(Store.bagsFor(m, amt)) : null;
    const bagLine = m.bagSize ? `${bagCount} bag(s) · ${m.bagSize} ${m.unit}s/bag` : (m.seasonal ? "Seasonal" : "");
    // Tigernut/Dates are bought and tracked by the bag day-to-day, so the
    // bag count is the headline figure there; the custard-bucket count is
    // the finer-grained backup measure, shown smaller.
    const bagIsPrimary = m.bagPrimary && m.bagSize;
    const qtyLine = bagIsPrimary ? `${bagCount} bag${bagCount === "1" ? "" : "s"}` : bucketLine;
    const subLine = bagIsPrimary ? bucketLine : bagLine;
    return `<div class="mat-card ${low ? "low" : ""}">
      <h4>${m.name}</h4>
      <div class="qty">${qtyLine}</div>
      <div class="sub">${subLine}</div>
    </div>`;
  }).join("");
}

function initRawMaterials() {
  const sel = $("#rawMaterialSelect");
  sel.addEventListener("change", renderRawUnitOptions);
  $("#rawActionSelect").addEventListener("change", renderRawUnitOptions);

  $("#rawSubmitBtn").addEventListener("click", () => {
    const id = sel.value;
    const m = Store.findMaterial(id);
    const action = $("#rawActionSelect").value;
    const amount = Number($("#rawAmountInput").value);
    if (!m || !amount || amount <= 0) { alert("Choose a material and enter an amount above 0."); return; }

    let baseAmount = amount;
    let detail = `${amount} ${m.unit}${amount === 1 ? "" : "s"}`;
    if (action === "add" && m.bagSize) {
      if (rawSelectedUnit === "bag") { baseAmount = amount * m.bagSize; detail = `${amount} bag(s)`; }
      else if (rawSelectedUnit === "halfbag") { baseAmount = amount * m.halfBagSize; detail = `${amount} half bag(s)`; }
    }

    if (action === "add") Store.addStock(id, baseAmount, detail);
    else Store.useStock(id, baseAmount, detail + " used today");

    $("#rawAmountInput").value = "";
    renderRawCards();
    refreshNotificationBadges();
  });

  renderRawCards();
}

/* ---------------------------- Other Materials ------------------------------ */

function renderOtherActionFields() {
  const id = $("#otherMaterialSelect").value;
  const m = Store.findMaterial(id);
  const action = $("#otherActionSelect").value;
  const unitBox = $("#otherUnitOptions");
  const dailyBox = $("#otherDailyFields");
  unitBox.innerHTML = "";
  dailyBox.innerHTML = "";
  otherSelectedUnit = "manual";
  if (!m) return;

  if (action === "add") {
    // Same pattern as Raw Materials: bag/manual toggle when the material has a bag size.
    const amountInput = document.createElement("input");
    amountInput.type = "number"; amountInput.min = "0"; amountInput.step = "0.01";
    amountInput.id = "otherAmountInput";

    if (m.bagSize) {
      const options = [{ key: "bag", label: "Bag" }, { key: "manual", label: `Manual (${m.unit}s)` }];
      options.forEach((o, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = o.label;
        if (i === 0) { b.classList.add("selected"); otherSelectedUnit = o.key; }
        b.addEventListener("click", () => {
          otherSelectedUnit = o.key;
          unitBox.querySelectorAll("button").forEach(x => x.classList.remove("selected"));
          b.classList.add("selected");
          amountInput.placeholder = o.key === "manual" ? `Amount (${m.unit}s)` : "Number of bags";
        });
        unitBox.appendChild(b);
      });
      amountInput.placeholder = "Number of bags";
    } else {
      amountInput.placeholder = `Amount (${m.unit}s)`;
    }
    dailyBox.appendChild(amountInput);
    return;
  }

  // action === "use": daily usage / spoilage fields, shaped by the material's dailyMode
  let labelA = "Amount used", labelB = null;
  if (m.dailyMode === "used_spoilt") { labelA = "Used today"; labelB = "Spoilt today"; }
  else if (m.dailyMode === "used_bad") { labelA = "Used today"; labelB = "Bad/spoilt today"; }
  else if (m.dailyMode === "used_only") { labelA = "Used today"; }

  const a = document.createElement("input");
  a.type = "number"; a.min = "0"; a.step = "0.01"; a.id = "otherFieldA"; a.placeholder = labelA;
  dailyBox.appendChild(a);
  if (labelB) {
    const b = document.createElement("input");
    b.type = "number"; b.min = "0"; b.step = "0.01"; b.id = "otherFieldB"; b.placeholder = labelB;
    dailyBox.appendChild(b);
  }
}

function renderOtherCards() {
  const grid = $("#otherCardGrid");
  grid.innerHTML = Store.state.materials.other.map(m => {
    const s = Store.stockOf(m.id);
    const key = Object.keys(s)[0];
    const amt = s[key];
    const low = Store.isBelowThreshold(m);
    const bagInfo = m.bagSize ? `${fmt(Store.bagsFor(m, amt))} bag(s) · ${m.bagSize} ${m.unit}s/bag` : "";
    return `<div class="mat-card ${low ? "low" : ""}">
      <h4>${m.name}</h4>
      <div class="qty">${fmt(amt)} ${m.unit}${amt === 1 ? "" : "s"}</div>
      <div class="sub">${bagInfo}</div>
    </div>`;
  }).join("");
}

function initOtherMaterials() {
  const sel = $("#otherMaterialSelect");
  sel.addEventListener("change", renderOtherActionFields);
  $("#otherActionSelect").addEventListener("change", renderOtherActionFields);

  $("#otherSubmitBtn").addEventListener("click", () => {
    const id = sel.value;
    const m = Store.findMaterial(id);
    if (!m) return;
    const action = $("#otherActionSelect").value;

    if (action === "add") {
      const amount = Number($("#otherAmountInput")?.value);
      if (!amount || amount <= 0) { alert("Enter an amount above 0."); return; }
      let baseAmount = amount, detail = `${amount} ${m.unit}${amount === 1 ? "" : "s"}`;
      if (m.bagSize && otherSelectedUnit === "bag") { baseAmount = amount * m.bagSize; detail = `${amount} bag(s)`; }
      Store.addStock(id, baseAmount, detail);
    } else {
      const a = Number($("#otherFieldA")?.value) || 0;
      const b = Number($("#otherFieldB")?.value) || 0;
      if (m.dailyMode === "used_spoilt" || m.dailyMode === "used_bad") {
        const total = a + b;
        if (total <= 0) { alert("Enter at least one amount."); return; }
        Store.useStock(id, total, `Used: ${a}, Spoilt/Bad: ${b}`);
      } else {
        if (a <= 0) { alert("Enter an amount used."); return; }
        Store.useStock(id, a, "Used today");
      }
    }

    renderOtherCards();
    refreshNotificationBadges();
  });

  renderOtherCards();
}

/* ---------------------------- Preform -------------------------------------- */

function initPreform() {
  $("#preformBagSizeHint").textContent = Store.state.preformConfig.preformBagSize;
  $("#preformAtFactory").textContent = fmt(Store.state.preform.bagsAtFactory);

  $("#preformSendBtn").addEventListener("click", () => {
    const bags = Number($("#preformSendInput").value);
    if (!bags || bags <= 0) { alert("Enter the number of preform bags sent."); return; }
    Store.sendPreformToFactory(bags);
    $("#preformSendInput").value = "";
    $("#preformAtFactory").textContent = fmt(Store.state.preform.bagsAtFactory);
  });

  $("#preformReceiveBtn").addEventListener("click", () => {
    const bagsClosed = Number($("#preformBagsClosedInput").value);
    const bottlesReceived = Number($("#preformBottlesReceivedInput").value);
    const perBagInput = $("#preformPerBagInput").value;
    const perBag = perBagInput ? Number(perBagInput) : Store.state.preformConfig.defaultBottlesPerBottleBag;
    if (!bagsClosed || bottlesReceived === "" || bottlesReceived < 0) {
      alert("Enter the preform bags being closed out and the bottles actually received.");
      return;
    }
    const result = Store.receiveBottlesFromFactory(bottlesReceived, bagsClosed, perBag);
    $("#preformAtFactory").textContent = fmt(Store.state.preform.bagsAtFactory);
    const resBox = $("#preformResult");
    resBox.hidden = false;
    resBox.innerHTML = `Expected about <strong>${fmt(result.expectedBottles)}</strong> bottles for those preform bags. ` +
      (result.outstanding > 0
        ? `<strong>${fmt(result.outstanding)}</strong> bottle(s) still owed by the factory.`
        : `Full amount received — nothing outstanding.`);
    $("#preformBagsClosedInput").value = "";
    $("#preformBottlesReceivedInput").value = "";
    $("#preformPerBagInput").value = "";
    renderOtherCards();
    refreshNotificationBadges();
  });
}

/* ---------------------------- Settings -------------------------------------- */

function allMaterials() {
  return [...Store.state.materials.raw, ...Store.state.materials.other];
}

function populateSelectors() {
  const rawOpts = Store.state.materials.raw.map(m => `<option value="${m.id}">${m.name}${m.seasonal ? " (seasonal)" : ""}</option>`).join("");
  $("#rawMaterialSelect").innerHTML = rawOpts;

  const otherOpts = Store.state.materials.other.map(m => `<option value="${m.id}">${m.name}</option>`).join("");
  $("#otherMaterialSelect").innerHTML = otherOpts;

  const allOpts = allMaterials().map(m => `<option value="${m.id}">${m.name}</option>`).join("");
  $("#thresholdMaterialSelect").innerHTML = allOpts;
  $("#correctMaterialSelect").innerHTML = allOpts;

  const bagOpts = allMaterials().filter(m => m.bagSizeEditable).map(m => `<option value="${m.id}">${m.name}</option>`).join("");
  $("#bagSizeMaterialSelect").innerHTML = bagOpts;

  const fjOpts = Store.allFreshJuiceMeta().map(f => `<option value="${f.id}">${f.name}</option>`).join("");
  $("#correctFjSelect").innerHTML = fjOpts;

  renderRawUnitOptions();
  renderOtherActionFields();
}

function initSettings() {
  $("#addMaterialBtn").addEventListener("click", () => {
    const name = $("#newMatName").value.trim();
    if (!name) { alert("Enter a material name."); return; }
    Store.addMaterial({
      name,
      category: $("#newMatCategory").value,
      unit: $("#newMatUnit").value.trim() || "unit",
      bagSize: Number($("#newMatBagSize").value) || 0,
      thresholdType: $("#newMatThresholdType").value,
      threshold: Number($("#newMatThreshold").value) || 0,
      seasonal: $("#newMatSeasonal").checked
    });
    $("#newMatName").value = ""; $("#newMatUnit").value = "";
    $("#newMatBagSize").value = ""; $("#newMatThreshold").value = "";
    $("#newMatSeasonal").checked = false;
    populateSelectors();
    renderRawCards(); renderOtherCards(); refreshNotificationBadges();
  });

  $("#setThresholdBtn").addEventListener("click", () => {
    const id = $("#thresholdMaterialSelect").value;
    const val = Number($("#thresholdNewValue").value);
    if (!id || isNaN(val)) return;
    Store.setThreshold(id, val);
    $("#thresholdNewValue").value = "";
    renderRawCards(); renderOtherCards(); refreshNotificationBadges();
  });

  $("#setBagSizeBtn").addEventListener("click", () => {
    const id = $("#bagSizeMaterialSelect").value;
    const val = Number($("#bagSizeNewValue").value);
    if (!id || !val || val <= 0) return;
    Store.setBagSize(id, val);
    $("#bagSizeNewValue").value = "";
    renderRawCards(); renderOtherCards(); refreshNotificationBadges();
  });

  $("#correctStockBtn").addEventListener("click", () => {
    const id = $("#correctMaterialSelect").value;
    const val = Number($("#correctNewValue").value);
    if (!id || isNaN(val) || val < 0) return;
    Store.correctStock(id, val, $("#correctNote").value.trim());
    $("#correctNewValue").value = ""; $("#correctNote").value = "";
    renderRawCards(); renderOtherCards(); refreshNotificationBadges();
  });

  $("#correctFjBtn").addEventListener("click", () => {
    const id = $("#correctFjSelect").value;
    const val = Number($("#correctFjValue").value);
    if (!id || isNaN(val) || val < 0) return;
    Store.setOpeningStock(id, val);
    $("#correctFjValue").value = "";
    renderFreshJuiceTable();
  });

  $("#addFlavourBtn").addEventListener("click", () => {
    const name = $("#newFlavourName").value.trim();
    if (!name) { alert("Enter a flavour name."); return; }
    Store.addFlavour(name);
    $("#newFlavourName").value = "";
    populateSelectors();
    renderFreshJuiceTable();
  });

  $("#clearAllBtn").addEventListener("click", () => {
    if (!Store.state.clearAllUsedOnce) {
      if (!confirm("This clears every entry on the site. Continue?")) return;
      Store.clearAll();
    } else {
      const pw = prompt("This site has already been cleared once. Enter the developer password to clear it again:");
      if (pw === null) return;
      if (pw !== ITHRI_CONFIG.CLEAR_ALL_PASSWORD) { alert("Incorrect password."); return; }
      Store.clearAll();
    }
    populateSelectors();
    renderFreshJuiceTable(); renderRawCards(); renderOtherCards();
    refreshNotificationBadges(); renderRecordsDaily(); renderSummary();
    $("#preformAtFactory").textContent = "0";
    alert("All entries cleared.");
  });
}

/* ---------------------------- WhatsApp Report -------------------------------------- */

// dateStr omitted = today (the live, still-editable figures). Any other
// date pulls from the day-close snapshot for that day, if one exists.
function fjReportTable(dateStr) {
  const summary = Store.freshJuiceDailySummary(dateStr);
  if (!summary.length) return "";
  if (!summary.some(s => s.row)) {
    return `<p class="report-empty">Fresh juice wasn't closed out on this day — no figures recorded.</p>`;
  }
  const head = "<th class=\"first-col\">Description</th>" + summary.map(s => `<th class="num">${s.name}</th>`).join("");
  const rows = FJ_ROWS.map(row => {
    const cells = summary.map(s => {
      const val = s.row ? s.row[row.key] : null;
      return `<td class="num">${val === null || val === undefined ? "—" : fmt(val)}</td>`;
    }).join("");
    return `<tr class="${row.editable ? "" : "locked-row"}"><td class="first-col">${row.label}</td>${cells}</tr>`;
  }).join("");
  return `<table class="report-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function materialsReportTable(summaries) {
  if (!summaries.length) return `<p class="report-empty">Nothing tracked yet.</p>`;
  const rows = summaries.map(s => `<tr>
    <td class="first-col">${s.name}</td>
    <td class="num">${fmt(s.opening)} ${s.unit}${s.opening === 1 ? "" : "s"}</td>
    <td class="num">${fmt(s.used)} ${s.unit}${s.used === 1 ? "" : "s"}</td>
    <td class="num">${fmt(s.closing)} ${s.unit}${s.closing === 1 ? "" : "s"}</td>
  </tr>`).join("");
  return `<table class="report-table">
    <thead><tr><th class="first-col">Description</th><th class="num">Opening Stock</th><th class="num">Amount Used</th><th class="num">Closing Stock</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function initWhatsAppReport() {
  $("#buildReportBtn").addEventListener("click", () => {
    const today = Store.todayStr();
    const card = $("#reportCard");
    const pf = Store.preformDailySummary();

    let html = `<h3 class="report-title">Ithri Fresh Juice — Today's Report</h3>
      <div class="report-date">${today}</div>

      <div class="report-section-title">Fresh Juice — what we started with, used, and have left</div>
      ${fjReportTable()}

      <div class="report-section-title">Raw Materials</div>
      ${materialsReportTable(Store.rawMaterialsDailySummary())}

      <div class="report-section-title">Other Materials</div>
      ${materialsReportTable(Store.otherMaterialsDailySummary())}

      <div class="report-section-title">Preform / Bottle Factory</div>
      <div class="report-line"><span>Preform bags sent to factory today</span><strong>${fmt(pf.sentToday)}</strong></div>
      <div class="report-line"><span>Bottles retrieved from factory today</span><strong>${fmt(pf.receivedToday)}</strong></div>
      <div class="report-line"><span>Preform bags still at factory</span><strong>${fmt(pf.bagsAtFactory)}</strong></div>
    `;

    card.innerHTML = html;
    card.classList.add("show");
    $("#downloadReportBtn").hidden = false;
  });

  $("#downloadReportBtn").addEventListener("click", () => {
    html2canvas($("#reportCard"), { backgroundColor: "#ffffff", scale: 2 }).then(canvas => {
      const link = document.createElement("a");
      link.download = `ithri-report-${Store.todayStr()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
  });

  $("#fjCloseDayBtn").addEventListener("click", () => {
    if (!confirm("Close today's fresh juice figures and roll them into tomorrow's opening stock?")) return;
    Store.allFreshJuiceIds().forEach(id => Store.closeDayFreshJuice(id));
    renderFreshJuiceTable();
    refreshNotificationBadges();
    // Today's report is now stale (figures just rolled to tomorrow) — clear it
    // so the manager isn't tempted to re-send an outdated image.
    $("#reportCard").classList.remove("show");
    $("#reportCard").innerHTML = "";
    $("#downloadReportBtn").hidden = true;
    alert("Today's figures are saved and closed. Tomorrow's opening stock is set.");
  });
}

/* ---------------------------- Records & History -------------------------------------- */

const RECORDS_MAX_DAYS = 62; // longer stretches belong in the Summary sub-tab

function recordsCategoryTables(dateStr, categoryFilter) {
  let html = "";
  if (!categoryFilter || categoryFilter === "freshjuice") {
    html += `<div class="records-category-title">Fresh Juice</div>${fjReportTable(dateStr)}`;
  }
  if (!categoryFilter || categoryFilter === "raw") {
    html += `<div class="records-category-title">Raw Materials</div>${materialsReportTable(Store.rawMaterialsDailySummary(dateStr))}`;
  }
  if (!categoryFilter || categoryFilter === "other") {
    html += `<div class="records-category-title">Other Materials</div>${materialsReportTable(Store.otherMaterialsDailySummary(dateStr))}`;
  }
  return html;
}

function renderRecordsDaily() {
  const container = $("#recordsDaily");
  const categoryFilter = $("#recordsCategoryFilter").value;
  let fromStr = $("#recordsFromDate").value || Store.todayStr();
  let toStr = $("#recordsToDate").value || fromStr;
  if (fromStr > toStr) { const t = fromStr; fromStr = toStr; toStr = t; }

  const days = dateRange(fromStr, toStr);
  if (days.length > RECORDS_MAX_DAYS) {
    container.innerHTML = `<p class="empty-state">That's ${days.length} days — please narrow it to ${RECORDS_MAX_DAYS} days or fewer. For a longer stretch, use the Summary tab instead.</p>`;
    return;
  }

  container.innerHTML = days.slice().reverse().map(d => `
    <div class="day-block">
      <div class="day-header">${formatDateLabel(d)}</div>
      ${recordsCategoryTables(d, categoryFilter)}
      <div class="day-end">— end of ${formatDateLabel(d)} —</div>
    </div>
  `).join("");
}

function summaryFjTable(fromStr, toStr) {
  const rows = Store.freshJuiceRangeSummary(fromStr, toStr);
  if (!rows.length) return "";
  const head = `<th class="first-col">Flavour</th><th class="num">Opening</th><th class="num">Produced</th>
    <th class="num">Supplied</th><th class="num">Expired</th><th class="num">Fermented</th>
    <th class="num">Leaking</th><th class="num">Closing</th>`;
  const body = rows.map(r => {
    if (!r.daysClosed) {
      return `<tr><td class="first-col">${r.name}</td><td class="num" colspan="7">No closed days in this period</td></tr>`;
    }
    return `<tr>
      <td class="first-col">${r.name}</td>
      <td class="num">${fmt(r.opening)}</td><td class="num">${fmt(r.produced)}</td>
      <td class="num">${fmt(r.supplied)}</td><td class="num">${fmt(r.expired)}</td>
      <td class="num">${fmt(r.fermented)}</td><td class="num">${fmt(r.leaking)}</td>
      <td class="num">${fmt(r.closing)}</td>
    </tr>`;
  }).join("");
  return `<div class="table-scroll"><table class="report-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderSummary() {
  const periodType = $("#summaryPeriodType").value;
  const body = $("#summaryBody");
  let fromStr, toStr, label;

  if (periodType === "week") {
    const val = $("#summaryWeekInput").value;
    if (!val) { body.innerHTML = `<p class="empty-state">Pick a week to see its summary.</p>`; return; }
    [fromStr, toStr] = isoWeekToRange(val);
    label = `Week of ${formatDateLabel(fromStr)} – ${formatDateLabel(toStr)}`;
  } else {
    const val = $("#summaryMonthInput").value;
    if (!val) { body.innerHTML = `<p class="empty-state">Pick a month to see its summary.</p>`; return; }
    [fromStr, toStr] = monthToRange(val);
    label = new Date(fromStr + "T00:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
  }

  body.innerHTML = `
    <p class="summary-meta">${label} (${fromStr} to ${toStr})</p>
    <div class="records-category-title">Fresh Juice</div>
    ${summaryFjTable(fromStr, toStr)}
    <div class="records-category-title">Raw Materials</div>
    ${materialsReportTable(Store.rawMaterialsRangeSummary(fromStr, toStr))}
    <div class="records-category-title">Other Materials</div>
    ${materialsReportTable(Store.otherMaterialsRangeSummary(fromStr, toStr))}
  `;
}

// ISO 8601 week number for "today", used only to pre-fill the week picker.
function currentIsoWeekValue() {
  const d = new Date();
  const utcDate = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function initRecordsSubtabs() {
  $$("#recordsSubtabNav .subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("#recordsSubtabNav .subtab-btn").forEach(b => b.classList.toggle("active", b === btn));
      $$(".subtab-panel").forEach(p => p.classList.toggle("active", p.id === "subpanel-" + btn.dataset.subtab));
      if (btn.dataset.subtab === "daily") renderRecordsDaily();
      if (btn.dataset.subtab === "summary") renderSummary();
    });
  });
}

function initSummary() {
  $("#summaryWeekInput").value = currentIsoWeekValue();
  $("#summaryMonthInput").value = Store.todayStr().slice(0, 7);

  $("#summaryPeriodType").addEventListener("change", () => {
    const isWeek = $("#summaryPeriodType").value === "week";
    $("#summaryWeekInput").hidden = !isWeek;
    $("#summaryMonthInput").hidden = isWeek;
    renderSummary();
  });
  $("#summaryWeekInput").addEventListener("change", renderSummary);
  $("#summaryMonthInput").addEventListener("change", renderSummary);
}

function initRecords() {
  const today = Store.todayStr();
  $("#recordsFromDate").value = today;
  $("#recordsToDate").value = today;

  $("#recordsFromDate").addEventListener("change", renderRecordsDaily);
  $("#recordsToDate").addEventListener("change", renderRecordsDaily);
  $("#recordsCategoryFilter").addEventListener("change", renderRecordsDaily);
  $("#recordsResetBtn").addEventListener("click", () => {
    $("#recordsFromDate").value = Store.todayStr();
    $("#recordsToDate").value = Store.todayStr();
    $("#recordsCategoryFilter").value = "";
    renderRecordsDaily();
  });

  initRecordsSubtabs();
  initSummary();
}

/* ---------------------------- Sync status -------------------------------------- */

function setSyncStatus(text, kind) {
  const el = $("#syncStatus");
  el.textContent = text;
  el.classList.remove("ok", "error");
  if (kind) el.classList.add(kind);
}

/* ---------------------------- Boot -------------------------------------- */

function renderEverything() {
  populateSelectors();
  renderFreshJuiceTable();
  renderRawCards();
  renderOtherCards();
  $("#preformAtFactory").textContent = fmt(Store.state.preform.bagsAtFactory);
  refreshNotificationBadges();
}

async function init() {
  initTabs();
  initFreshJuice();
  initRawMaterials();
  initOtherMaterials();
  initPreform();
  initSettings();
  initWhatsAppReport();
  initRecords();

  Store.setSaveHandlers({
    onOk: () => setSyncStatus("Saved to Firebase", "ok"),
    onError: () => setSyncStatus("Offline — saved on this device only", "error")
  });

  setSyncStatus("Loading your saved stock…");
  const loaded = await Store.loadState();
  renderEverything();
  if (loaded) setSyncStatus("Saved to Firebase", "ok");
}

document.addEventListener("DOMContentLoaded", init);
