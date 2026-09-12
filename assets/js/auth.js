/* =====================================================================
   BEAST RENTALS — AUTHENTICATION MODULE
   Handles: signup, login, logout, password reset, auth-state guards.

   NOTE ON SERIAL NUMBERS:
   Serial numbers are allocated via a Firestore transaction against
   counters/serial, run directly from the client. Firestore
   transactions are atomic even across concurrent signups, and
   firestore.rules restricts writes to this document to exactly +1
   increments (see the counters/{counterId} rule), so a signed-in user
   cannot skip numbers or collide with another user's allocation.
===================================================================== */

import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, setDoc, getDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------------------------------------------------------------
   SERIAL NUMBER ALLOCATION — atomic Firestore transaction.
--------------------------------------------------------------- */
async function allocateSerialNumber() {
  const counterRef = doc(db, "counters", "serial");
  const serial = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? snap.data().value : 0;
    const next = current + 1;
    tx.set(counterRef, { value: next }, { merge: true });
    return `BR-${String(next).padStart(6, "0")}`;
  });
  return serial;
}

/* ---------------------------------------------------------------
   SIGN UP
--------------------------------------------------------------- */
async function createUserRecords({ uid, name, email, phone, type, unitNumber }) {
  // Idempotent by design: if this runs again for a partial/interrupted
  // signup (see the recovery path in registerUser below), it must NOT
  // allocate a second serial number or clobber a doc that actually did
  // save on a prior attempt.
  const userRef = doc(db, "users", uid);
  const existingUserSnap = await getDoc(userRef);

  let serial;
  if (existingUserSnap.exists()) {
    serial = existingUserSnap.data().serialNumber;
  } else {
    serial = await allocateSerialNumber();
    await setDoc(userRef, {
      uid,
      name,
      email,
      phone,
      type,                 // "SHOP" | "FARM"
      unitNumber,            // shop number or farm number
      serialNumber: serial,
      role: "user",
      status: "active",
      createdAt: serverTimestamp()
    });
  }

  // Initial (unpaid) rental record — activation happens only after a
  // verified Paystack payment via Cloud Function, per spec section 18-20.
  const rentalRef = doc(db, "rentals", uid);
  const existingRentalSnap = await getDoc(rentalRef);
  if (!existingRentalSnap.exists()) {
    await setDoc(rentalRef, {
      userId: uid,
      serialNumber: serial,
      type,
      unitNumber,
      status: "pending_payment",
      startDate: null,
      expiryDate: null,
      createdAt: serverTimestamp()
    });
  }

  return serial;
}

export async function registerUser({ name, type, unitNumber, phone, email, password }) {
  let cred;

  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, { displayName: name });
  } catch (err) {
    if (err.code !== "auth/email-already-in-use") throw err;

    // RECOVERY PATH: this email already has a Firebase Auth account.
    // That can legitimately mean "already fully registered" — but it
    // can also mean a PREVIOUS signup attempt got partway through
    // (Auth account created) and then failed before the Firestore
    // profile was written (e.g. a rules/permission error, a dropped
    // connection). Without this check, that user is permanently stuck:
    // they can never re-run signup (email taken) and never had a
    // working account (no Firestore doc). So: try signing in with the
    // password they just typed, and if that succeeds AND there's no
    // Firestore profile yet, treat this as "finish the interrupted
    // signup" rather than a hard failure.
    let signInCred;
    try {
      signInCred = await signInWithEmailAndPassword(auth, email, password);
    } catch {
      // Wrong password (or some other issue) for an existing account —
      // this really is "email already registered", not a partial signup.
      throw err;
    }

    const existing = await getDoc(doc(db, "users", signInCred.user.uid));
    if (existing.exists()) {
      // Fully registered already — surface the original, accurate error.
      throw err;
    }

    cred = signInCred; // fall through to (re-)create the Firestore records below
  }

  // No email verification step — intentionally skipped for now
  // (to be added later). Accounts are usable immediately.
  const serial = await createUserRecords({ uid: cred.user.uid, name, email, phone, type, unitNumber });

  return { uid: cred.user.uid, serial };
}

/* ---------------------------------------------------------------
   GOOGLE SIGN-IN
   =================================================================
   Used for both login.html and signup.html — same popup flow either
   way. Google-authenticated accounts skip password creation and skip
   email verification entirely (Google-verified emails are trusted;
   no separate verification step is triggered here, per current
   requirements — a dedicated verification flow can be layered on
   later without touching this function).

   Because Beast Rentals requires a Type (Shop/Farm) and unit number
   that Google doesn't provide, a brand-new Google sign-in does NOT
   auto-create a rental account. Instead this returns `isNewUser` so
   the calling page can redirect to complete-profile.html to collect
   those details before the user record is created.
--------------------------------------------------------------- */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  const user = cred.user;

  const existingDoc = await getDoc(doc(db, "users", user.uid));
  const isNewUser = !existingDoc.exists();

  return { user, isNewUser, profile: existingDoc.exists() ? existingDoc.data() : null };
}

// Called from complete-profile.html once a first-time Google user has
// supplied Type / Unit Number / Phone. The Firebase Auth account
// already exists (created by the Google popup) — this just finishes
// creating the matching Firestore user + rental records.
export async function completeGoogleProfile({ type, unitNumber, phone }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");

  const already = await getDoc(doc(db, "users", user.uid));
  if (already.exists()) return { uid: user.uid, serial: already.data().serialNumber, alreadyExisted: true };

  const serial = await createUserRecords({
    uid: user.uid,
    name: user.displayName || "New User",
    email: user.email,
    phone,
    type,
    unitNumber
  });

  return { uid: user.uid, serial };
}

/* ---------------------------------------------------------------
   LOGIN / LOGOUT / RESET
--------------------------------------------------------------- */
export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function logoutUser() {
  await signOut(auth);
  // Send admins back to the admin login, everyone else to the regular
  // login — previously this always redirected to the user login page,
  // even from the admin panel.
  const isAdminContext = window.location.pathname.includes("/admin/");
  window.location.href = isAdminContext ? "/admin/login.html" : "/login.html";
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

/* ---------------------------------------------------------------
   AUTH STATE GUARDS
   Call one of these at the top of a protected page.
--------------------------------------------------------------- */
export function requireAuth(onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/login.html";
      return;
    }
    const snap = await getDoc(doc(db, "users", user.uid));
    onReady(user, snap.exists() ? snap.data() : null);
  });
}

// Verifies the signed-in user has an admin record (admins/{uid}).
// Real authorization is still enforced server-side via Firestore
// Rules + custom claims — this only gates the UI.
export function requireAdmin(onReady) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "/admin/login.html";
      return;
    }
    const adminSnap = await getDoc(doc(db, "admins", user.uid));
    if (!adminSnap.exists()) {
      window.location.href = "/index.html";
      return;
    }
    onReady(user, adminSnap.data());
  });
}

export function watchAuthState(callback) {
  onAuthStateChanged(auth, callback);
}
