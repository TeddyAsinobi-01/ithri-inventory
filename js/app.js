/* ==========================================================================
   Ithri Inventory — app entry point
   Boots the store, shows the home screen, applies the logged-in role, wires
   the tabs, and runs the automatic end-of-day close. Each screen lives in its
   own ui-*.js file.
   ========================================================================== */

import { Store } from "./store.js";
import { $, $$ } from "./util.js";
import { session, isManager, toast, refreshBadges, setSyncStatus } from "./shell.js";
import { savedRole, rememberRole, showHome, hideHome, initHome } from "./auth.js";
import { initFresh, renderFresh } from "./ui-fresh.js";
import { initMaterials, renderMaterials, populateMaterialSelects, applyRoleToMaterials } from "./ui-materials.js";
import { initManager, renderManager } from "./ui-manager.js";
import { initSettings, populateSettingsSelects, renderSettings } from "./ui-settings.js";
import { initRecords, renderRecords, resetRecordsFilters } from "./ui-records.js";

const DEFAULT_TAB = { staff: "freshjuice", manager: "overview" };
const ROLE_NAME = { staff: "Inventory Staff", manager: "Inventory Manager" };

let activeTab = null;
let loaded = false;
let saveError = false;
let lastListSig = "";
let knownPending = new Set();

/* ------------------------------ roles & tabs ------------------------------- */

const allowed = (el, role) => (el.dataset.roles || "").split(/\s+/).includes(role);

function applyRole(role) {
  session.role = role;
  document.body.dataset.role = role;
  $$("[data-roles]").forEach(el => { el.hidden = !allowed(el, role); });
  $("#roleBadge").textContent = ROLE_NAME[role];
  applyRoleToMaterials();
}

function switchTab(tab) {
  const btn = $(`.tab-btn[data-tab="${tab}"]`);
  if (!btn || btn.hidden) return;
  activeTab = tab;
  $$(".tab-btn").forEach(b => b.classList.toggle("active", b === btn));
  $$(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + tab));
  renderAll();
  if (tab === "records") renderRecords();
}

function enterApp(role) {
  applyRole(role);
  hideHome();
  lastListSig = "";
  knownPending = new Set(Store.pendingDefects().map(d => d.id));
  resetRecordsFilters();
  switchTab(DEFAULT_TAB[role]);
}

function logout() {
  rememberRole(null);
  session.role = null;
  activeTab = null;
  document.body.dataset.role = "";
  showHome({ canLogin: true });
}

/* -------------------------------- rendering -------------------------------- */

function listSignature() {
  const s = Store.state;
  return JSON.stringify([
    s.materials.raw.map(m => [m.id, m.name, m.seasonal]),
    s.materials.other.map(m => [m.id, m.name]),
    Store.allFreshJuiceMeta().map(f => [f.id, f.name])
  ]);
}

function renderAll() {
  if (!session.role) return;
  const sig = listSignature();
  if (sig !== lastListSig) {
    lastListSig = sig;
    populateMaterialSelects();
    if (isManager()) populateSettingsSelects();
  }
  renderFresh();
  renderMaterials();
  if (isManager()) {
    renderManager(activeTab);
    if (activeTab === "settings") renderSettings();
  }
  refreshBadges();
}

/* ------------------------------ live updates ------------------------------- */

function onRemoteChange() {
  if (!session.role) return;
  if (isManager()) {
    const now = Store.pendingDefects();
    const fresh = now.filter(d => !knownPending.has(d.id));
    knownPending = new Set(now.map(d => d.id));
    if (fresh.length) {
      const d = fresh[0];
      toast(`New factory loss waiting for your approval: ${d.qty} ${d.flavourName}.`, "warn");
    }
  }
  renderAll();
  if (activeTab === "records") renderRecords();
}

/* ------------------------------- auto close -------------------------------- */

function runAutoClose() {
  if (!loaded) return;
  const result = Store.checkAutoClose();
  if (!result) return;
  if (result === "closed") {
    Store.flushNow();
    if (session.role) toast("The day was closed automatically and its report saved. Opening stock for the new day is set.", "info");
  }
  if (session.role) {
    renderAll();
    if (activeTab === "records") renderRecords();
  }
}

/* ------------------------------- sync status ------------------------------- */

function updateSyncPill() {
  if (saveError) setSyncStatus("Offline — will retry", "error");
  else if (Store.hasPending()) setSyncStatus("Saving…");
  else setSyncStatus("Saved ✓", "ok");
}

/* ---------------------------------- boot ----------------------------------- */

async function boot() {
  showHome({ message: "Connecting to the database…", canLogin: false });
  const res = await Store.loadState();
  if (!res.ok) {
    showHome({ message: "Can't reach the database. Check the internet connection, then try again.", canLogin: false, retry: true });
    return;
  }
  loaded = true;
  // If nobody had the site open at the end of the last working day, close that
  // day now — before anyone can log in and start entering the new day.
  runAutoClose();
  const role = savedRole();
  if (role) enterApp(role);
  else showHome({ canLogin: true });
  updateSyncPill();
}

function init() {
  initHome(enterApp);
  $$(".tab-btn").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  $("#notifBellBtn").addEventListener("click", () => switchTab("notifications"));
  $("#logoutBtn").addEventListener("click", logout);
  $("#homeRetryBtn").addEventListener("click", boot);

  initFresh();
  initMaterials();
  initManager();
  initSettings();
  initRecords();

  window.addEventListener("ithri:changed", () => {
    renderAll();
    if (activeTab === "records") renderRecords();
  });
  window.addEventListener("ithri:goto", e => switchTab(e.detail));

  Store.onRemoteChange(onRemoteChange);
  Store.setSaveHandlers({
    onOk: () => { saveError = false; updateSyncPill(); },
    onError: () => { saveError = true; updateSyncPill(); }
  });
  setInterval(updateSyncPill, 1000);

  setInterval(runAutoClose, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) runAutoClose(); });
  window.addEventListener("online", runAutoClose);

  // Don't let someone close the tab with entries that haven't reached Firebase.
  window.addEventListener("beforeunload", e => {
    if (Store.hasPending()) { e.preventDefault(); e.returnValue = ""; }
  });

  boot();
}

document.addEventListener("DOMContentLoaded", init);
