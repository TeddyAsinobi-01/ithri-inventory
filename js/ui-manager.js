/* ==========================================================================
   Ithri Inventory — manager-only screens
   Overview, Notifications (factory-loss approvals + low stock), and the
   WhatsApp report with the "Close today & roll to tomorrow" button.
   ========================================================================== */

import { Store } from "./store.js";
import { $, $$, fmt, esc, pluralize, formatDateLabel, formatDateTime, addDays } from "./util.js";
import { fjTableHtml, materialsTableHtml, defectsTableHtml, preformHtml, categoryLabel, sourceLabel } from "./tables.js";
import { renderFjTable } from "./ui-fresh.js";
import { toast, notifyChanged } from "./shell.js";

const AREA_LABEL = { raw: "Raw materials", other: "Other materials", preform: "Preform", freshjuice: "Fresh juice", settings: "Settings" };

/* ------------------------------ last close text --------------------------- */

function lastClosedText() {
  const lc = Store.state.lastClose;
  if (!lc) return "No day has been closed yet.";
  const who = lc.by === "auto" ? "automatically at the end of the day" : "by the manager";
  return `Last closed: ${formatDateLabel(lc.date)} — ${who} (${formatDateTime(lc.at)}).`;
}

/* -------------------------------- overview -------------------------------- */

export function renderOverview() {
  const live = Store.liveDay();
  $("#overviewDate").innerHTML =
    `Business day: <strong>${formatDateLabel(Store.todayStr())}</strong> — open, not closed yet. ${esc(lastClosedText())}`;

  const pending = Store.pendingDefects().length;
  const banner = $("#overviewPending");
  banner.hidden = pending === 0;
  banner.innerHTML = pending
    ? `⚠️ <strong>${pending}</strong> factory loss${pending === 1 ? " is" : "es are"} waiting for your approval. <button type="button" class="link-btn" data-goto="losses">Review now</button>`
    : "";

  renderFjTable($("#fjOverviewTable"), "view");
  $("#overviewRaw").innerHTML = materialsTableHtml(live.raw, { overview: true });
  $("#overviewOther").innerHTML = materialsTableHtml(live.other, { overview: true });
  $("#overviewPreform").innerHTML = preformHtml(live.preform);

  const day = Store.todayStr();
  const feed = Store.state.records.filter(r => r.date === day && r.action !== "Day closed").slice(0, 40);
  $("#overviewFeed").innerHTML = feed.length
    ? `<table class="report-table"><thead><tr><th>Area</th><th class="first-col">Item</th><th>What happened</th><th>Details</th></tr></thead><tbody>${
        feed.map(r => `<tr><td>${esc(AREA_LABEL[r.tab] || r.tab)}</td><td class="first-col">${esc(r.item)}</td><td>${esc(r.action)}</td><td>${esc(r.detail || "")}</td></tr>`).join("")
      }</tbody></table>`
    : `<p class="empty-state">No entries yet today.</p>`;
}

export function renderUrgentCard(onOverview) {
  const low = Store.lowStockList();
  const card = $("#urgentCard");
  card.hidden = !onOverview || low.length === 0;
  $("#urgentList").innerHTML = low.map(m => `<span>${esc(m.name)}</span>`).join("");
}

/* --------------------- factory losses waiting for approval ------------------ */

// The same Accept / Decline cards appear in Notifications and in Loss Review.
function approvalCardsHtml() {
  const pending = Store.pendingDefects().slice().sort((a, b) => b.ts - a.ts);
  if (!pending.length) return `<p class="empty-state">Nothing is waiting for approval.</p>`;
  return pending.map(d => {
    const total = Store.computedFreshJuice(d.flavourId).totalInFreezer;
    return `<div class="approval-card" data-id="${esc(d.id)}">
      <div class="approval-main">
        <div class="approval-title">${esc(d.flavourName)} — ${esc(categoryLabel(d.category))}</div>
        <div class="approval-qty">${fmt(d.qty)} bottle${d.qty === 1 ? "" : "s"} · ${esc(sourceLabel(d.source))}</div>
        <div class="approval-meta">Reported by ${esc(d.by || "staff")} on ${esc(formatDateLabel(d.date))}. Accepting takes ${fmt(d.qty)} off the freezer total (now ${fmt(total)}).</div>
      </div>
      <div class="approval-actions">
        <button type="button" class="btn btn-primary" data-decide="approve">Accept</button>
        <button type="button" class="btn btn-secondary" data-decide="reject">Decline</button>
      </div>
    </div>`;
  }).join("");
}

export function renderLossReview() {
  $("#lossPendingList").innerHTML = approvalCardsHtml();
  const cutoff = addDays(Store.todayStr(), -30);
  const entries = Store.state.defects
    .filter(d => d.date >= cutoff || d.status === "pending")
    .sort((a, b) => b.date.localeCompare(a.date) || (b.ts - a.ts));
  $("#lossReviewBody").innerHTML = defectsTableHtml(entries, { showDate: true, showBy: true });
}

/* ------------------------------ notifications ------------------------------ */

export function renderNotifications() {
  $("#approvalList").innerHTML = approvalCardsHtml();

  const low = Store.lowStockList();
  $("#notifEmptyState").hidden = low.length !== 0;
  $("#notifCardGrid").innerHTML = low.map(m => {
    const st = Store.stockOf(m.id);
    const amt = st[Object.keys(st)[0]];
    const bags = m.bagSize ? ` · ${fmt(Store.bagsFor(m, amt))} bag(s)` : "";
    return `<div class="mat-card low">
      <h4>${esc(m.name)}</h4>
      <div class="qty">${fmt(amt)} ${pluralize(amt, m.unit)}</div>
      <div class="sub">${bags.replace(/^ · /, "")}${bags ? " · " : ""}threshold: ${m.threshold} ${m.thresholdType}</div>
    </div>`;
  }).join("");
}

/* ------------------------------ WhatsApp report ---------------------------- */

function buildReport() {
  const day = Store.liveDay();
  const date = day.date;
  const entries = Store.state.defects
    .filter(d => d.date === date || d.status === "pending")
    .sort((a, b) => b.ts - a.ts);

  const card = $("#reportCard");
  card.dataset.date = date;
  card.innerHTML = `<h3 class="report-title">Ithri Fresh Juice — Today's Report</h3>
    <div class="report-date">${esc(formatDateLabel(date))}</div>

    <div class="report-section-title">Fresh Juice — what we started with, used, and have left</div>
    ${fjTableHtml(day.fj)}

    <div class="report-section-title">Spoilt, leaking &amp; fermented juice</div>
    ${defectsTableHtml(entries, { showDate: true })}

    <div class="report-section-title">Raw Materials</div>
    ${materialsTableHtml(day.raw)}

    <div class="report-section-title">Other Materials</div>
    ${materialsTableHtml(day.other)}

    <div class="report-section-title">Preform / Bottle Factory</div>
    ${preformHtml(day.preform)}`;
  card.classList.add("show");
  $("#downloadReportBtn").hidden = false;
  // The report is built — nudge the manager to close the day.
  $("#fjCloseDayBtn").classList.add("blink");
}

function clearReport() {
  const card = $("#reportCard");
  card.classList.remove("show");
  card.innerHTML = "";
  delete card.dataset.date;
  $("#downloadReportBtn").hidden = true;
  $("#fjCloseDayBtn").classList.remove("blink");
}

export function renderWhatsApp() {
  $("#lastClosedInfo").textContent = lastClosedText();
  // A report left on screen for a day that has since been closed (here, on
  // another device, or automatically) is stale — never let it be re-sent.
  const card = $("#reportCard");
  if (card.dataset.date && card.dataset.date !== Store.todayStr()) clearReport();
}

async function closeDayClicked() {
  const pending = Store.pendingDefects().length;
  const msg = `Close ${formatDateLabel(Store.todayStr())} and roll to tomorrow?\n\n` +
    `Today's report is saved to the database and today's closing figures become tomorrow's opening stock.` +
    (pending ? `\n\n${pending} factory loss${pending === 1 ? " is" : "es are"} still waiting for your approval. ${pending === 1 ? "It stays" : "They stay"} pending and come off the stock on the day you approve.` : "");
  if (!confirm(msg)) return;

  const btn = $("#fjCloseDayBtn");
  btn.disabled = true;
  const closed = Store.closeDay("manager");
  const saved = await Store.flushNow();
  btn.disabled = false;
  clearReport();
  if (!closed) {
    toast("This day had already been closed (automatically, or on another device).", "warn");
  } else if (!saved) {
    toast("Day closed on this device, but it couldn't reach the database yet. It will save as soon as you're online.", "warn");
  } else {
    toast("Day closed and saved. Tomorrow's opening stock is set.", "ok");
  }
  notifyChanged();
}

export function renderManager(activeTab) {
  renderUrgentCard(activeTab === "overview");
  if (activeTab === "overview") renderOverview();
  if (activeTab === "losses") renderLossReview();
  if (activeTab === "notifications") renderNotifications();
  if (activeTab === "whatsapp") renderWhatsApp();
}

export function initManager() {
  // One handler for the Accept / Decline buttons wherever they are shown.
  [$("#approvalList"), $("#lossPendingList")].forEach(list => list.addEventListener("click", event => {
    const btn = event.target.closest("[data-decide]");
    if (!btn) return;
    const card = btn.closest(".approval-card");
    const entry = Store.state.defects.find(d => d.id === card.dataset.id);
    if (!entry) return;
    const approve = btn.dataset.decide === "approve";
    Store.decideDefect(entry.id, approve ? "approve" : "reject");
    toast(approve
      ? `Accepted: ${fmt(entry.qty)} ${entry.flavourName} taken off the freezer total.`
      : `Declined: ${fmt(entry.qty)} ${entry.flavourName} — stock unchanged.`, "ok");
    notifyChanged();
  }));

  $("#panel-overview").addEventListener("click", event => {
    const link = event.target.closest("[data-goto]");
    if (link) window.dispatchEvent(new CustomEvent("ithri:goto", { detail: link.dataset.goto }));
  });

  $("#buildReportBtn").addEventListener("click", buildReport);
  $("#downloadReportBtn").addEventListener("click", () => {
    html2canvas($("#reportCard"), { backgroundColor: "#ffffff", scale: 2 }).then(canvas => {
      const link = document.createElement("a");
      link.download = `ithri-report-${$("#reportCard").dataset.date || Store.todayStr()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    });
  });
  $("#fjCloseDayBtn").addEventListener("click", closeDayClicked);
}
