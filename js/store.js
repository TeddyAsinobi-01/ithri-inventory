/* ==========================================================================
   Ithri Inventory — Store
   State lives in memory for instant, synchronous UI updates, and is
   mirrored to a single Firestore document (appState/main) so it survives
   reloads and is shared across devices. Every mutating function below
   updates `state` first (so the UI never waits on the network) and then
   schedules a save to Firestore.

   Trade-off worth knowing: everything — stock, fresh juice figures,
   settings, and the activity log — lives in ONE document, capped at the
   last 500 log entries, to stay comfortably under Firestore's 1MB
   per-document limit. That's fine for daily operational use. If you
   later want a full, unlimited audit trail, records should move into
   their own Firestore collection instead of living on this document.
   ========================================================================== */

import { ITHRI_CONFIG } from "./config.js";
import { db } from "./firebase-init.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const STATE_DOC = doc(db, "appState", "main");
const MAX_RECORDS = 500;

function blankFreshJuiceRow() {
  return { opening: 0, forSupply: 0, cooler: 0, supplied: 0, expired: 0, fermented: 0, leaking: 0, produced: 0 };
}

export const Store = (() => {

  function freshMaterialState(m) {
    if (m.hasHalfBag || m.trackedIn === "buckets") return { buckets: 0 };
    if (m.trackedIn === "pieces") return { pieces: 0 };
    return { qty: 0 };
  }

  const state = {
    materials: {
      raw: JSON.parse(JSON.stringify(ITHRI_CONFIG.rawMaterials)),
      other: JSON.parse(JSON.stringify(ITHRI_CONFIG.otherMaterials))
    },
    preformConfig: { ...ITHRI_CONFIG.preform },

    rawStock: {},
    otherStock: {},
    preform: {
      bagsAtFactory: 0,
      bagsSentTotal: 0,
      bottlesReceivedTotal: 0
    },

    freshJuice: {},
    customFlavours: [],

    clearAllUsedOnce: false,

    records: []
  };

  ITHRI_CONFIG.rawMaterials.forEach(m => { state.rawStock[m.id] = freshMaterialState(m); });
  ITHRI_CONFIG.otherMaterials.forEach(m => { state.otherStock[m.id] = freshMaterialState(m); });
  ITHRI_CONFIG.freshJuice.forEach(f => { state.freshJuice[f.id] = blankFreshJuiceRow(); });

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function log(tab, item, action, detail, amount, matId) {
    state.records.unshift({
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      date: todayStr(),
      tab, item, action, detail, amount, matId
    });
    if (state.records.length > MAX_RECORDS) state.records.length = MAX_RECORDS;
  }

  // ---- Firestore sync ------------------------------------------------------

  let persistTimer = null;
  let onSaveError = null;
  let onSaveOk = null;

  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistState, 500);
  }

  async function persistState() {
    try {
      const payload = JSON.parse(JSON.stringify(state));
      await setDoc(STATE_DOC, payload);
      if (onSaveOk) onSaveOk();
    } catch (err) {
      console.error("Ithri Inventory: could not save to Firebase.", err);
      if (onSaveError) onSaveError(err);
    }
  }

  async function loadState() {
    try {
      const snap = await getDoc(STATE_DOC);
      if (snap.exists()) {
        const remote = snap.data();
        Object.assign(state, remote);
        ITHRI_CONFIG.rawMaterials.forEach(m => { if (!(m.id in state.rawStock)) state.rawStock[m.id] = freshMaterialState(m); });
        ITHRI_CONFIG.otherMaterials.forEach(m => { if (!(m.id in state.otherStock)) state.otherStock[m.id] = freshMaterialState(m); });
        ITHRI_CONFIG.freshJuice.forEach(f => { if (!(f.id in state.freshJuice)) state.freshJuice[f.id] = blankFreshJuiceRow(); });
        state.customFlavours = state.customFlavours || [];
        // Backfill the new "leaking" field on rows saved before this update.
        Object.keys(state.freshJuice).forEach(id => {
          if (typeof state.freshJuice[id].leaking !== "number") state.freshJuice[id].leaking = 0;
        });
        return true;
      }
      await persistState();
      return false;
    } catch (err) {
      console.error("Ithri Inventory: could not load from Firebase, starting from blank stock.", err);
      if (onSaveError) onSaveError(err);
      return false;
    }
  }

  function setSaveHandlers({ onOk, onError }) {
    onSaveOk = onOk;
    onSaveError = onError;
  }

  // ---- Raw & other materials: shared helpers -----------------------------

  function findMaterial(id) {
    return state.materials.raw.find(m => m.id === id) ||
           state.materials.other.find(m => m.id === id);
  }

  function stockOf(id) {
    return state.rawStock[id] || state.otherStock[id];
  }

  function addStock(id, baseAmount, detailLabel) {
    const s = stockOf(id);
    const key = Object.keys(s)[0];
    s[key] += baseAmount;
    log(state.rawStock[id] ? "raw" : "other", labelFor(id), "Stock added", detailLabel, baseAmount, id);
    schedulePersist();
    return s[key];
  }

  function useStock(id, baseAmount, detailLabel) {
    const s = stockOf(id);
    const key = Object.keys(s)[0];
    s[key] = Math.max(0, s[key] - baseAmount);
    log(state.rawStock[id] ? "raw" : "other", labelFor(id), "Used", detailLabel, -baseAmount, id);
    schedulePersist();
    return s[key];
  }

  function correctStock(id, newBaseAmount, note) {
    const s = stockOf(id);
    const key = Object.keys(s)[0];
    const before = s[key];
    s[key] = newBaseAmount;
    log(state.rawStock[id] ? "raw" : "other", labelFor(id), "Stock corrected",
        note || `${before} → ${newBaseAmount}`, newBaseAmount - before, id);
    schedulePersist();
    return s[key];
  }

  function labelFor(id) {
    const m = findMaterial(id);
    return m ? m.name : id;
  }

  // ---- Threshold / notification check ------------------------------------

  function bagsFor(m, baseAmount) {
    return m.bagSize ? baseAmount / m.bagSize : null;
  }

  function isBelowThreshold(m) {
    if (m.seasonal || m.noThreshold) return false;
    const s = stockOf(m.id);
    const key = Object.keys(s)[0];
    const amt = s[key];
    if (m.thresholdType === "bags") {
      return bagsFor(m, amt) <= m.threshold;
    }
    return amt <= m.threshold;
  }

  function lowStockList() {
    return [...state.materials.raw, ...state.materials.other].filter(isBelowThreshold);
  }

  // ---- Preform / bottle factory exchange ---------------------------------

  function sendPreformToFactory(bags) {
    state.preform.bagsAtFactory += bags;
    state.preform.bagsSentTotal += bags;
    log("preform", "Preform", "Sent to factory", `${bags} bag(s) of preform`, bags, "preform");
    schedulePersist();
  }

  function receiveBottlesFromFactory(bottlesReceived, bagsBeingClosedOut, actualPerBag) {
    const cfg = state.preformConfig;
    const perBag = actualPerBag || cfg.defaultBottlesPerBottleBag;
    const expectedBottleBags = bagsBeingClosedOut * cfg.bottleBagsPerPreformBag;
    const expectedBottles = expectedBottleBags * cfg.defaultBottlesPerBottleBag;
    state.preform.bagsAtFactory = Math.max(0, state.preform.bagsAtFactory - bagsBeingClosedOut);
    state.preform.bottlesReceivedTotal += bottlesReceived;
    addStock("bottles", bottlesReceived, `Retrieved from bottle factory (${bagsBeingClosedOut} preform bag(s) closed out, ${perBag}/bag)`);
    const outstanding = expectedBottles - bottlesReceived;
    log("preform", "Preform", "Bottles retrieved",
        `${bottlesReceived} bottles for ${bagsBeingClosedOut} preform bag(s) at ${perBag}/bag`, bottlesReceived, "preform");
    schedulePersist();
    return { expectedBottles, outstanding };
  }

  // ---- Fresh juice ---------------------------------------------------------

  function updateFreshJuiceField(id, field, value) {
    if (!(id in state.freshJuice)) return;
    state.freshJuice[id][field] = value;
    if (field === "supplied") {
      log("freshjuice", labelFor2(id), "Supply removed from cooler", "", value, id);
    }
    schedulePersist();
  }

  function labelFor2(id) {
    const f = ITHRI_CONFIG.freshJuice.find(x => x.id === id) ||
      (state.customFlavours || []).find(x => x.id === id);
    return f ? f.name : id;
  }

  function computedFreshJuice(id) {
    const r = state.freshJuice[id];
    const remainingInFreezer = r.opening - r.cooler;
    const notSupplied = r.cooler - r.supplied;
    const totalInFreezer = remainingInFreezer + notSupplied + r.produced;
    return { ...r, remainingInFreezer, notSupplied, totalInFreezer };
  }

  function closeDayFreshJuice(id) {
    const c = computedFreshJuice(id);
    log("freshjuice", labelFor2(id), "Day closed",
        `Closing (total in freezer): ${c.totalInFreezer}`, c.totalInFreezer, id);
    state.freshJuice[id] = { ...blankFreshJuiceRow(), opening: c.totalInFreezer };
    schedulePersist();
  }

  function addFlavour(name) {
    const id = "flavour_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (state.freshJuice[id]) return id;
    state.customFlavours = state.customFlavours || [];
    state.customFlavours.push({ id, name });
    state.freshJuice[id] = blankFreshJuiceRow();
    log("settings", name, "Flavour added", "New fresh juice flavour", "", id);
    schedulePersist();
    return id;
  }

  function allFreshJuiceIds() {
    return [...ITHRI_CONFIG.freshJuice.map(f => f.id), ...(state.customFlavours || []).map(f => f.id)];
  }

  function allFreshJuiceMeta() {
    return [...ITHRI_CONFIG.freshJuice, ...(state.customFlavours || [])];
  }

  // ---- Settings: add material / change threshold -------------------------

  function addMaterial({ name, category, unit, bagSize, thresholdType, threshold, seasonal, hasHalfBag, halfBagSize }) {
    const id = "custom_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_" + Date.now().toString(36);
    const m = { id, name, unit, trackedIn: bagSize ? "buckets" : "units", bagSizeEditable: true, hasHalfBag: !!hasHalfBag, thresholdType: thresholdType || "units", threshold: threshold || 0, seasonal: !!seasonal };
    if (bagSize) m.bagSize = bagSize;
    if (halfBagSize) m.halfBagSize = halfBagSize;
    if (category === "raw") {
      state.materials.raw.push(m);
      state.rawStock[id] = freshMaterialState(m);
    } else {
      state.materials.other.push(m);
      state.otherStock[id] = freshMaterialState(m);
    }
    log("settings", name, "Material added", category, "", id);
    schedulePersist();
    return id;
  }

  function setThreshold(id, threshold) {
    const m = findMaterial(id);
    if (!m) return;
    m.threshold = threshold;
    log("settings", m.name, "Threshold changed", `New threshold: ${threshold}`, threshold, id);
    schedulePersist();
  }

  function setBagSize(id, bagSize) {
    const m = findMaterial(id);
    if (!m || !m.bagSizeEditable) return;
    m.bagSize = bagSize;
    log("settings", m.name, "Bag size changed", `New bag size: ${bagSize}`, bagSize, id);
    schedulePersist();
  }

  function setOpeningStock(freshJuiceId, value) {
    if (!(freshJuiceId in state.freshJuice)) return;
    state.freshJuice[freshJuiceId].opening = value;
    log("settings", labelFor2(freshJuiceId), "Opening stock corrected", "", value, freshJuiceId);
    schedulePersist();
  }

  // ---- Clear all -----------------------------------------------------------

  function clearAll() {
    Object.keys(state.rawStock).forEach(id => {
      const key = Object.keys(state.rawStock[id])[0];
      state.rawStock[id][key] = 0;
    });
    Object.keys(state.otherStock).forEach(id => {
      const key = Object.keys(state.otherStock[id])[0];
      state.otherStock[id][key] = 0;
    });
    Object.keys(state.freshJuice).forEach(id => { state.freshJuice[id] = blankFreshJuiceRow(); });
    state.preform.bagsAtFactory = 0;
    state.preform.bagsSentTotal = 0;
    state.preform.bottlesReceivedTotal = 0;
    state.records = [];
    state.clearAllUsedOnce = true;
    schedulePersist();
  }

  // ---- Daily report summaries ------------------------------------------

  function materialDailySummary(id) {
    const m = findMaterial(id);
    const s = stockOf(id);
    const key = Object.keys(s)[0];
    const closing = s[key];
    const todays = state.records.filter(r => r.date === todayStr() && r.matId === id);
    const totalDelta = todays.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const used = todays.filter(r => r.action === "Used")
      .reduce((sum, r) => sum + Math.abs(Number(r.amount) || 0), 0);
    const opening = closing - totalDelta;
    return { id, name: m.name, unit: m.unit, bagSize: m.bagSize, opening, used, closing };
  }

  function rawMaterialsDailySummary() {
    return state.materials.raw.map(m => materialDailySummary(m.id));
  }

  function otherMaterialsDailySummary() {
    return state.materials.other.map(m => materialDailySummary(m.id));
  }

  function preformDailySummary() {
    const todays = state.records.filter(r => r.date === todayStr() && r.tab === "preform");
    const sentToday = todays.filter(r => r.action === "Sent to factory")
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const receivedToday = todays.filter(r => r.action === "Bottles retrieved")
      .reduce((s, r) => s + (Number(r.amount) || 0), 0);
    return { sentToday, receivedToday, bagsAtFactory: state.preform.bagsAtFactory };
  }

  return {
    state, todayStr, log, findMaterial, stockOf, addStock, useStock, correctStock,
    labelFor, isBelowThreshold, lowStockList, bagsFor,
    sendPreformToFactory, receiveBottlesFromFactory,
    updateFreshJuiceField, computedFreshJuice, closeDayFreshJuice, addFlavour,
    allFreshJuiceIds, allFreshJuiceMeta, labelFor2,
    addMaterial, setThreshold, setBagSize, setOpeningStock, clearAll,
    loadState, persistState, setSaveHandlers,
    materialDailySummary, rawMaterialsDailySummary, otherMaterialsDailySummary, preformDailySummary
  };
})();
