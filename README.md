# Beast Rentals

Professional shop & farm rental management platform — Paystack
payments, digital receipts, QR verification, and a full admin console.

Built entirely with **HTML5 + CSS3 + Vanilla JavaScript + Font
Awesome** on the frontend and **Firebase** (Authentication, Cloud
Firestore, Storage) as the only backend. Pure static site — deploy it
anywhere that serves HTML files (Vercel, Netlify, GitHub Pages, any
web host). No build step, no server, no Cloud Functions, no
environment variables.

Color scheme: **green / black / white** — see `assets/css/style.css`
`:root` variables to adjust the palette.

---

## ⚠️ Read this first: there is no server-side verification

By explicit request, this app has **no backend of any kind** beyond
Firebase itself — no Cloud Functions, no Vercel/Netlify serverless
functions, nothing. That has one unavoidable consequence worth
understanding clearly:

**Nothing in this app confirms that a Paystack payment actually
happened.** The payment flow trusts the Paystack popup's own
success callback and then writes the payment/receipt/rental records
directly from the browser. Firestore rules stop a user from touching
anyone else's data or editing their own serial number/role/status, and
check that the claimed amount matches your configured fee — but a
signed-in user with browser devtools open could, in principle, call
the same write the payment flow uses and grant themselves a rental
without ever paying.

For a low-stakes personal project or early testing, this is a
reasonable and simple tradeoff. If this ever handles real money at
scale and fraud losses become a concern, the fix is a small trusted
server (any backend at all — a Vercel function, a Cloud Function, a
plain Node server) that checks the transaction reference against
`https://api.paystack.co/transaction/verify/:reference` using your
Paystack **secret** key before any record is written. That secret key
must never live in this frontend code — that's the one thing a server
is protecting against here.

The same tradeoff applies to public QR/receipt verification: it reads
`receipts`, `rentals`, and `qr_codes` directly from the browser, which
is why those three collections are publicly readable in
`firebase/firestore.rules`. They deliberately never contain email or
phone — that information stays private on `users`, which is not
publicly readable.

---

## 1. What's included

```
beast-rentals/
├── index.html, about.html, terms.html, privacy.html, contact.html
├── login.html, signup.html, complete-profile.html
├── user/            → user dashboard, rental, payment, transactions,
│                       receipts, QR, notifications, settings
├── admin/            → admin dashboard, users, shops, farms, rentals,
│                       payments, transactions, receipts, QR management
│                       & scanner, notifications, reports, activity
│                       logs, administrators, settings
├── assets/
│   ├── css/          → style.css (design system), auth.css,
│                        dashboard.css, admin.css, responsive.css
│   └── js/           → firebase-config.js, auth.js, utils.js,
│                        payment.js, receipt.js, qr.js, dashboard.js,
│                        admin.js
├── firebase/
│   └── firestore.rules, firestore.indexes.json, storage.rules
├── scripts/
│   └── create-first-admin.js   (one-time bootstrap script)
└── vercel.json (optional — only relevant if hosting on Vercel)
```

## 2. Prerequisites

- A Firebase project (create one at https://console.firebase.google.com)
- A Paystack account (https://paystack.com) with API keys
- Node.js 18+ (only needed for the one-time admin bootstrap script)

## 3. Firebase setup

1. In the Firebase Console, enable:
   - **Authentication** → Email/Password sign-in method
   - **Authentication** → Google sign-in method (for "Continue with
     Google" — toggle it on, set a support email, no extra config)
   - **Cloud Firestore** (production mode) — if this has never been
     created, every read/write will fail regardless of rules
   - **Storage**

2. Register a **Web App** in Project Settings → General → "Your apps",
   then copy the config object into `assets/js/firebase-config.js`.

3. Log in and deploy Firestore & Storage rules:

   ```bash
   firebase login
   firebase use --add        # pick your project
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```

4. Seed the initial settings document at `settings/general`
   (Firestore console → Start collection):

   ```json
   {
     "businessName": "Beast Rentals",
     "currency": "NGN",
     "annualRentalFee": 250,
     "rentalDurationDays": 365,
     "thresholds": { "greenMinDays": 60, "yellowMinDays": 30 },
     "reminderDays": [60, 30, 7]
   }
   ```

5. Bootstrap your first Super Admin (the one admin that has to be
   created with elevated credentials, since Firestore rules require an
   *existing* super_admin to create new admin records — every admin
   after this one can be added directly from the Admin Console UI, or
   even faster, straight from the Firestore console — see the "grant
   admin access manually" instructions below):

   ```bash
   cd scripts
   npm install
   # download a service account key: Firebase Console → Project
   # Settings → Service Accounts → Generate new private key → save as
   # scripts/serviceAccountKey.json (never commit this file)
   node create-first-admin.js
   # then delete serviceAccountKey.json from this machine
   ```

   **Or skip the script entirely:** Firebase Console → Authentication
   → add a user manually → copy their UID → Firestore Database → create
   a document at `admins/{that UID}` with fields `name`, `email`,
   `role: "super_admin"`, `createdAt`.

## 4. Paystack setup

1. Grab your **Public Key** from the Paystack dashboard (Settings →
   API Keys & Webhooks).
2. Put it in `assets/js/firebase-config.js` (`PAYSTACK_PUBLIC_KEY`) —
   safe to expose in frontend code.
3. You do **not** need the secret key anywhere in this project — there
   is no server to hold it. (See the warning at the top of this file
   for what that tradeoff means.)

## 5. Deploy the frontend

This is a plain static site — deploy it however you'd deploy any set
of HTML/CSS/JS files:

- **Vercel:** `vercel --prod`, or connect a repo and import it
  (Framework preset: **Other**). `vercel.json` handles the `/verify-qr`
  short link and `noindex` headers on `/admin/*` and `/user/*`.
- **Netlify, GitHub Pages, any static host:** just upload the folder.
- **Local testing:** any static file server works, including VS Code's
  Live Server extension — there's no `/api` folder anymore, so nothing
  needs a special server environment to run.

### ⚠️ Required: add your hosting domain to Firebase Auth

Without this, login, signup, and "Continue with Google" all fail with
`auth/unauthorized-domain`. Firebase Console → Authentication →
Settings → Authorized domains → add your production domain and any
preview domains you test on. `localhost` and `127.0.0.1` are
authorized by default, so local testing (Live Server, etc.) works
without extra setup.

## 6. Security notes (read before going to production)

- **There is no payment verification against Paystack's servers** —
  see the warning at the top of this file. This is the single biggest
  thing to understand before accepting real payments at any scale.
- Admin authorization is based on the existence of an `admins/{uid}`
  Firestore document (checked directly in rules — no custom claims, no
  Cloud Functions needed).
- Adding a new administrator requires their Firebase Auth **UID**
  (Admin Console → Administrators → Add Administrator, or directly via
  the Firestore console). A browser can never look up an arbitrary
  user by email — only your one-time bootstrap script can do that.
- `receipts`, `rentals`, and `qr_codes` are intentionally public-read
  (for verification without a server) but never contain email or
  phone — only `users` has that, and it stays private.
- Replace every placeholder before deploying, and have legal counsel
  review `terms.html` / `privacy.html` for your jurisdiction.

## 7. Default theme

Colors live in `assets/css/style.css` under `:root`. Key variables:

```css
--br-black: #0b0f0d;
--br-white: #ffffff;
--br-green-500: #1f8a41;
--br-green-600: #1a6b34;
--br-green-700: #124a24;
```

Adjust these to fine-tune the exact green/black/white balance.
