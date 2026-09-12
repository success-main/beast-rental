/* =====================================================================
   BEAST RENTALS — PAYMENT MODULE (Paystack)
   =====================================================================
   ⚠️ NO SERVER-SIDE VERIFICATION — READ THIS BEFORE RELYING ON IT ⚠️
   By explicit request, this project verifies nothing with Paystack's
   servers. Once the Paystack popup's callback fires, this code trusts
   that the payment happened and activates the rental directly from
   the browser. That means anyone who opens devtools and calls
   activateRentalAfterPayment() themselves gets a free rental — there
   is no way to prevent that without a trusted server checking the
   transaction reference against Paystack's API directly. If fraud
   losses ever become a real problem, the fix is to reintroduce a
   small server-side check (Vercel function, Firebase Cloud Function,
   or any backend) that calls
   https://api.paystack.co/transaction/verify/:reference with your
   SECRET key before writing any of the records below.

   Flow as implemented:
   User clicks Pay -> Paystack Inline popup -> user completes payment
   -> popup calls back with a reference -> this code writes payment,
   transaction, receipt, rental, and QR records directly to Firestore.
===================================================================== */

import { PAYSTACK_PUBLIC_KEY, db, auth } from "./firebase-config.js";
import {
  doc, setDoc, addDoc, collection, getDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/**
 * Loads the Paystack inline script once, then opens the checkout popup.
 * @param {Object} opts
 * @param {string} opts.email
 * @param {number} opts.amountNaira - amount in Naira (converted to kobo here)
 * @param {string} opts.reference - unique client-generated reference
 * @param {Object} opts.metadata - arbitrary metadata (userId, serial, type, unitNumber)
 * @returns {Promise<Object>} paystack response object on success
 */
export function openPaystackCheckout({ email, amountNaira, reference, metadata }) {
  return new Promise((resolve, reject) => {
    function launch() {
      if (!window.PaystackPop) {
        reject(new Error("Paystack script failed to load."));
        return;
      }
      const handler = window.PaystackPop.setup({
        key: PAYSTACK_PUBLIC_KEY,
        email,
        amount: Math.round(amountNaira * 100), // kobo
        currency: "NGN",
        ref: reference,
        metadata,
        callback: function (response) {
          resolve(response);
        },
        onClose: function () {
          reject(new Error("Payment window closed before completion."));
        }
      });
      handler.openIframe();
    }

    if (window.PaystackPop) {
      launch();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.onload = launch;
    script.onerror = () => reject(new Error("Could not load Paystack."));
    document.head.appendChild(script);
  });
}

function generateSecureToken(prefix = "BRV") {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix}-${b64}`;
}

/**
 * Writes payment/transaction/receipt/rental/QR records directly to
 * Firestore after the Paystack popup reports success. See the warning
 * at the top of this file — nothing here is verified against Paystack.
 */
export async function verifyAndActivateRental(reference) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const uid = user.uid;

  const [userSnap, settingsSnap, rentalSnap] = await Promise.all([
    getDoc(doc(db, "users", uid)),
    getDoc(doc(db, "settings", "general")),
    getDoc(doc(db, "rentals", uid))
  ]);
  if (!userSnap.exists()) throw new Error("User record not found.");

  const userData = userSnap.data();
  const settings = settingsSnap.exists() ? settingsSnap.data() : { annualRentalFee: 250, currency: "NGN", rentalDurationDays: 365 };

  const now = new Date();
  const existingRental = rentalSnap.exists() ? rentalSnap.data() : null;
  const currentExpiry = existingRental?.expiryDate?.toDate ? existingRental.expiryDate.toDate() : null;
  const durationDays = settings.rentalDurationDays || 365;

  const startDate = (currentExpiry && currentExpiry > now) ? currentExpiry : now;
  const expiryDate = new Date(startDate.getTime());
  expiryDate.setDate(expiryDate.getDate() + durationDays);
  const rentalStartDate = (currentExpiry && currentExpiry > now) ? (existingRental.startDate || now) : now;

  // Unique receipt number via an atomic client-side counter transaction
  // (same bootstrap-safe pattern as serial number allocation).
  const year = now.getFullYear();
  const receiptCounterRef = doc(db, "counters", `receipt-${year}`);
  const receiptNumber = await runTransaction(db, async (tx) => {
    const snap = await tx.get(receiptCounterRef);
    const current = snap.exists() ? snap.data().value : 0;
    const next = current + 1;
    tx.set(receiptCounterRef, { value: next }, { merge: true });
    return `BR-RCP-${year}-${String(next).padStart(6, "0")}`;
  });

  // Ensure a QR identity exists. Denormalize the display fields
  // (serialNumber/type/unitNumber/name) directly onto the QR record so
  // public verification never needs to read the users collection
  // (which also holds email/phone — kept private).
  const qrRef = doc(db, "qr_codes", uid);
  const qrSnap = await getDoc(qrRef);
  let qrToken = qrSnap.exists() ? qrSnap.data().token : null;
  if (!qrToken || qrSnap.data()?.status === "revoked") {
    qrToken = generateSecureToken();
  }
  await setDoc(qrRef, {
    userId: uid, token: qrToken, status: "active",
    name: userData.name, serialNumber: userData.serialNumber,
    type: userData.type, unitNumber: userData.unitNumber,
    createdAt: qrSnap.exists() ? (qrSnap.data().createdAt || serverTimestamp()) : serverTimestamp()
  }, { merge: true });

  const paymentData = {
    userId: uid,
    serialNumber: userData.serialNumber,
    type: userData.type,
    unitNumber: userData.unitNumber,
    amount: settings.annualRentalFee || 250,
    currency: settings.currency || "NGN",
    paystackReference: reference,
    status: "success",
    paymentDate: serverTimestamp(),
    rentalStartDate,
    rentalExpiryDate: expiryDate,
    receiptNumber,
    createdAt: serverTimestamp()
  };
  await addDoc(collection(db, "payments"), paymentData);

  await addDoc(collection(db, "transactions"), {
    userId: uid,
    amount: paymentData.amount,
    currency: paymentData.currency,
    paystackReference: reference,
    receiptNumber,
    status: "success",
    createdAt: serverTimestamp()
  });

  await setDoc(doc(db, "receipts", receiptNumber), {
    userId: uid,
    receiptNumber,
    name: userData.name,
    serialNumber: userData.serialNumber,
    type: userData.type,
    unitNumber: userData.unitNumber,
    amount: paymentData.amount,
    currency: paymentData.currency,
    paymentDate: serverTimestamp(),
    paystackReference: reference,
    rentalStartDate,
    rentalExpiryDate: expiryDate,
    qrToken,
    createdAt: serverTimestamp()
  });

  await setDoc(doc(db, "rentals", uid), {
    userId: uid,
    serialNumber: userData.serialNumber,
    type: userData.type,
    unitNumber: userData.unitNumber,
    status: "active",
    startDate: rentalStartDate,
    expiryDate,
    createdAt: existingRental?.createdAt || serverTimestamp()
  }, { merge: true });

  await addDoc(collection(db, "notifications"), {
    userId: uid,
    type: "payment_success",
    title: "Payment Successful",
    message: `Your payment of ${paymentData.currency} ${paymentData.amount} was recorded. Receipt ${receiptNumber} is ready.`,
    read: false,
    createdAt: serverTimestamp()
  });

  return { success: true, receiptNumber, rentalExpiryDate: expiryDate.toISOString() };
}

/** Generates a client-side payment reference. */
export function generatePaymentReference(serial) {
  return `BR-${serial}-${Date.now()}`;
}
