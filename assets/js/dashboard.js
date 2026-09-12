/* =====================================================================
   BEAST RENTALS — USER DASHBOARD MODULE
   Shared data-fetching helpers used across the /user/ pages.
===================================================================== */

import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, query, where, orderBy, limit as fbLimit, getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function getSettings() {
  const snap = await getDoc(doc(db, "settings", "general"));
  return snap.exists() ? snap.data() : null;
}

export async function getMyRental(userId) {
  const snap = await getDoc(doc(db, "rentals", userId));
  return snap.exists() ? snap.data() : null;
}

/** Live-updates the rental record so a payment verified in another tab
 *  (or via webhook) reflects immediately without a manual refresh. */
export function watchMyRental(userId, callback) {
  return onSnapshot(doc(db, "rentals", userId), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

export async function getMyTransactions(userId, max = 25) {
  const q = query(
    collection(db, "transactions"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    fbLimit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getMyNotifications(userId, max = 30) {
  const q = query(
    collection(db, "notifications"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    fbLimit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Wires a live countdown into the given DOM elements. Call once per
 *  page load; automatically clears itself when the tab is hidden long
 *  enough that the numbers would be stale, then resumes on focus. */
export function mountCountdown({ expiryDate, els }) {
  function tick() {
    const { days, hours, minutes, seconds, expired } = getCountdownParts(expiryDate);
    if (els.days) els.days.textContent = String(days);
    if (els.hours) els.hours.textContent = pad2(hours);
    if (els.minutes) els.minutes.textContent = pad2(minutes);
    if (els.seconds) els.seconds.textContent = pad2(seconds);
    if (expired && els.onExpired) els.onExpired();
  }
  tick();
  const interval = setInterval(tick, 1000);
  return () => clearInterval(interval);
}
