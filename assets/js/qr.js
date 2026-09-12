/* =====================================================================
   BEAST RENTALS — QR MODULE
   =====================================================================
   Generation: renders a QR code that encodes ONLY an opaque, random
   verification token (never raw personal data — spec section 27).
   Uses the "qrcode" library (CDN) for rendering, and "html5-qrcode"
   for scanning via the device camera.
===================================================================== */

import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, query, where, getDocs, limit as fbLimit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { existing.addEventListener("load", resolve); if (existing.dataset.loaded) resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => { s.dataset.loaded = "1"; resolve(); };
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Fetches the current user's QR record (token + status) from Firestore.
 *  Users can only read their own qr_codes/{uid} doc per security rules. */
export async function getMyQrRecord(userId) {
  const snap = await getDoc(doc(db, "qr_codes", userId));
  return snap.exists() ? snap.data() : null;
}

/** Renders a QR code into the given container element using the
 *  opaque token only (e.g. "BRV-X82K9F7Q..."). */
export async function renderQrCode(containerId, token) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js");
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  // eslint-disable-next-line no-undef
  new QRCode(el, {
    text: token,
    width: 220,
    height: 220,
    colorDark: "#0b0f0d",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

/** Starts the device camera scanner. onResult receives the decoded
 *  token string. Returns the scanner instance so callers can stop it. */
export async function startQrScanner(elementId, onResult, onError) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js");
  // eslint-disable-next-line no-undef
  const scanner = new Html5Qrcode(elementId);
  const config = { fps: 10, qrbox: { width: 240, height: 240 } };
  await scanner.start(
    { facingMode: "environment" },
    config,
    (decodedText) => onResult(decodedText),
    (errorMessage) => { if (onError) onError(errorMessage); }
  );
  return scanner;
}

export async function stopQrScanner(scanner) {
  if (scanner) { try { await scanner.stop(); await scanner.clear(); } catch { /* already stopped */ } }
}

function computeStatusLabel(rental) {
  if (!rental || !rental.expiryDate) return "NO ACTIVE RENTAL";
  const exp = rental.expiryDate.toDate ? rental.expiryDate.toDate() : new Date(rental.expiryDate);
  return exp.getTime() > Date.now() ? "ACTIVE" : "EXPIRED";
}

/**
 * Verifies a scanned QR token by reading Firestore directly from the
 * browser — no server involved, per current project requirements.
 * `qr_codes` is publicly readable and carries only serialNumber/type/
 * unitNumber/name (never email/phone, which stay private on `users`),
 * so this doesn't expose anything more sensitive than a printed QR
 * badge would.
 */
export async function verifyQrToken(token) {
  try {
    const q = query(collection(db, "qr_codes"), where("token", "==", token), fbLimit(1));
    const snap = await getDocs(q);
    if (snap.empty) return { valid: false };
    const qrDoc = snap.docs[0];
    if (qrDoc.data().status === "revoked") return { valid: false };
    const qr = qrDoc.data();

    const rentalSnap = await getDoc(doc(db, "rentals", qrDoc.id));
    const rental = rentalSnap.exists() ? rentalSnap.data() : null;

    return {
      valid: true,
      name: qr.name,
      serialNumber: qr.serialNumber,
      type: qr.type,
      unitNumber: qr.unitNumber,
      rentalStatus: computeStatusLabel(rental),
      expiryDate: rental?.expiryDate ? (rental.expiryDate.toDate ? rental.expiryDate.toDate().toISOString() : rental.expiryDate) : null
    };
  } catch (err) {
    console.error("verifyQrToken failed:", err);
    return { valid: false };
  }
}
