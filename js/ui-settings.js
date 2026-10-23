/* ==========================================================================
   Ithri Inventory — Settings (manager only)
   ========================================================================== */

import { Store } from "./store.js";
import { ITHRI_CONFIG } from "./config.js";
import { $, fmt, esc, pluralize } from "./util.js";
import { createUnitPicker } from "./ui-materials.js";
import { toast, notifyChanged } from "./shell.js";

let correctPicker;

const allMaterials = () => [...Store.state.materials.raw, ...Store.state.materials.other];

function keep(sel, html) {
  const prev = sel.value;
  sel.innerHTML = html;
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function describeStock(m) {
  const st = Store.stockOf(m.id);
  const amt = st[Object.keys(st)[0]];
  const bags = m.bagSize ? ` (${fmt(Store.bagsFor(m, amt))} bag(s))` : "";
  return `${fmt(amt)} ${pluralize(amt, m.unit)}${bags}`;
}

function syncCorrectForm() {
  const m = Store.findMaterial($("#correctMaterialSelect").value);
  correctPicker.setMaterial(m, { allowBags: true });
  $("#correctCurrent").textContent = m ? `Currently on record: ${describeStock(m)}.` : "";
}

export function populateSettingsSelects() {
  const opts = allMaterials().map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join("");
  keep($("#thresholdMaterialSelect"), opts);
  keep($("#correctMaterialSelect"), opts);
  keep($("#bagSizeMaterialSelect"), allMaterials().filter(m => m.bagSizeEditable)
    .map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join(""));
  keep($("#correctFjSelect"), Store.allFreshJuiceMeta()
    .map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join(""));
  syncCorrectForm();
}

export function renderSettings() {
  const m = Store.findMaterial($("#correctMaterialSelect").value);
  $("#correctCurrent").textContent = m ? `Currently on record: ${describeStock(m)}.` : "";
}

export function initSettings() {
  correctPicker = createUnitPicker($("#correctUnitOptions"), $("#correctNewValue"));
  $("#correctMaterialSelect").addEventListener("change", syncCorrectForm);

  $("#addMaterialBtn").addEventListener("click", () => {
    const name = $("#newMatName").value.trim();
    if (!name) { toast("Enter a material name.", "warn"); return; }
    Store.addMaterial({
      name,
      category: $("#newMatCategory").value,
      unit: $("#newMatUnit").value.trim() || "unit",
      bagSize: Number($("#newMatBagSize").value) || 0,
      thresholdType: $("#newMatThresholdType").value,
      threshold: Number($("#newMatThreshold").value) || 0,
      seasonal: $("#newMatSeasonal").checked
    });
    ["newMatName", "newMatUnit", "newMatBagSize", "newMatThreshold"].forEach(id => { $("#" + id).value = ""; });
    $("#newMatSeasonal").checked = false;
    toast(`${name} added.`, "ok");
    notifyChanged();
  });

  $("#setThresholdBtn").addEventListener("click", () => {
    const id = $("#thresholdMaterialSelect").value;
    const val = Number($("#thresholdNewValue").value);
    if (!id || $("#thresholdNewValue").value === "" || isNaN(val)) { toast("Enter the new threshold.", "warn"); return; }
    Store.setThreshold(id, val);
    $("#thresholdNewValue").value = "";
    toast("Threshold updated.", "ok");
    notifyChanged();
  });

  $("#setBagSizeBtn").addEventListener("click", () => {
    const id = $("#bagSizeMaterialSelect").value;
    const val = Number($("#bagSizeNewValue").value);
    if (!id || !val || val <= 0) { toast("Enter the new bag size.", "warn"); return; }
    Store.setBagSize(id, val);
    $("#bagSizeNewValue").value = "";
    toast("Bag size updated.", "ok");
    notifyChanged();
  });

  // Same bags / half bags / custards choice as when adding stock — but here the
  // number typed is the TOTAL that is really in store, not an amount to add.
  $("#correctStockBtn").addEventListener("click", () => {
    const m = Store.findMaterial($("#correctMaterialSelect").value);
    const r = correctPicker.read({ allowZero: true });
    if (!m || !r) { toast("Enter the correct total amount in stock.", "warn"); return; }
    Store.correctStock(m.id, r.base, $("#correctNote").value.trim());
    correctPicker.reset();
    $("#correctNote").value = "";
    toast(`${m.name} corrected to ${r.detail}.`, "ok");
    notifyChanged();
  });

  $("#correctFjBtn").addEventListener("click", () => {
    const id = $("#correctFjSelect").value;
    const val = Number($("#correctFjValue").value);
    if (!id || $("#correctFjValue").value === "" || isNaN(val) || val < 0) { toast("Enter the correct opening stock.", "warn"); return; }
    Store.setOpeningStock(id, val);
    $("#correctFjValue").value = "";
    toast("Opening stock corrected.", "ok");
    notifyChanged();
  });

  $("#addFlavourBtn").addEventListener("click", () => {
    const name = $("#newFlavourName").value.trim();
    if (!name) { toast("Enter a flavour name.", "warn"); return; }
    Store.addFlavour(name);
    $("#newFlavourName").value = "";
    toast(`${name} added to the fresh juice table.`, "ok");
    notifyChanged();
  });

  $("#pwSaveBtn").addEventListener("click", async () => {
    const role = $("#pwRoleSelect").value;
    const a = $("#pwNew").value, b = $("#pwConfirm").value;
    if (a.length < 4) { toast("Use at least 4 characters for a password.", "warn"); return; }
    if (a !== b) { toast("The two passwords don't match.", "warn"); return; }
    Store.setPassword(role, a);
    await Store.flushNow();
    $("#pwNew").value = ""; $("#pwConfirm").value = "";
    toast(`Password for ${role === "staff" ? "inventory staff" : "the inventory manager"} changed.`, "ok");
  });

  $("#clearAllBtn").addEventListener("click", async () => {
    if (!Store.state.clearAllUsedOnce) {
      if (!confirm("This clears every entry on the site, including all saved day reports. Continue?")) return;
    } else {
      const pw = prompt("This site has already been cleared once. Enter the developer password to clear it again:");
      if (pw === null) return;
      if (pw !== ITHRI_CONFIG.CLEAR_ALL_PASSWORD) { alert("Incorrect password."); return; }
    }
    Store.clearAll();
    await Store.flushNow();
    try {
      await Store.clearStoredReports();
      toast("All entries cleared.", "ok");
    } catch (err) {
      console.error(err);
      toast("Entries cleared, but the saved day reports could not be removed. Try again once you're online.", "warn");
    }
    notifyChanged();
  });
}
