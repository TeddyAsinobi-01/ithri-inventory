/* ==========================================================================
   Ithri Inventory — shell: who is logged in, toasts, badges, Save buttons.
   Kept free of any screen-specific code so every screen module can import it.
   ========================================================================== */

import { Store } from "./store.js";
import { $ } from "./util.js";

export const session = { role: null };
export const isManager = () => session.role === "manager";

let toastTimer = null;
export function toast(message, kind = "info") {
  const el = $("#toast");
  if (!el) return;
  el.textContent = message;
  el.className = "toast show " + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 5000);
}

// Screens call this after they change something; main.js re-draws everything.
export function notifyChanged() {
  window.dispatchEvent(new CustomEvent("ithri:changed"));
}

// Bell + tab dot: low stock items and factory losses waiting for approval.
export function refreshBadges() {
  const count = isManager() ? Store.lowStockList().length + Store.pendingDefects().length : 0;
  const badge = $("#notifCount");
  badge.hidden = count === 0;
  badge.textContent = count;
  $("#tabDot").hidden = count === 0;
}

// The "Save" buttons: wait until everything typed so far is safely in Firebase.
export async function saveNow(btn) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.disabled = true;
  btn.textContent = "Saving…";
  const saved = await Store.flushNow();
  btn.textContent = saved ? "Saved ✓" : "Not saved yet — will retry";
  setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1600);
  if (!saved) toast("Couldn't reach the database. Your entries are kept and will save as soon as you're online.", "warn");
  return saved;
}

export function setSyncStatus(text, kind) {
  const el = $("#syncStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "error");
  if (kind) el.classList.add(kind);
}
