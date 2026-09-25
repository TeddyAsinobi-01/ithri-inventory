// Firebase initialization for Ithri Inventory.
// Loaded as an ES module — see the <script type="module"> tag in index.html.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAEVprkRNAahiFzAk1h84Mv3gx3-ugXs3U",
  authDomain: "sithricon-database.firebaseapp.com",
  projectId: "sithricon-database",
  storageBucket: "sithricon-database.firebasestorage.app",
  messagingSenderId: "4738971128",
  appId: "1:4738971128:web:44e7fab34d7534c1c4120d",
  measurementId: "G-BXJTFQ6W23"
};

const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp);

// Analytics is skipped here — it needs the site running on a real http(s)
// host (not a local double-clicked file) and isn't needed for the
// inventory logic. Add it back later with getAnalytics() if you deploy
// the site and want visit/usage stats.
