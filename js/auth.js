/* ==========================================================================
   Ithri Inventory — home screen & login

   IMPORTANT: this is a convenience gate, not real security. The passwords
   are checked in the browser, so someone who knows how to use the browser's
   developer tools can get past it. Real protection needs Firebase
   Authentication plus Firestore security rules (not set up yet).
   ========================================================================== */

import { Store } from "./store.js";
import { ITHRI_CONFIG } from "./config.js";
import { $, $$ } from "./util.js";

const ROLE_KEY = "ithri_role";

// The logged-in role is remembered for this browser tab only (sessionStorage),
// so closing the tab logs out but a page refresh doesn't.
export function savedRole() {
  try {
    const r = sessionStorage.getItem(ROLE_KEY);
    return r === "staff" || r === "manager" ? r : null;
  } catch { return null; }
}

export function rememberRole(role) {
  try {
    if (role) sessionStorage.setItem(ROLE_KEY, role); else sessionStorage.removeItem(ROLE_KEY);
  } catch { /* storage blocked — the session simply won't survive a refresh */ }
}

export function showHome({ message = "", canLogin = true, retry = false } = {}) {
  $("#homeScreen").hidden = false;
  $("#appShell").hidden = true;
  $("#homeStatus").textContent = message;
  $("#homeRetryBtn").hidden = !retry;
  $$(".role-form").forEach(form => {
    $$("input, button", form).forEach(el => { el.disabled = !canLogin; });
    $(".login-error", form).textContent = "";
  });
}

export function hideHome() {
  $("#homeScreen").hidden = true;
  $("#appShell").hidden = false;
}

export function initHome(onLogin) {
  $$(".role-form").forEach(form => {
    form.addEventListener("submit", event => {
      event.preventDefault();
      const role = form.dataset.role;
      const input = $(".pw", form);
      if (Store.verifyLogin(role, input.value)) {
        input.value = "";
        $(".login-error", form).textContent = "";
        rememberRole(role);
        onLogin(role);
      } else {
        $(".login-error", form).textContent = "Wrong password. Please try again.";
        input.select();
      }
    });
  });

  // Safety net if the manager changes a password and then forgets it. Needs the
  // fixed developer password (the same one used by "Clear all entries").
  $("#forgotPwBtn").addEventListener("click", async () => {
    const pw = prompt("Forgot a password? Enter the developer password to put BOTH logins back to their defaults:");
    if (pw === null) return;
    if (pw !== ITHRI_CONFIG.CLEAR_ALL_PASSWORD) { alert("That isn't the developer password."); return; }
    Store.setPassword("staff", ITHRI_CONFIG.DEFAULT_PASSWORDS.staff);
    Store.setPassword("manager", ITHRI_CONFIG.DEFAULT_PASSWORDS.manager);
    await Store.flushNow();
    alert("Both logins are back to their default passwords.");
  });
}
