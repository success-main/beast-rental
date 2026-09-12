/* =====================================================================
   BEAST RENTALS — CREATE FIRST ADMIN (one-time setup script)
   =====================================================================
   Creates a Firebase Auth user (or reuses one if it already exists)
   and writes the admins/{uid} Firestore document with role
   "super_admin". This is the ONE step that still needs a trusted
   script rather than the browser: firestore.rules requires an
   existing super_admin to create new admin records, so the very first
   admin has to be bootstrapped with elevated (Admin SDK) credentials.
   Every admin added after this one can be added directly from the
   Admin Console UI (Administrators → Add Administrator).

   USAGE:
   1. Firebase Console → Project Settings → Service Accounts →
      "Generate new private key" → save the JSON file as
      scripts/serviceAccountKey.json (NEVER commit this file — it's
      already covered by .gitignore).
   2. From the project root:
        cd scripts
        npm install firebase-admin
        node create-first-admin.js
   3. Delete or move serviceAccountKey.json somewhere safe afterward —
      it grants full admin access to your entire Firebase project.
===================================================================== */

const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");

// ---------------------------------------------------------------
// Edit these values directly before running.
// ---------------------------------------------------------------
const ADMIN_EMAIL = "giftibe53@gmail.com";
const ADMIN_PASSWORD = "Success@1";
const ADMIN_NAME = "Gift";
const ADMIN_ROLE = "super_admin"; // super_admin | finance_admin | manager | verification_officer

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function main() {
  let userRecord;

  try {
    userRecord = await admin.auth().getUserByEmail(ADMIN_EMAIL);
    console.log(`Found existing auth user: ${userRecord.uid}`);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
    userRecord = await admin.auth().createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      displayName: ADMIN_NAME,
      emailVerified: true
    });
    console.log(`Created new auth user: ${userRecord.uid}`);
  }

  await db.collection("admins").doc(userRecord.uid).set({
    name: ADMIN_NAME,
    email: ADMIN_EMAIL,
    role: ADMIN_ROLE,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  console.log(`admins/${userRecord.uid} document written with role "${ADMIN_ROLE}".`);

  console.log("\nDone. Sign in at admin/login.html with:");
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD} (only used if a new account was created)`);
  console.log("\nIMPORTANT: delete serviceAccountKey.json from this machine when finished.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
