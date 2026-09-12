/* =====================================================================
   BEAST RENTALS — RECEIPT MODULE
   Handles fetching a user's receipts, rendering the printable receipt
   card, and converting it to an image via html2canvas for download.
===================================================================== */

import { db } from "./firebase-config.js";
import {
  collection, query, where, orderBy, getDocs, doc, getDoc, limit as fbLimit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function getUserReceipts(userId, max = 50) {
  const q = query(
    collection(db, "receipts"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    fbLimit(max)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getReceiptById(receiptId) {
  const snap = await getDoc(doc(db, "receipts", receiptId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

function computeStatusLabel(rental) {
  if (!rental || !rental.expiryDate) return "NO ACTIVE RENTAL";
  const exp = rental.expiryDate.toDate ? rental.expiryDate.toDate() : new Date(rental.expiryDate);
  return exp.getTime() > Date.now() ? "ACTIVE" : "EXPIRED";
}

/**
 * Public verification — reads Firestore directly from the browser (no
 * server involved, per current project requirements). This only works
 * because firestore.rules makes `receipts` and `rentals` publicly
 * readable — those collections deliberately never contain email/phone
 * (that stays private on `users`), so a public read here doesn't leak
 * anything more sensitive than a printed receipt would.
 */
export async function verifyReceiptPublicly({ receiptNumber, qrToken }) {
  try {
    if (receiptNumber) {
      const snap = await getDoc(doc(db, "receipts", receiptNumber));
      if (!snap.exists()) return { valid: false };
      const r = snap.data();
      const rentalSnap = await getDoc(doc(db, "rentals", r.userId));
      const rental = rentalSnap.exists() ? rentalSnap.data() : null;
      return {
        valid: true,
        serialNumber: r.serialNumber,
        type: r.type,
        unitNumber: r.unitNumber,
        rentalStatus: computeStatusLabel(rental),
        expiryDate: r.rentalExpiryDate ? (r.rentalExpiryDate.toDate ? r.rentalExpiryDate.toDate().toISOString() : r.rentalExpiryDate) : null
      };
    }

    if (qrToken) {
      const q = query(collection(db, "qr_codes"), where("token", "==", qrToken), fbLimit(1));
      const snap = await getDocs(q);
      if (snap.empty) return { valid: false };
      const qrDoc = snap.docs[0];
      if (qrDoc.data().status === "revoked") return { valid: false };
      const qr = qrDoc.data();
      const rentalSnap = await getDoc(doc(db, "rentals", qrDoc.id));
      const rental = rentalSnap.exists() ? rentalSnap.data() : null;
      return {
        valid: true,
        serialNumber: qr.serialNumber,
        type: qr.type,
        unitNumber: qr.unitNumber,
        rentalStatus: computeStatusLabel(rental),
        expiryDate: rental?.expiryDate ? (rental.expiryDate.toDate ? rental.expiryDate.toDate().toISOString() : rental.expiryDate) : null
      };
    }

    return { valid: false };
  } catch (err) {
    console.error("verifyReceiptPublicly failed:", err);
    return { valid: false };
  }
}

/** Ensures html2canvas is loaded once, then returns it. */
function loadHtml2Canvas() {
  return new Promise((resolve, reject) => {
    if (window.html2canvas) { resolve(window.html2canvas); return; }
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    script.onload = () => resolve(window.html2canvas);
    script.onerror = () => reject(new Error("Could not load html2canvas."));
    document.head.appendChild(script);
  });
}

/** Renders the given element to a PNG and triggers a download. */
export async function downloadReceiptAsImage(elementId, filename = "beast-rentals-receipt.png") {
  const html2canvas = await loadHtml2Canvas();
  const el = document.getElementById(elementId);
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

/** Opens the browser print dialog for just the receipt element. */
export function printReceipt(elementId) {
  const el = document.getElementById(elementId);
  const win = window.open("", "_blank", "width=480,height=800");
  win.document.write(`
    <html><head><title>Beast Rentals Receipt</title>
    <link rel="stylesheet" href="${location.origin}/assets/css/style.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
    <style>body{padding:24px;background:#fff;}</style>
    </head><body>${el.outerHTML}</body></html>
  `);
  win.document.close();
  setTimeout(() => { win.print(); }, 400);
}

/** Native share (falls back to copy link) for a receipt verification URL. */
export async function shareReceipt(receiptNumber) {
  const url = `${location.origin}/user/verify-qr.html?receipt=${encodeURIComponent(receiptNumber)}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Beast Rentals Receipt", text: `Verify receipt ${receiptNumber}`, url }); return; }
    catch { /* user cancelled */ }
  }
  copyToClipboard(url);
}
