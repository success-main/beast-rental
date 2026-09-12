/* =====================================================================
   BEAST RENTALS — ADMIN MODULE
   Shared data-fetching + mutation helpers for /admin/ pages.

   ARCHITECTURE NOTE (no server at all): every mutation here runs
   directly from the browser and is enforced by Firestore Security
   Rules (see firebase/firestore.rules — isManagerAdmin/isFinanceAdmin/
   isVerificationAdmin/isSuperAdmin gate each collection). QR
   verification (adminVerifyQr) reuses the exact same client-side
   Firestore lookup as the public verification page (assets/js/qr.js),
   so there's one source of truth for "what does a valid QR look like".
===================================================================== */

import { db, auth } from "./firebase-config.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where,
  orderBy, limit as fbLimit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { verifyQrToken } from "./qr.js";

/* ---------------- Dashboard stats ---------------- */
export async function getDashboardStats() {
  const [usersSnap, rentalsSnap, shopsSnap, farmsSnap, paymentsSnap] = await Promise.all([
    getDocs(collection(db, "users")),
    getDocs(collection(db, "rentals")),
    getDocs(collection(db, "shops")),
    getDocs(collection(db, "farms")),
    getDocs(collection(db, "payments"))
  ]);

  const rentals = rentalsSnap.docs.map(d => d.data());
  const payments = paymentsSnap.docs.map(d => d.data());
  const now = Date.now();

  let active = 0, expiring = 0, expired = 0;
  rentals.forEach(r => {
    if (!r.expiryDate) return;
    const exp = r.expiryDate.toDate ? r.expiryDate.toDate().getTime() : new Date(r.expiryDate).getTime();
    const daysLeft = (exp - now) / 86400000;
    if (daysLeft <= 0) expired++;
    else if (daysLeft <= 30) expiring++;
    else active++;
  });

  const successful = payments.filter(p => p.status === "success");
  const pending = payments.filter(p => p.status === "pending");
  const failed = payments.filter(p => p.status === "failed");

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const sumIn = (list, from) => list.reduce((sum, p) => {
    const d = p.paymentDate?.toDate ? p.paymentDate.toDate() : new Date(p.paymentDate);
    if (from && d < from) return sum;
    return sum + (p.amount || 0);
  }, 0);

  return {
    totalUsers: usersSnap.size,
    activeRentals: active,
    expiringRentals: expiring,
    expiredRentals: expired,
    totalShops: shopsSnap.size,
    totalFarms: farmsSnap.size,
    successfulPayments: successful.length,
    pendingPayments: pending.length,
    failedPayments: failed.length,
    todayRevenue: sumIn(successful, todayStart),
    monthRevenue: sumIn(successful, monthStart),
    totalRevenue: sumIn(successful, null)
  };
}

/* ---------------- Users ---------------- */
export async function listUsers(max = 200) {
  const snap = await getDocs(query(collection(db, "users"), orderBy("createdAt", "desc"), fbLimit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function setUserStatus(userId, status) {
  await updateDoc(doc(db, "users", userId), { status });
  await logActivity(`Admin ${status === "suspended" ? "suspended" : "activated"} user`, userId);
}

/* ---------------- Shops ---------------- */
export async function listShops() {
  const snap = await getDocs(query(collection(db, "shops"), orderBy("shopNumber", "asc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function addShop(data) { return addDoc(collection(db, "shops"), { ...data, createdAt: serverTimestamp() }); }
export async function updateShop(id, data) { return updateDoc(doc(db, "shops", id), data); }
export async function deleteShop(id) { return deleteDoc(doc(db, "shops", id)); }

/* ---------------- Farms ---------------- */
export async function listFarms() {
  const snap = await getDocs(query(collection(db, "farms"), orderBy("farmNumber", "asc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function addFarm(data) { return addDoc(collection(db, "farms"), { ...data, createdAt: serverTimestamp() }); }
export async function updateFarm(id, data) { return updateDoc(doc(db, "farms", id), data); }
export async function deleteFarm(id) { return deleteDoc(doc(db, "farms", id)); }

/* ---------------- Rentals ---------------- */
export async function listRentals(max = 300) {
  const snap = await getDocs(query(collection(db, "rentals"), orderBy("createdAt", "desc"), fbLimit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ---------------- Payments / Transactions ---------------- */
export async function listPayments(max = 300) {
  const snap = await getDocs(query(collection(db, "payments"), orderBy("createdAt", "desc"), fbLimit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function listTransactions(max = 300) {
  const snap = await getDocs(query(collection(db, "transactions"), orderBy("createdAt", "desc"), fbLimit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ---------------- Receipts ---------------- */
export async function listReceipts(max = 300) {
  const snap = await getDocs(query(collection(db, "receipts"), orderBy("createdAt", "desc"), fbLimit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ---------------- QR management ---------------- */
export async function listQrCodes(max = 300) {
  const snap = await getDocs(query(collection(db, "qr_codes"), orderBy("createdAt", "desc"), fbLimit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function generateSecureToken(prefix = "BRV") {
  // Web Crypto API — cryptographically secure randomness, available in
  // every modern browser. Never derived from userId/email/phone.
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}-${b64}`;
}

// Revocation/regeneration write directly to Firestore now — allowed
// only for verification_officer / super_admin per firestore.rules.
export async function revokeQr(userId) {
  await setDoc(doc(db, "qr_codes", userId), { status: "revoked" }, { merge: true });
  await logActivity("Admin revoked QR", userId);
}

export async function regenerateQr(userId) {
  const newToken = generateSecureToken();
  await setDoc(doc(db, "qr_codes", userId), {
    token: newToken, status: "active",
    regeneratedAt: serverTimestamp()
  }, { merge: true });

  await addDoc(collection(db, "notifications"), {
    userId, type: "qr_updated", title: "QR Code Updated",
    message: "Your QR code has been updated.", read: false,
    createdAt: serverTimestamp()
  });

  await logActivity("Admin regenerated QR", userId);
}

// Reuses the exact same client-side Firestore lookup the public
// verification page uses (assets/js/qr.js -> verifyQrToken). Since
// qr_codes now carries the display fields (name/serialNumber/type/
// unitNumber) directly, the admin scanner and public page always show
// identical results with no separate server round-trip.
export async function adminVerifyQr(token) {
  return verifyQrToken(token);
}

/* ---------------- Notifications ---------------- */
export async function sendNotification({ audience, userId, title, message }) {
  let targetUserIds = [];

  if (audience === "individual") {
    const q = query(collection(db, "users"), where("serialNumber", "==", userId), fbLimit(1));
    const snap = await getDocs(q);
    if (snap.empty) throw new Error("User not found.");
    targetUserIds = [snap.docs[0].id];
  } else if (audience === "all") {
    const snap = await getDocs(collection(db, "users"));
    targetUserIds = snap.docs.map(d => d.id);
  } else if (audience === "shop" || audience === "farm") {
    const snap = await getDocs(query(collection(db, "users"), where("type", "==", audience.toUpperCase())));
    targetUserIds = snap.docs.map(d => d.id);
  } else if (audience === "expiring" || audience === "expired") {
    const rentalsSnap = await getDocs(collection(db, "rentals"));
    const now = Date.now();
    rentalsSnap.forEach(docSnap => {
      const r = docSnap.data();
      if (!r.expiryDate) return;
      const exp = r.expiryDate.toDate ? r.expiryDate.toDate().getTime() : new Date(r.expiryDate).getTime();
      const daysLeft = (exp - now) / 86400000;
      if (audience === "expired" && daysLeft <= 0) targetUserIds.push(docSnap.id);
      if (audience === "expiring" && daysLeft > 0 && daysLeft <= 30) targetUserIds.push(docSnap.id);
    });
  } else {
    throw new Error("Unknown audience.");
  }

  // Firestore has no client batch-write helper imported here to keep
  // this simple/robust across many targets — sequential creates are
  // fine at admin-triggered volumes (hundreds, not millions).
  await Promise.all(targetUserIds.map(uid => addDoc(collection(db, "notifications"), {
    userId: uid, type: "manual", title, message, read: false,
    createdAt: serverTimestamp()
  })));

  await logActivity(`Admin sent notification to ${audience}`);
  return { success: true, count: targetUserIds.length };
}

/**
 * Best-effort substitute for a scheduled cron job (there is no server
 * to run one on). Call this once when an admin opens the dashboard —
 * it checks every rental against the configured reminder milestones
 * (60/30/7 days, expired) and sends any that are due, skipping ones
 * already sent (tracked via lastNotificationKey on the rental doc).
 * Throttled to once per browser per calendar day via localStorage so
 * it doesn't redo the same scan on every single page load. This only
 * runs when an admin happens to open the dashboard that day — there is
 * no guarantee of exact daily delivery the way a real cron job gives.
 */
export async function checkAndSendExpiryReminders() {
  const THROTTLE_KEY = "br_last_expiry_check";
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(THROTTLE_KEY) === today) return { skipped: true };

  const settings = await getGeneralSettings();
  const reminderDays = settings?.reminderDays || [60, 30, 7];

  const rentalsSnap = await getDocs(collection(db, "rentals"));
  const now = Date.now();
  let notifCount = 0;

  for (const docSnap of rentalsSnap.docs) {
    const r = docSnap.data();
    if (!r.expiryDate) continue;
    const exp = r.expiryDate.toDate ? r.expiryDate.toDate().getTime() : new Date(r.expiryDate).getTime();
    const daysLeft = Math.ceil((exp - now) / 86400000);

    let notifKey = null, message = null, type = null;
    if (daysLeft <= 0) { notifKey = "expired"; type = "expired"; message = "Your rental has expired."; }
    else if (reminderDays.includes(daysLeft)) { notifKey = `d${daysLeft}`; type = "expiry_warning"; message = `Your rental expires in ${daysLeft} days.`; }

    if (!notifKey || r.lastNotificationKey === notifKey) continue;

    await addDoc(collection(db, "notifications"), {
      userId: docSnap.id, type, title: type === "expired" ? "Rental Expired" : "Rental Expiring Soon",
      message, read: false, createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "rentals", docSnap.id), { lastNotificationKey: notifKey });
    notifCount++;
  }

  localStorage.setItem(THROTTLE_KEY, today);
  return { skipped: false, notificationsSent: notifCount };
}

/* ---------------- Activity logs ---------------- */
export async function logActivity(action, targetId = null) {
  try {
    const uid = auth.currentUser?.uid || null;
    await addDoc(collection(db, "activity_logs"), {
      action, targetId, adminId: uid, createdAt: serverTimestamp()
      // firestore.rules requires adminId == request.auth.uid — setting
      // it explicitly here (rather than leaving it out) is what makes
      // this write actually pass; it was silently failing before.
    });
  } catch (e) { console.warn("Could not log activity", e); }
}
export async function listActivityLogs(max = 100) {
  const snap = await getDocs(query(collection(db, "activity_logs"), orderBy("createdAt", "desc"), fbLimit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ---------------- Administrators ---------------- */
export async function listAdministrators() {
  const snap = await getDocs(collection(db, "admins"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Adding an administrator now requires their Firebase Auth UID
// directly (find it in Firebase Console → Authentication → Users).
// A client SDK can never look up an arbitrary user by email — that
// lookup requires the Admin SDK, which only exists in a trusted
// server context. Without Cloud Functions, "invite by email" isn't
// possible; "add by UID" is the closest safe equivalent.
export async function addAdministratorByUid({ uid, name, email, role }) {
  await setDoc(doc(db, "admins", uid), {
    name, email, role, createdAt: serverTimestamp()
  }, { merge: true });
  await logActivity(`Admin added administrator (${role})`, uid);
}

export async function updateAdministratorRole(adminId, role) {
  await updateDoc(doc(db, "admins", adminId), { role });
  await logActivity(`Admin changed role to ${role}`, adminId);
}

export async function removeAdministrator(adminId) {
  await deleteDoc(doc(db, "admins", adminId));
  await logActivity("Admin removed an administrator", adminId);
}

/* ---------------- Settings ---------------- */
export async function getGeneralSettings() {
  const snap = await getDoc(doc(db, "settings", "general"));
  return snap.exists() ? snap.data() : null;
}
export async function saveGeneralSettings(data) {
  await updateDoc(doc(db, "settings", "general"), data);
  await logActivity("Admin changed settings");
}

/* ---------------- Reports ---------------- */
export async function getRevenueSeries(days = 14) {
  const payments = await listPayments(1000);
  const success = payments.filter(p => p.status === "success");
  const buckets = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  success.forEach(p => {
    const d = p.paymentDate?.toDate ? p.paymentDate.toDate() : new Date(p.paymentDate);
    const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
    if (key in buckets) buckets[key] += (p.amount || 0);
  });
  return Object.entries(buckets).map(([date, amount]) => ({ date, amount }));
}
