/* ==========================================================================
   Ithri Inventory — raw materials, other materials, preform
   - staff: can see what's in store and record what was USED.
   - manager: also records purchases (add stock) and handles the preform /
     bottle-factory exchange.
   ========================================================================== */

import { Store } from "./store.js";
import { $, $$, fmt, esc, pluralize } from "./util.js";
import { session, isManager, toast, saveNow, notifyChanged } from "./shell.js";

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- bags / half bags / custards picker (shared with Settings) ------ */

export function createUnitPicker(boxEl, inputEl) {
  let unit = "manual";
  let mat = null;

  function placeholderFor(key) {
    if (!mat) return "Amount";
    if (key === "bag") return "Number of bags";
    if (key === "halfbag") return "Number of half bags";
    return `Number of ${pluralize(2, mat.unit)}`;
  }

  function setMaterial(m, { allowBags = true } = {}) {
    mat = m;
    unit = "manual";
    boxEl.innerHTML = "";
    if (!m) { inputEl.placeholder = "Amount"; return; }
    if (!allowBags || !m.bagSize) { inputEl.placeholder = placeholderFor("manual"); return; }

    const options = [{ key: "bag", label: "Bags" }];
    if (m.hasHalfBag && m.halfBagSize) options.push({ key: "halfbag", label: "Half bags" });
    options.push({ key: "manual", label: cap(pluralize(2, m.unit)) });

    options.forEach((o, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = o.label;
      b.dataset.unit = o.key;
      if (i === 0) { b.classList.add("selected"); unit = o.key; }
      b.addEventListener("click", () => {
        unit = o.key;
        $$("button", boxEl).forEach(x => x.classList.toggle("selected", x === b));
        inputEl.placeholder = placeholderFor(o.key);
      });
      boxEl.appendChild(b);
    });
    inputEl.placeholder = placeholderFor(unit);
  }

  // -> { amount, base, detail } with base in the material's own unit, or null if the box is empty/invalid.
  function read({ allowZero = false } = {}) {
    if (!mat || inputEl.value === "") return null;
    const amount = Number(inputEl.value);
    if (isNaN(amount) || amount < 0 || (!allowZero && amount === 0)) return null;
    let base = amount;
    let detail = `${fmt(amount)} ${pluralize(amount, mat.unit)}`;
    if (unit === "bag") { base = amount * mat.bagSize; detail = `${fmt(amount)} bag(s)`; }
    else if (unit === "halfbag") { base = amount * mat.halfBagSize; detail = `${fmt(amount)} half bag(s)`; }
    return { amount, base, detail };
  }

  return { setMaterial, read, reset: () => { inputEl.value = ""; } };
}

/* ------------------------------- stock cards ------------------------------ */

function cardHtml(m, category) {
  const st = Store.stockOf(m.id);
  const amt = st[Object.keys(st)[0]];
  const low = Store.isBelowThreshold(m);
  const units = `${fmt(amt)} ${pluralize(amt, m.unit)}`;
  const bags = m.bagSize ? Store.bagsFor(m, amt) : null;

  // Only Tigernut and Dates (bagPrimary in config.js) show the bag count as the
  // big highlighted figure with the custard count small underneath. Everything
  // else (ginger, coconut, ...) shows its own unit count as before.
  if (m.bagSize && m.bagPrimary) {
    return `<div class="mat-card ${low ? "low" : ""}">
      <h4>${esc(m.name)}</h4>
      <div class="qty qty-bags"><span class="qty-num">${fmt(bags)}</span> <span class="qty-unit">${bags === 1 ? "bag" : "bags"}</span></div>
      <div class="sub sub-small">${units} · ${m.bagSize} per bag</div>
    </div>`;
  }
  // Coconut shows the pieces count only (no second line).
  if (m.id === "coconut") {
    return `<div class="mat-card ${low ? "low" : ""}">
    <h4>${esc(m.name)}</h4>
    <div class="qty">${units}</div>
  </div>`;
  }
  const sub = m.bagSize ? `${fmt(bags)} bag(s) · ${m.bagSize} per bag` : (m.seasonal ? "Seasonal" : "");
  return `<div class="mat-card ${low ? "low" : ""}">
    <h4>${esc(m.name)}</h4>
    <div class="qty">${units}</div>
    <div class="sub">${sub}</div>
  </div>`;
}

export function renderMaterials() {
  $("#rawCardGrid").innerHTML = Store.state.materials.raw.map(m => cardHtml(m, "raw")).join("");
  $("#otherCardGrid").innerHTML = Store.state.materials.other.map(m => cardHtml(m, "other")).join("");
  if (isManager()) $("#preformAtFactory").textContent = fmt(Store.state.preform.bagsAtFactory);
}

export function populateMaterialSelects() {
  const keep = (sel, html) => {
    const prev = sel.value;
    sel.innerHTML = html;
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
  };
  keep($("#rawMaterialSelect"), Store.state.materials.raw
    .map(m => `<option value="${esc(m.id)}">${esc(m.name)}${m.seasonal ? " (seasonal)" : ""}</option>`).join(""));
  keep($("#otherMaterialSelect"), Store.state.materials.other
    .map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join(""));
  syncRawForm();
  syncOtherForm();
}

/* --------------------------- role-specific wording ------------------------- */

// Staff can only record usage; the manager can also record purchases.
const actionFor = which => (isManager() ? $(`#${which}ActionSelect`).value : "use");

export function applyRoleToMaterials() {
  const manager = isManager();
  const rawOpts = manager
    ? `<option value="add">Add stock (purchased)</option><option value="use">Record usage (used today)</option>`
    : `<option value="use">Record usage (used today)</option>`;
  const otherOpts = manager
    ? `<option value="add">Add stock (purchased / restocked)</option><option value="use">Record usage / spoilage</option>`
    : `<option value="use">Record usage / spoilage</option>`;
  $("#rawActionSelect").innerHTML = rawOpts;
  $("#otherActionSelect").innerHTML = otherOpts;
  syncRawForm();
  syncOtherForm();
}

/* -------------------------------- raw form -------------------------------- */

let rawPicker, otherPicker;

function syncRawForm() {
  if (!rawPicker) return;
  const m = Store.findMaterial($("#rawMaterialSelect").value);
  const action = actionFor("raw");
  rawPicker.setMaterial(m, { allowBags: action === "add" });
  $("#rawFormTitle").textContent = action === "add" ? "Add stock (purchased)" : "Record what was used today";
  $("#rawSubmitBtn").textContent = action === "add" ? "Add stock" : "Record usage";
}

function stockAmount(id) {
  const st = Store.stockOf(id);
  return st[Object.keys(st)[0]];
}

function confirmOverUse(m, base) {
  const have = stockAmount(m.id);
  if (base <= have) return true;
  return confirm(`The system only has ${fmt(have)} ${pluralize(have, m.unit)} of ${m.name} in stock, and you entered ${fmt(base)}. Record it anyway? (Stock will go to 0.)`);
}

function submitRaw() {
  const m = Store.findMaterial($("#rawMaterialSelect").value);
  const r = rawPicker.read();
  if (!m || !r) { toast("Choose a material and enter an amount above 0.", "warn"); return; }
  if (actionFor("raw") === "add") {
    if (!isManager()) return;
    Store.addStock(m.id, r.base, r.detail);
    toast(`Added ${r.detail} of ${m.name}.`, "ok");
  } else {
    if (!confirmOverUse(m, r.base)) return;
    Store.useStock(m.id, r.base, r.detail + " used today");
    toast(`Recorded: ${r.detail} of ${m.name} used.`, "ok");
  }
  rawPicker.reset();
  notifyChanged();
}

/* ------------------------------- other form ------------------------------- */

function syncOtherForm() {
  if (!otherPicker) return;
  const m = Store.findMaterial($("#otherMaterialSelect").value);
  const action = actionFor("other");
  $("#otherAddFields").hidden = action !== "add";
  $("#otherUseFields").hidden = action !== "use";
  $("#otherFormTitle").textContent = action === "add" ? "Add stock (purchased / restocked)" : "Record what was used today";
  $("#otherSubmitBtn").textContent = action === "add" ? "Add stock" : "Record usage";
  if (!m) return;

  if (action === "add") {
    otherPicker.setMaterial(m, { allowBags: true });
    return;
  }
  const a = $("#otherFieldA"), b = $("#otherFieldB");
  const twoFields = m.dailyMode === "used_spoilt" || m.dailyMode === "used_bad";
  a.placeholder = "Used today";
  b.placeholder = m.dailyMode === "used_bad" ? "Bad / spoilt today" : "Spoilt today";
  b.hidden = !twoFields;
}

function submitOther() {
  const m = Store.findMaterial($("#otherMaterialSelect").value);
  if (!m) return;
  if (actionFor("other") === "add") {
    if (!isManager()) return;
    const r = otherPicker.read();
    if (!r) { toast("Enter an amount above 0.", "warn"); return; }
    Store.addStock(m.id, r.base, r.detail);
    toast(`Added ${r.detail} of ${m.name}.`, "ok");
    otherPicker.reset();
  } else {
    const a = Number($("#otherFieldA").value) || 0;
    const twoFields = m.dailyMode === "used_spoilt" || m.dailyMode === "used_bad";
    const b = twoFields ? (Number($("#otherFieldB").value) || 0) : 0;
    if (a + b <= 0) { toast("Enter an amount used.", "warn"); return; }
    if (!confirmOverUse(m, a + b)) return;
    Store.useStock(m.id, a + b, twoFields ? `Used: ${fmt(a)}, Spoilt/Bad: ${fmt(b)}` : "Used today");
    toast(`Recorded usage of ${m.name}.`, "ok");
    $("#otherFieldA").value = "";
    $("#otherFieldB").value = "";
  }
  notifyChanged();
}

/* --------------------------------- preform -------------------------------- */

function initPreform() {
  $("#preformBagSizeHint").textContent = Store.state.preformConfig.preformBagSize;

  $("#preformSendBtn").addEventListener("click", () => {
    const bags = Number($("#preformSendInput").value);
    if (!bags || bags <= 0) { toast("Enter the number of preform bags sent.", "warn"); return; }
    Store.sendPreformToFactory(bags);
    $("#preformSendInput").value = "";
    toast(`${fmt(bags)} preform bag(s) recorded as sent to the factory.`, "ok");
    notifyChanged();
  });

  $("#preformReceiveBtn").addEventListener("click", () => {
    const bagsClosed = Number($("#preformBagsClosedInput").value);
    const bottlesReceived = Number($("#preformBottlesReceivedInput").value);
    const perBagInput = $("#preformPerBagInput").value;
    const perBag = perBagInput ? Number(perBagInput) : Store.state.preformConfig.defaultBottlesPerBottleBag;
    if (!bagsClosed || $("#preformBottlesReceivedInput").value === "" || bottlesReceived < 0) {
      toast("Enter the preform bags being closed out and the bottles actually received.", "warn");
      return;
    }
    const result = Store.receiveBottlesFromFactory(bottlesReceived, bagsClosed, perBag);
    const box = $("#preformResult");
    box.hidden = false;
    box.innerHTML = `Expected about <strong>${fmt(result.expectedBottles)}</strong> bottles for those preform bags. ` +
      (result.outstanding > 0
        ? `<strong>${fmt(result.outstanding)}</strong> bottle(s) still owed by the factory.`
        : `Full amount received — nothing outstanding.`);
    $("#preformBagsClosedInput").value = "";
    $("#preformBottlesReceivedInput").value = "";
    $("#preformPerBagInput").value = "";
    notifyChanged();
  });
}

/* ---------------------------------- init ---------------------------------- */

export function initMaterials() {
  rawPicker = createUnitPicker($("#rawUnitOptions"), $("#rawAmountInput"));
  otherPicker = createUnitPicker($("#otherUnitOptions"), $("#otherAmountInput"));

  $("#rawMaterialSelect").addEventListener("change", syncRawForm);
  $("#rawActionSelect").addEventListener("change", syncRawForm);
  $("#rawSubmitBtn").addEventListener("click", submitRaw);
  $("#rawSaveBtn").addEventListener("click", () => saveNow($("#rawSaveBtn")));

  $("#otherMaterialSelect").addEventListener("change", syncOtherForm);
  $("#otherActionSelect").addEventListener("change", syncOtherForm);
  $("#otherSubmitBtn").addEventListener("click", submitOther);
  $("#otherSaveBtn").addEventListener("click", () => saveNow($("#otherSaveBtn")));

  initPreform();
}
