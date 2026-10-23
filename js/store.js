/* ==========================================================================
   Ithri Inventory — Store

   HOW SAVING WORKS (read this before changing anything here)

   Two people use this site at the same time on different devices (staff and
   manager), so the app must never overwrite someone else's entries. To make
   that safe, nothing writes "the whole state" any more. Instead every action
   (use stock, add stock, log a defect, close the day ...) is an OPERATION:

     1. The operation is applied to the local copy straight away, so the
        screen updates instantly.
     2. It is queued, then sent to Firestore inside a TRANSACTION, which
        re-reads the latest saved data, applies the queued operations on top
        of THAT, and writes the result back. Two devices adding and using
        stock at the same moment therefore both count, instead of one
        silently erasing the other.
     3. A live listener pulls other devices' changes in as they happen.

   Each operation carries a unique id and the saved data remembers the most
   recent ids it has applied, so an operation can never be applied twice even
   if a connection drops halfway. Queued operations are also kept in the
   browser's localStorage, so entries made while offline survive a reload.

   WHERE DATA LIVES
   - appState/main      live state: stock, today's fresh juice figures,
                        settings, a short activity log, spoilt/leaking/
                        fermented entries, login hashes.
   - dayReports/<date>  one document per closed day, holding that day's full
                        report (fresh juice table, raw/other materials
                        opening-used-closing, preform, defect entries).
                        Records & History and Summary read these, so history
                        no longer depends on the short activity log.
   ========================================================================== */

import { ITHRI_CONFIG } from "./config.js";
import { db } from "./firebase-init.js";
import {
  doc, collection, getDoc, setDoc, onSnapshot, runTransaction,
  getDocs, query, where, documentId, writeBatch
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const STATE_DOC = doc(db, "appState", "main");
const REPORTS = "dayReports";
const MAX_RECORDS = 500;
const MAX_DEFECTS = 1500;
const DEFECT_KEEP_DAYS = 120;      // older entries live on inside the day reports
const RECORD_KEEP_DAYS = 7;
const MAX_APPLIED_OPS = 300;
const PENDING_KEY = "ithri_pending_ops_v1";
const DISPLAY_FLAGS = ["bagPrimary"]; // material flags that always follow config.js

/* ----------------------------- small helpers ----------------------------- */

const clone = x => JSON.parse(JSON.stringify(x));
const pad2 = n => String(n).padStart(2, "0");

function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function datesBetween(from, to) {
  const out = [];
  let d = from;
  while (d <= to && out.length < 400) { out.push(d); d = addDays(d, 1); }
  return out;
}

const laterOf = (a, b) => (a > b ? a : b);

let ridCounter = 0;
function rid() {
  return Date.now().toString(36) + "_" + (ridCounter++).toString(36) + Math.random().toString(36).slice(2, 6);
}

const sum = (arr, fn) => arr.reduce((t, x) => t + (Number(fn(x)) || 0), 0);

/* ------------------------------ SHA-256 ----------------------------------
   Used only to store login passwords as hashes instead of plain text. Pure
   JavaScript so it works on any host (crypto.subtle needs https/localhost). */

const SHA_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];
const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256Hex(str) {
  const bytes = Array.from(new TextEncoder().encode(str));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000), lo = bitLen >>> 0;
  for (let i = 3; i >= 0; i--) bytes.push((hi >>> (i * 8)) & 255);
  for (let i = 3; i >= 0; i--) bytes.push((lo >>> (i * 8)) & 255);

  let h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + SHA_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h = [(h[0] + a) | 0, (h[1] + b) | 0, (h[2] + c) | 0, (h[3] + d) | 0,
         (h[4] + e) | 0, (h[5] + f) | 0, (h[6] + g) | 0, (h[7] + hh) | 0];
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, "0")).join("");
}

const passwordHash = (role, pw) => sha256Hex("ithri:" + role + ":" + pw);

/* ------------------------- state shape & pure helpers -------------------- */

function freshMaterialState(m) {
  if (m.hasHalfBag || m.trackedIn === "buckets") return { buckets: 0 };
  if (m.trackedIn === "pieces") return { pieces: 0 };
  return { qty: 0 };
}

function blankFreshJuiceRow() {
  return { opening: 0, forSupply: 0, cooler: 0, supplied: 0, produced: 0, writeOff: 0 };
}

function makeInitialState() {
  const s = {
    v: 3,
    rev: 0,
    businessDate: localDateStr(),
    materials: { raw: clone(ITHRI_CONFIG.rawMaterials), other: clone(ITHRI_CONFIG.otherMaterials) },
    preformConfig: { ...ITHRI_CONFIG.preform },
    rawStock: {},
    otherStock: {},
    preform: { bagsAtFactory: 0, bagsSentTotal: 0, bottlesReceivedTotal: 0 },
    freshJuice: {},
    customFlavours: [],
    clearAllUsedOnce: false,
    records: [],
    defects: [],
    lastClose: null,
    auth: { staffHash: null, managerHash: null },
    appliedOps: []
  };
  ITHRI_CONFIG.rawMaterials.forEach(m => { s.rawStock[m.id] = freshMaterialState(m); });
  ITHRI_CONFIG.otherMaterials.forEach(m => { s.otherStock[m.id] = freshMaterialState(m); });
  ITHRI_CONFIG.freshJuice.forEach(f => { s.freshJuice[f.id] = blankFreshJuiceRow(); });
  return s;
}

const configMaterial = id =>
  ITHRI_CONFIG.rawMaterials.find(m => m.id === id) || ITHRI_CONFIG.otherMaterials.find(m => m.id === id);

// Brings ANY saved document (old or new) up to the current shape. Pure and
// idempotent — it runs on every load and inside every save transaction.
function migrate(raw) {
  const s = clone(raw);
  const init = makeInitialState();
  s.v = 3;
  s.rev = s.rev || 0;
  if (!s.businessDate) s.businessDate = init.businessDate;
  if (!s.materials) s.materials = init.materials;
  if (!s.preformConfig) s.preformConfig = init.preformConfig;
  if (!s.rawStock) s.rawStock = {};
  if (!s.otherStock) s.otherStock = {};
  if (!s.preform) s.preform = init.preform;
  if (!s.freshJuice) s.freshJuice = {};
  if (!s.customFlavours) s.customFlavours = [];
  if (!Array.isArray(s.records)) s.records = [];
  if (!Array.isArray(s.defects)) s.defects = [];
  if (!Array.isArray(s.appliedOps)) s.appliedOps = [];
  if (s.lastClose === undefined) s.lastClose = null;
  if (!s.auth) s.auth = { staffHash: null, managerHash: null };

  ITHRI_CONFIG.rawMaterials.forEach(m => { if (!(m.id in s.rawStock)) s.rawStock[m.id] = freshMaterialState(m); });
  ITHRI_CONFIG.otherMaterials.forEach(m => { if (!(m.id in s.otherStock)) s.otherStock[m.id] = freshMaterialState(m); });

  // Display-only flags (like the bag-first card layout) always follow
  // config.js. They used to be frozen into saved data, which is why an
  // earlier "bags first" update never appeared on an existing site.
  [...s.materials.raw, ...s.materials.other].forEach(m => {
    const c = configMaterial(m.id);
    if (!c) return;
    DISPLAY_FLAGS.forEach(k => { if (c[k] !== undefined) m[k] = c[k]; else delete m[k]; });
  });

  const flavourIds = [...ITHRI_CONFIG.freshJuice.map(f => f.id), ...s.customFlavours.map(f => f.id)];
  flavourIds.forEach(id => { if (!s.freshJuice[id]) s.freshJuice[id] = blankFreshJuiceRow(); });
  Object.keys(s.freshJuice).forEach(id => {
    const row = s.freshJuice[id];
    ["opening", "forSupply", "cooler", "supplied", "produced", "writeOff"].forEach(k => {
      if (typeof row[k] !== "number") row[k] = Number(row[k]) || 0;
    });
    // Older versions typed expired / fermented / leaking straight into the
    // table. They are now defect entries, so carry any live numbers across
    // as "from stores" entries (no approval needed) and drop the old fields.
    ["expired", "fermented", "leaking"].forEach(cat => {
      const q = Number(row[cat]);
      if (q > 0) {
        s.defects.unshift({
          id: "mig_" + id + "_" + cat + "_" + s.businessDate,
          ts: Date.now(), date: s.businessDate, flavourId: id, flavourName: flavourNameOf(s, id),
          category: cat, source: "stores", qty: q, status: "noaction", by: "migrated"
        });
      }
      delete row[cat];
    });
  });
  return s;
}

const findMat = (s, id) => s.materials.raw.find(m => m.id === id) || s.materials.other.find(m => m.id === id);
const stockObj = (s, id) => s.rawStock[id] || s.otherStock[id];
const stockKeyOf = (s, id) => Object.keys(stockObj(s, id))[0];
const labelOf = (s, id) => { const m = findMat(s, id); return m ? m.name : id; };
const flavourMeta = s => [...ITHRI_CONFIG.freshJuice, ...(s.customFlavours || [])];
function flavourNameOf(s, id) {
  const f = flavourMeta(s).find(x => x.id === id);
  return f ? f.name : id;
}

function pushRecord(s, rec) {
  s.records.unshift(rec);
  if (s.records.length > MAX_RECORDS) s.records.length = MAX_RECORDS;
}

/* ---------------------- fresh juice & report calculations ---------------- */

// Figures for one flavour on one day. Expired / fermented / leaking come from
// the defect entries (rejected ones don't count). Only APPROVED FACTORY losses
// are taken off the freezer total (row.writeOff) — returns from the stores
// never touch our stock.
function computeFJ(s, id, dateStr) {
  const r = s.freshJuice[id] || blankFreshJuiceRow();
  const split = {};
  ITHRI_CONFIG.DEFECT_CATEGORIES.forEach(c => { split[c.key] = { stores: 0, factory: 0 }; });
  s.defects.forEach(d => {
    if (d.flavourId === id && d.date === dateStr && d.status !== "rejected" && split[d.category] && split[d.category][d.source] !== undefined) {
      split[d.category][d.source] += Number(d.qty) || 0;
    }
  });
  const tot = k => split[k].stores + split[k].factory;
  const remainingInFreezer = r.opening - r.cooler;
  const notSupplied = r.cooler - r.supplied;
  const writeOff = r.writeOff || 0;
  return {
    opening: r.opening, forSupply: r.forSupply, cooler: r.cooler,
    remainingInFreezer, supplied: r.supplied, notSupplied,
    expired: tot("expired"), fermented: tot("fermented"), leaking: tot("leaking"),
    produced: r.produced, writeOff,
    totalInFreezer: remainingInFreezer + notSupplied + r.produced - writeOff,
    split
  };
}

// Opening / used / closing for a material on the OPEN day (closing is simply
// the current stock; opening is worked back from today's logged changes).
function materialLive(s, id, dateStr) {
  const m = findMat(s, id);
  const st = stockObj(s, id);
  const closing = st[Object.keys(st)[0]];
  const todays = s.records.filter(r => r.matId === id && r.date === dateStr && (r.tab === "raw" || r.tab === "other"));
  const delta = sum(todays, r => r.amount);
  const added = sum(todays.filter(r => r.action === "Stock added"), r => r.amount);
  const corrected = sum(todays.filter(r => r.action === "Stock corrected"), r => r.amount);
  const used = sum(todays.filter(r => r.action === "Used"), r => (r.used !== undefined ? r.used : Math.abs(Number(r.amount) || 0)));
  return { id, name: m.name, unit: m.unit, bagSize: m.bagSize, opening: closing - delta, added, used, corrected, closing };
}

function preformLive(s, dateStr) {
  const todays = s.records.filter(r => r.date === dateStr && r.tab === "preform");
  return {
    sentToday: sum(todays.filter(r => r.action === "Sent to factory"), r => r.amount),
    receivedToday: sum(todays.filter(r => r.action === "Bottles retrieved"), r => r.amount),
    bagsAtFactory: s.preform.bagsAtFactory
  };
}

function buildDayReport(s, dateStr, closedBy, closedAtIso) {
  return {
    date: dateStr,
    closedBy: closedBy || null,
    closedAt: closedAtIso || null,
    fj: flavourMeta(s).map(f => ({ id: f.id, name: f.name, row: computeFJ(s, f.id, dateStr) })),
    raw: s.materials.raw.map(m => materialLive(s, m.id, dateStr)),
    other: s.materials.other.map(m => materialLive(s, m.id, dateStr)),
    preform: preformLive(s, dateStr),
    defects: s.defects.filter(d => d.date === dateStr)
  };
}

// Did anything at all happen on this day? Decides whether an automatic close
// has anything to save.
function hasActivity(s, d) {
  if (s.records.some(r => r.date === d && r.action !== "Day closed" && r.tab !== "settings")) return true;
  if (s.defects.some(x => x.date === d)) return true;
  return Object.values(s.freshJuice).some(r => r.forSupply || r.cooler || r.supplied || r.produced || r.writeOff);
}

/* ------------------------------ operations ------------------------------- */
// Every operation is a pure function of (state, args). Anything random or
// time-based (ids, timestamps) is decided BEFORE the operation is queued and
// passed in through args, so replaying it on the server gives the same result.

function opAddStock(s, a) {
  const st = stockObj(s, a.matId);
  if (!st) return;
  const key = Object.keys(st)[0];
  st[key] += a.base;
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: s.rawStock[a.matId] ? "raw" : "other",
    item: labelOf(s, a.matId), action: "Stock added", detail: a.detail, amount: a.base, matId: a.matId
  });
}

function opUseStock(s, a) {
  const st = stockObj(s, a.matId);
  if (!st || !(a.base > 0)) return;
  const key = Object.keys(st)[0];
  const applied = Math.min(st[key], a.base);       // stock never goes below zero
  st[key] -= applied;
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: s.rawStock[a.matId] ? "raw" : "other",
    item: labelOf(s, a.matId), action: "Used", detail: a.detail,
    amount: -applied,          // what actually left the stock
    used: a.base,              // what the staff said was used
    matId: a.matId
  });
}

function opCorrectStock(s, a) {
  const st = stockObj(s, a.matId);
  if (!st) return;
  const key = Object.keys(st)[0];
  const before = st[key];
  st[key] = a.newBase;
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: s.rawStock[a.matId] ? "raw" : "other",
    item: labelOf(s, a.matId), action: "Stock corrected",
    detail: a.note || `${before} → ${a.newBase}`, amount: a.newBase - before, matId: a.matId
  });
}

function opSendPreform(s, a) {
  s.preform.bagsAtFactory += a.bags;
  s.preform.bagsSentTotal += a.bags;
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: "preform", item: "Preform", action: "Sent to factory",
    detail: `${a.bags} bag(s) of preform`, amount: a.bags, matId: "preform"
  });
}

function opReceiveBottles(s, a) {
  const perBag = a.perBag || s.preformConfig.defaultBottlesPerBottleBag;
  s.preform.bagsAtFactory = Math.max(0, s.preform.bagsAtFactory - a.bagsClosed);
  s.preform.bottlesReceivedTotal += a.bottles;
  opAddStock(s, {
    matId: "bottles", base: a.bottles, recId: a.recId,
    detail: `Retrieved from bottle factory (${a.bagsClosed} preform bag(s) closed out, ${perBag}/bag)`
  });
  pushRecord(s, {
    id: a.recId2, date: s.businessDate, tab: "preform", item: "Preform", action: "Bottles retrieved",
    detail: `${a.bottles} bottles for ${a.bagsClosed} preform bag(s) at ${perBag}/bag`, amount: a.bottles, matId: "preform"
  });
}

const FJ_INPUT_FIELDS = ["forSupply", "cooler", "supplied", "produced"];
function opSetFjField(s, a) {
  const r = s.freshJuice[a.id];
  if (!r || !FJ_INPUT_FIELDS.includes(a.field)) return;
  r[a.field] = a.value;
}

function trimDefects(s) {
  const cutoff = addDays(s.businessDate, -DEFECT_KEEP_DAYS);
  s.defects = s.defects.filter(d => d.date >= cutoff || d.status === "pending");
  if (s.defects.length > MAX_DEFECTS) s.defects.length = MAX_DEFECTS;
}

function opLogDefect(s, a) {
  const e = a.entry;
  if (!s.freshJuice[e.flavourId]) return;
  const cat = ITHRI_CONFIG.DEFECT_CATEGORIES.find(c => c.key === e.category);
  if (!cat || !(e.qty > 0) || (e.source !== "stores" && e.source !== "factory")) return;
  s.defects.unshift({
    id: e.id, ts: e.ts, date: s.businessDate, flavourId: e.flavourId,
    flavourName: flavourNameOf(s, e.flavourId), category: e.category, source: e.source,
    qty: e.qty, by: e.by || "staff",
    status: e.source === "factory" ? "pending" : "noaction"
  });
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: "freshjuice", item: flavourNameOf(s, e.flavourId),
    action: cat.label + " logged",
    detail: `${e.qty} ${e.source === "factory" ? "from factory (awaiting approval)" : "from super stores"}`,
    amount: e.qty, matId: e.flavourId
  });
  trimDefects(s);
}

function opDecideDefect(s, a) {
  const d = s.defects.find(x => x.id === a.id);
  if (!d || d.status !== "pending") return;      // already decided elsewhere
  if (a.decision === "approve") {
    d.status = "approved";
    const row = s.freshJuice[d.flavourId];
    if (row) row.writeOff = (row.writeOff || 0) + d.qty;
  } else {
    d.status = "rejected";
  }
  d.decidedAt = a.at;
  d.decidedBy = "manager";
  const cat = ITHRI_CONFIG.DEFECT_CATEGORIES.find(c => c.key === d.category);
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: "freshjuice", item: d.flavourName,
    action: a.decision === "approve" ? "Factory loss approved" : "Factory loss rejected",
    detail: `${d.qty} ${cat ? cat.label.toLowerCase() : d.category}`,
    amount: a.decision === "approve" ? -d.qty : 0, matId: d.flavourId
  });
}

function opRemoveDefect(s, a) {
  const i = s.defects.findIndex(x => x.id === a.id);
  if (i < 0) return;
  const d = s.defects[i];
  if (d.status !== "pending" && d.status !== "noaction") return;   // decided entries stay
  s.defects.splice(i, 1);
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: "freshjuice", item: d.flavourName,
    action: "Defect entry removed", detail: `${d.qty} ${d.category}`, amount: 0, matId: d.flavourId
  });
}

function opAddFlavour(s, a) {
  if (s.freshJuice[a.id]) return;
  s.customFlavours.push({ id: a.id, name: a.name });
  s.freshJuice[a.id] = blankFreshJuiceRow();
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: "settings", item: a.name,
    action: "Flavour added", detail: "New fresh juice flavour", amount: "", matId: a.id
  });
}

function opAddMaterial(s, a) {
  const m = a.material;
  if (findMat(s, m.id)) return;
  if (a.category === "raw") { s.materials.raw.push(m); s.rawStock[m.id] = freshMaterialState(m); }
  else { s.materials.other.push(m); s.otherStock[m.id] = freshMaterialState(m); }
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: "settings", item: m.name,
    action: "Material added", detail: a.category, amount: "", matId: m.id
  });
}

function opSetThreshold(s, a) {
  const m = findMat(s, a.matId);
  if (!m) return;
  m.threshold = a.value;
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: "settings", item: m.name,
    action: "Threshold changed", detail: `New threshold: ${a.value}`, amount: a.value, matId: m.id
  });
}

function opSetBagSize(s, a) {
  const m = findMat(s, a.matId);
  if (!m || !m.bagSizeEditable) return;
  m.bagSize = a.value;
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: "settings", item: m.name,
    action: "Bag size changed", detail: `New bag size: ${a.value}`, amount: a.value, matId: m.id
  });
}

function opSetOpening(s, a) {
  const r = s.freshJuice[a.id];
  if (!r) return;
  r.opening = a.value;
  pushRecord(s, {
    id: a.recId, date: s.businessDate, tab: "settings", item: flavourNameOf(s, a.id),
    action: "Opening stock corrected", detail: "", amount: a.value, matId: a.id
  });
}

function opSetPassword(s, a) {
  if (a.role !== "staff" && a.role !== "manager") return;
  s.auth[a.role + "Hash"] = a.hash;
}

function opClearAll(s, a) {
  Object.keys(s.rawStock).forEach(id => { s.rawStock[id][Object.keys(s.rawStock[id])[0]] = 0; });
  Object.keys(s.otherStock).forEach(id => { s.otherStock[id][Object.keys(s.otherStock[id])[0]] = 0; });
  Object.keys(s.freshJuice).forEach(id => { s.freshJuice[id] = blankFreshJuiceRow(); });
  s.preform.bagsAtFactory = 0; s.preform.bagsSentTotal = 0; s.preform.bottlesReceivedTotal = 0;
  s.records = [];
  s.defects = [];
  s.lastClose = null;
  delete s.freshJuiceHistory;      // legacy field from the previous version
  s.businessDate = a.realToday;
  s.clearAllUsedOnce = true;
}

// Closing a day: save the full report, carry each flavour's closing total
// into tomorrow's opening stock, and move the open day forward. The guard on
// expectedDate makes a double close (two devices at 11:59pm, or a manager
// clicking just as the automatic close fires) harmless — the second is a no-op.
function opCloseDay(s, a, outbox) {
  if (s.businessDate !== a.expectedDate) return;
  const date = s.businessDate;
  outbox.push({ coll: REPORTS, id: date, data: buildDayReport(s, date, a.by, a.nowIso) });
  flavourMeta(s).forEach(f => {
    const c = computeFJ(s, f.id, date);
    pushRecord(s, {
      id: a.recId + "_" + f.id, date, tab: "freshjuice", item: f.name, action: "Day closed",
      detail: `Closing (total in freezer): ${c.totalInFreezer}`, amount: c.totalInFreezer, matId: f.id
    });
    s.freshJuice[f.id] = { ...blankFreshJuiceRow(), opening: c.totalInFreezer };
  });
  s.lastClose = { date, by: a.by, at: a.nowIso };
  s.businessDate = laterOf(addDays(date, 1), a.realToday);
  const keepFrom = addDays(s.businessDate, -RECORD_KEEP_DAYS);
  s.records = s.records.filter(r => r.date >= keepFrom);
  trimDefects(s);
}

// Nothing happened on the open day and the calendar has moved on: just move
// the open day to today (there is nothing worth a report).
function opAdvanceDate(s, a) {
  if (s.businessDate !== a.expectedDate) return;
  s.businessDate = laterOf(addDays(s.businessDate, 1), a.realToday);
}

const OPS = {
  addStock: opAddStock, useStock: opUseStock, correctStock: opCorrectStock,
  sendPreform: opSendPreform, receiveBottles: opReceiveBottles,
  setFjField: opSetFjField, logDefect: opLogDefect, decideDefect: opDecideDefect, removeDefect: opRemoveDefect,
  addFlavour: opAddFlavour, addMaterial: opAddMaterial, setThreshold: opSetThreshold,
  setBagSize: opSetBagSize, setOpening: opSetOpening, setPassword: opSetPassword,
  clearAll: opClearAll, closeDay: opCloseDay, advanceDate: opAdvanceDate
};

function applyOp(s, op, outbox) {
  if (s.appliedOps.includes(op.id)) return;       // never apply the same operation twice
  const fn = OPS[op.type];
  if (!fn) return;
  fn(s, op.args, outbox || []);
  s.appliedOps.push(op.id);
  if (s.appliedOps.length > MAX_APPLIED_OPS) s.appliedOps.splice(0, s.appliedOps.length - MAX_APPLIED_OPS);
}

/* ------------------------------ localStorage ----------------------------- */

function lsGet(k) { try { return typeof localStorage !== "undefined" ? localStorage.getItem(k) : null; } catch { return null; } }
function lsSet(k, v) {
  try {
    if (typeof localStorage === "undefined") return;
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  } catch { /* storage full or blocked — the in-memory queue still works */ }
}

/* =============================== the Store =============================== */

export const Store = (() => {
  const state = makeInitialState();   // the live local copy (same object for the whole session)
  let base = clone(state);            // last copy known to match the database
  let pending = [];                   // operations not yet confirmed saved
  let inflight = 0;                   // how many pending ops are in the current save
  let flushing = false;
  let flushPromise = null;
  let flushTimer = null;
  let retryTimer = null;
  let retryDelay = 5000;
  let lastFlushFailed = false;
  let unsubscribe = null;
  let onSaveOk = null;
  let onSaveError = null;
  const remoteListeners = [];
  const reportCache = new Map();      // date -> report object, or null for "no report that day"

  function replaceState(next) {
    Object.keys(state).forEach(k => delete state[k]);
    Object.assign(state, next);
  }

  // local copy = last known database copy + every operation still waiting to save.
  // Returns true if that changed what's on screen.
  function rebuildLocal() {
    const before = JSON.stringify(state);
    const fresh = clone(base);
    pending.forEach(op => applyOp(fresh, op, []));
    replaceState(fresh);
    return JSON.stringify(state) !== before;
  }

  function notifyRemote(reason) {
    remoteListeners.forEach(cb => { try { cb(reason); } catch (e) { console.error(e); } });
  }

  function savePending() {
    lsSet(PENDING_KEY, pending.length ? JSON.stringify(pending) : null);
  }

  function loadPending() {
    try {
      const raw = lsGet(PENDING_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(o => o && o.id && o.type) : [];
    } catch { return []; }
  }

  function dispatch(type, args) {
    const op = { id: rid(), type, args };
    const last = pending[pending.length - 1];
    // Typing "125" into a cell fires three updates — keep only the last one
    // (but never merge into an operation that is already being saved).
    if (type === "setFjField" && last && pending.length - 1 >= inflight &&
        last.type === "setFjField" && last.args.id === args.id && last.args.field === args.field) {
      last.args.value = args.value;
      opSetFjField(state, args);
      savePending();
      scheduleFlush();
      return last;
    }
    const outbox = [];
    applyOp(state, op, outbox);
    outbox.forEach(o => { if (o.coll === REPORTS) reportCache.set(o.id, o.data); });
    pending.push(op);
    savePending();
    scheduleFlush();
    return op;
  }

  function scheduleFlush(delay = 400) {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = null; flushOnce(); }, delay);
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; flushOnce(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000);
  }

  function flushOnce() {
    if (flushing) return flushPromise;
    if (!pending.length) return Promise.resolve(true);
    flushing = true;
    const batch = pending.slice();
    inflight = batch.length;
    flushPromise = (async () => {
      try {
        const result = await runTransaction(db, async tx => {
          const snap = await tx.get(STATE_DOC);
          const s = snap.exists() ? migrate(snap.data()) : makeInitialState();
          const outbox = [];
          batch.forEach(op => applyOp(s, op, outbox));
          s.rev = (s.rev || 0) + 1;
          tx.set(STATE_DOC, clone(s));
          outbox.forEach(o => tx.set(doc(db, o.coll, o.id), clone(o.data)));
          return s;
        });
        pending.splice(0, inflight);
        base = result;
        const changed = rebuildLocal();
        savePending();
        retryDelay = 5000;
        lastFlushFailed = false;
        if (onSaveOk) onSaveOk();
        if (changed) notifyRemote("flush");
        return true;
      } catch (err) {
        lastFlushFailed = true;
        console.error("Ithri Inventory: could not save to Firebase.", err);
        if (onSaveError) onSaveError(err);
        scheduleRetry();
        return false;
      } finally {
        inflight = 0;
        flushing = false;
        if (pending.length && !lastFlushFailed) scheduleFlush();
      }
    })();
    return flushPromise;
  }

  // Resolves true once everything queued is safely in the database.
  async function flushNow() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    for (let guard = 0; guard < 25; guard++) {
      if (flushing) { await flushPromise; continue; }
      if (!pending.length) return !lastFlushFailed;
      const ok = await flushOnce();
      if (!ok) return false;
    }
    return !lastFlushFailed;
  }

  function startListener() {
    if (unsubscribe) unsubscribe();
    unsubscribe = onSnapshot(STATE_DOC, snap => {
      if (!snap.exists()) return;
      const incoming = migrate(snap.data());
      if ((incoming.rev || 0) < (base.rev || 0)) return;     // an older copy arriving late
      base = incoming;
      if (rebuildLocal()) notifyRemote("snapshot");
    }, err => console.error("Ithri Inventory: live updates stopped.", err));
  }

  async function loadState() {
    try {
      const snap = await getDoc(STATE_DOC);
      if (snap.exists()) {
        base = migrate(snap.data());
      } else {
        base = makeInitialState();
        await setDoc(STATE_DOC, clone(base));
      }
      pending = loadPending();
      rebuildLocal();
      startListener();
      if (pending.length) scheduleFlush(0);
      return { ok: true };
    } catch (err) {
      console.error("Ithri Inventory: could not load from Firebase.", err);
      if (onSaveError) onSaveError(err);
      return { ok: false, error: err };
    }
  }

  function setSaveHandlers({ onOk, onError }) { onSaveOk = onOk; onSaveError = onError; }
  function onRemoteChange(cb) { remoteListeners.push(cb); }
  function hasPending() { return pending.length > 0; }

  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("online", () => { if (pending.length) flushOnce(); });
  }

  /* ----------------------------- login ---------------------------------- */

  function verifyLogin(role, pw) {
    const stored = state.auth && state.auth[role + "Hash"];
    const expected = stored || passwordHash(role, ITHRI_CONFIG.DEFAULT_PASSWORDS[role]);
    return passwordHash(role, String(pw)) === expected;
  }

  function setPassword(role, pw) {
    dispatch("setPassword", { role, hash: passwordHash(role, String(pw)) });
  }

  /* ------------------------- reading materials -------------------------- */

  const findMaterial = id => findMat(state, id);
  const stockOf = id => stockObj(state, id);
  const labelFor = id => labelOf(state, id);
  const bagsFor = (m, amt) => (m.bagSize ? amt / m.bagSize : null);

  function isBelowThreshold(m) {
    if (m.seasonal || m.noThreshold) return false;
    const st = stockOf(m.id);
    const amt = st[Object.keys(st)[0]];
    return m.thresholdType === "bags" ? bagsFor(m, amt) <= m.threshold : amt <= m.threshold;
  }

  function lowStockList() {
    return [...state.materials.raw, ...state.materials.other].filter(isBelowThreshold);
  }

  /* --------------------------- stock actions ---------------------------- */

  const addStock = (id, base, detail) => { dispatch("addStock", { matId: id, base, detail, recId: rid() }); };
  const useStock = (id, base, detail) => { dispatch("useStock", { matId: id, base, detail, recId: rid() }); };
  const correctStock = (id, newBase, note) => { dispatch("correctStock", { matId: id, newBase, note, recId: rid() }); };

  function sendPreformToFactory(bags) { dispatch("sendPreform", { bags, recId: rid() }); }

  function receiveBottlesFromFactory(bottles, bagsClosed, perBag) {
    const cfg = state.preformConfig;
    const per = perBag || cfg.defaultBottlesPerBottleBag;
    const expectedBottles = bagsClosed * cfg.bottleBagsPerPreformBag * cfg.defaultBottlesPerBottleBag;
    dispatch("receiveBottles", { bottles, bagsClosed, perBag: per, recId: rid(), recId2: rid() });
    return { expectedBottles, outstanding: expectedBottles - bottles };
  }

  /* ---------------------------- fresh juice ----------------------------- */

  const updateFreshJuiceField = (id, field, value) => { dispatch("setFjField", { id, field, value }); };
  const computedFreshJuice = id => computeFJ(state, id, state.businessDate);
  const labelFor2 = id => flavourNameOf(state, id);
  const allFreshJuiceMeta = () => flavourMeta(state);
  const allFreshJuiceIds = () => flavourMeta(state).map(f => f.id);

  function logDefect({ flavourId, category, source, qty, by }) {
    const entry = { id: rid(), ts: Date.now(), flavourId, category, source, qty, by };
    dispatch("logDefect", { entry, recId: rid() });
    return entry;
  }
  const decideDefect = (id, decision) =>
    dispatch("decideDefect", { id, decision, at: new Date().toISOString(), recId: rid() });
  const removeDefect = id => dispatch("removeDefect", { id, recId: rid() });
  const pendingDefects = () => state.defects.filter(d => d.status === "pending");

  /* ------------------------------ settings ------------------------------ */

  function addFlavour(name) {
    const id = "flavour_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (state.freshJuice[id]) return id;
    dispatch("addFlavour", { id, name, recId: rid() });
    return id;
  }

  function addMaterial({ name, category, unit, bagSize, thresholdType, threshold, seasonal, hasHalfBag, halfBagSize }) {
    const id = "custom_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_" + Date.now().toString(36);
    const m = {
      id, name, unit, trackedIn: bagSize ? "buckets" : "units", bagSizeEditable: true,
      hasHalfBag: !!hasHalfBag, thresholdType: thresholdType || "units",
      threshold: threshold || 0, seasonal: !!seasonal
    };
    if (bagSize) m.bagSize = bagSize;
    if (halfBagSize) m.halfBagSize = halfBagSize;
    dispatch("addMaterial", { material: m, category, recId: rid() });
    return id;
  }

  const setThreshold = (id, value) => { dispatch("setThreshold", { matId: id, value, recId: rid() }); };
  const setBagSize = (id, value) => { dispatch("setBagSize", { matId: id, value, recId: rid() }); };
  const setOpeningStock = (id, value) => { dispatch("setOpening", { id, value, recId: rid() }); };

  function clearAll() {
    dispatch("clearAll", { realToday: localDateStr() });
  }

  // Also remove every stored day report (Clear all means ALL entries).
  async function clearStoredReports() {
    const snap = await getDocs(collection(db, REPORTS));
    let batch = writeBatch(db);
    let n = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    await batch.commit();
    reportCache.clear();
  }

  /* ------------------------------ day close ----------------------------- */

  // Manual close (the manager's button). Returns false if the open day was
  // already closed (by the automatic close, or on another device).
  function closeDay(by = "manager") {
    const expectedDate = state.businessDate;
    dispatch("closeDay", {
      expectedDate, by, nowIso: new Date().toISOString(), realToday: localDateStr(), recId: rid()
    });
    return state.businessDate !== expectedDate;
  }

  // Called every few seconds by the app. Closes the open day automatically at
  // 11:59pm, or — if nobody had the site open then — the first time anyone
  // opens it afterwards. A day with no activity is simply skipped over.
  function checkAutoClose(now = new Date()) {
    const real = localDateStr(now);
    const bd = state.businessDate;
    if (!bd) return null;
    const nowIso = now.toISOString();
    if (real > bd) {
      if (hasActivity(state, bd)) {
        dispatch("closeDay", { expectedDate: bd, by: "auto", nowIso, realToday: real, recId: rid() });
        return "closed";
      }
      dispatch("advanceDate", { expectedDate: bd, realToday: real });
      return "advanced";
    }
    const ac = ITHRI_CONFIG.AUTO_CLOSE;
    const due = now.getHours() > ac.hour || (now.getHours() === ac.hour && now.getMinutes() >= ac.minute);
    if (real === bd && due && hasActivity(state, bd)) {
      dispatch("closeDay", { expectedDate: bd, by: "auto", nowIso, realToday: real, recId: rid() });
      return "closed";
    }
    return null;
  }

  /* ------------------------------ reports ------------------------------- */

  const todayStr = () => state.businessDate;
  const liveDay = () => buildDayReport(state, state.businessDate, null, null);

  async function fetchReports(from, to) {
    const q = query(collection(db, REPORTS), where(documentId(), ">=", from), where(documentId(), "<=", to));
    const snap = await getDocs(q);
    const found = new Set();
    snap.forEach(d => { reportCache.set(d.id, d.data()); found.add(d.id); });
    // Past days with no report will never get one, so remember that.
    datesBetween(from, to).forEach(d => { if (!found.has(d) && d < state.businessDate) reportCache.set(d, null); });
  }

  // One entry per calendar day: the live figures for the open day, the stored
  // report for closed days, null if no report exists for that day.
  async function loadDays(from, to) {
    const dates = datesBetween(from, to);
    const missing = dates.filter(d => d !== state.businessDate && !reportCache.has(d));
    if (missing.length) await fetchReports(missing[0], missing[missing.length - 1]);
    return dates.map(d => d === state.businessDate
      ? { date: d, live: true, report: buildDayReport(state, d, null, null) }
      : { date: d, live: false, report: reportCache.get(d) || null });
  }

  // Every spoilt/leaking/fermented entry in a date range (live entries plus
  // the copies kept inside older day reports), newest first.
  async function loadDefects(from, to) {
    const days = await loadDays(from, to);
    const map = new Map();
    days.forEach(d => ((d.report && d.report.defects) || []).forEach(e => map.set(e.id, e)));
    state.defects.forEach(e => { if (e.date >= from && e.date <= to) map.set(e.id, e); });
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || (b.ts - a.ts));
  }

  return {
    state, todayStr, realToday: () => localDateStr(),
    findMaterial, stockOf, labelFor, bagsFor, isBelowThreshold, lowStockList,
    addStock, useStock, correctStock, sendPreformToFactory, receiveBottlesFromFactory,
    updateFreshJuiceField, computedFreshJuice, labelFor2, allFreshJuiceMeta, allFreshJuiceIds,
    logDefect, decideDefect, removeDefect, pendingDefects,
    addFlavour, addMaterial, setThreshold, setBagSize, setOpeningStock, clearAll, clearStoredReports,
    closeDay, checkAutoClose, liveDay, loadDays, loadDefects,
    verifyLogin, setPassword,
    loadState, flushNow, onRemoteChange, setSaveHandlers, hasPending,
    _debug: { get base() { return base; }, get pending() { return pending; }, reportCache }
  };
})();
