/* =====================================================================
   BEAST RENTALS — FIREBASE CONFIGURATION
   =====================================================================
   Loaded via Firebase's modular v10 SDK (CDN, type="module").

   ARCHITECTURE NOTE: this app has no server component at all — no
   Cloud Functions, no serverless functions anywhere. Everything
   (signup, serial numbers, payments, QR codes, admin actions,
   notifications) runs directly from the browser via Firestore,
   protected entirely by firebase/firestore.rules.

   The unavoidable consequence: nothing verifies a Paystack payment
   against Paystack's own servers before activating a rental — see the
   warning at the top of README.md and in assets/js/payment.js for what
   that tradeoff means and how to add a trusted server back later if
   fraud losses ever become a concern.

   IMPORTANT — READ BEFORE DEPLOYING:
   - The values below are PUBLIC web config values (apiKey here is NOT a
     secret — it identifies your Firebase project to Google's servers;
     actual access is enforced by Firestore/Storage Security Rules).
   - Do not add a Paystack SECRET key or a Firebase service-account
     JSON anywhere in this project — there is no server to hold them
     safely, and this frontend code is visible to every visitor.

   ⚠️ LIVE PAYSTACK KEY WARNING
   The Paystack public key below is a LIVE key (pk_live_...), not a test
   key. Any payment made through this app while this key is active will
   attempt to charge a real card / move real money.
   For local testing, swap this for your Paystack TEST public key
   (starts with pk_test_) from Paystack Dashboard → Settings → API Keys.
===================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAnalytics,
  isSupported as analyticsIsSupported
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  getAuth,
  connectAuthEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  connectFirestoreEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  connectStorageEmulator
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// -------------------------------------------------------------------
// 1. YOUR FIREBASE WEB CONFIG
// -------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyDxKzsArKuZUa6g5CPxrzeIdu2bwFpmX_0",
  authDomain: "beast-rentals.firebaseapp.com",
  databaseURL: "https://beast-rentals-default-rtdb.firebaseio.com",
  projectId: "beast-rentals",
  storageBucket: "beast-rentals.firebasestorage.app",
  messagingSenderId: "214277836416",
  appId: "1:214277836416:web:25efca405e82befa1d2065",
  measurementId: "G-7J7RHFL98J"
};

// -------------------------------------------------------------------
// 2. PAYSTACK PUBLIC KEY — safe for the frontend (public key only!)
//    ⚠️ This is a LIVE key — see warning above before testing payments.
// -------------------------------------------------------------------
export const PAYSTACK_PUBLIC_KEY = "pk_live_b5274fba1e8186ddcaf4bd07b299c36047bae99f";

// -------------------------------------------------------------------
// 3. Toggle to true while developing against local Firebase emulators
//    (Auth/Firestore/Storage only — there is no Functions emulator to
//    connect to anymore; run `vercel dev` separately to test /api).
// -------------------------------------------------------------------
const USE_EMULATORS = false;

// -------------------------------------------------------------------
// Init
// -------------------------------------------------------------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Analytics only initializes in browsers that support it (it throws in
// some contexts — private browsing, unsupported browsers, non-HTTPS
// localhost — so this is guarded rather than called unconditionally).
let analytics = null;
analyticsIsSupported().then((supported) => {
  if (supported) analytics = getAnalytics(app);
}).catch(() => { /* analytics unsupported in this environment — safe to ignore */ });

if (USE_EMULATORS) {
  connectAuthEmulator(auth, "http://localhost:9099");
  connectFirestoreEmulator(db, "localhost", 8080);
  connectStorageEmulator(storage, "localhost", 9199);
}

export { app, auth, db, storage, analytics };

// -------------------------------------------------------------------
// Business constants shared across the app (mirrors settings/general
// in Firestore — dashboards should prefer the live Firestore value
// and fall back to these only before that document has loaded).
// -------------------------------------------------------------------
export const DEFAULT_SETTINGS = {
  businessName: "Beast Rentals",
  currency: "NGN",
  annualRentalFee: 250,
  rentalDurationDays: 365,
  thresholds: {
    greenMinDays: 60,
    yellowMinDays: 30
    // below yellowMinDays => red; 0 or less => expired
  },
  reminderDays: [60, 30, 7]
};
