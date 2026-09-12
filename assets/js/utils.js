/* =====================================================================
   BEAST RENTALS — SHARED UTILITIES
   Pure helper functions used across every page. No Firebase imports
   here on purpose, so this file can be loaded as a plain <script>.
===================================================================== */

/* ---------------- Toasts ---------------- */
function ensureToastStack() {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

function showToast(message, type = "info", duration = 4200) {
  const stack = ensureToastStack();
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateX(20px)";
    el.style.transition = "all .25s ease";
    setTimeout(() => el.remove(), 250);
  }, duration);
}

/* ---------------- Formatting ---------------- */
function formatCurrency(amount, currency = "NGN") {
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
  } catch {
    return `₦${Number(amount).toLocaleString()}`;
  }
}

function formatDate(dateLike, opts = {}) {
  if (!dateLike) return "—";
  const d = dateLike.toDate ? dateLike.toDate() : new Date(dateLike);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", ...opts });
}

function formatDateTime(dateLike) {
  if (!dateLike) return "—";
  const d = dateLike.toDate ? dateLike.toDate() : new Date(dateLike);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function timeAgo(dateLike) {
  if (!dateLike) return "—";
  const d = dateLike.toDate ? dateLike.toDate() : new Date(dateLike);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return formatDate(d);
}

/* ---------------- Rental status helpers ---------------- */
// expiryDate: JS Date | Firestore Timestamp | ISO string
// thresholds: { greenMinDays, yellowMinDays } — from settings/general
function getRentalStatus(expiryDate, thresholds = { greenMinDays: 60, yellowMinDays: 30 }) {
  if (!expiryDate) return { level: "gray", label: "NO RENTAL" };
  const d = expiryDate.toDate ? expiryDate.toDate() : new Date(expiryDate);
  const msLeft = d.getTime() - Date.now();
  const daysLeft = msLeft / 86400000;

  if (msLeft <= 0) return { level: "red", label: "EXPIRED", daysLeft: 0 };
  if (daysLeft > thresholds.greenMinDays) return { level: "green", label: "ACTIVE", daysLeft };
  if (daysLeft > thresholds.yellowMinDays) return { level: "yellow", label: "ACTIVE — RENEW SOON", daysLeft };
  return { level: "red", label: "EXPIRING SOON", daysLeft };
}

function getCountdownParts(expiryDate) {
  const d = expiryDate.toDate ? expiryDate.toDate() : new Date(expiryDate);
  let diff = d.getTime() - Date.now();
  if (diff < 0) diff = 0;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds, expired: diff <= 0 };
}

function pad2(n) { return String(n).padStart(2, "0"); }

/* ---------------- Password strength (client-side hint only) ---------------- */
function passwordStrength(pw) {
  let score = 0;
  if (!pw) return 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

/* ---------------- Validation ---------------- */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isValidPhone(phone) {
  return /^(\+?\d{10,14})$/.test(phone.replace(/[\s-]/g, ""));
}

/* ---------------- Query string helpers ---------------- */
function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ---------------- Nav / mobile menu wiring (shared across public pages) ---------------- */
function wirePublicNav() {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", () => links.classList.toggle("open"));
  }
}

function wireSidebarToggle() {
  const btn = document.querySelector(".mobile-menu-btn");
  const sidebar = document.querySelector(".app-sidebar");
  if (!btn || !sidebar) return;

  let backdrop = document.querySelector(".sidebar-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "sidebar-backdrop";
    document.body.appendChild(backdrop);
  }

  function openSidebar() {
    sidebar.classList.add("open");
    backdrop.classList.add("visible");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    backdrop.classList.remove("visible");
  }

  btn.addEventListener("click", () => {
    sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });
  backdrop.addEventListener("click", closeSidebar);
  // Close automatically when a nav link is tapped (mobile UX expectation).
  sidebar.querySelectorAll("a").forEach(a => a.addEventListener("click", closeSidebar));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSidebar(); });
}

/* ---------------- Mobile bottom tab bar (user app) ---------------- */
function wireBottomNav() {
  const nav = document.getElementById("bottom-nav");
  if (!nav) return;
  nav.classList.add("enabled");
  document.body.classList.add("has-bottom-nav");

  const current = window.location.pathname.split("/").pop() || "dashboard.html";
  nav.querySelectorAll("a").forEach(a => {
    if (a.dataset.page === current) a.classList.add("active");
  });
}

/* ---------------- Modal helpers ---------------- */
function openModal(id) { document.getElementById(id)?.classList.add("open"); }
function closeModal(id) { document.getElementById(id)?.classList.remove("open"); }

document.addEventListener("DOMContentLoaded", () => {
  wirePublicNav();
  wireSidebarToggle();
  wireBottomNav();
  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => closeModal(btn.dataset.closeModal));
  });
});

/* ---------------- Initials for avatar ---------------- */
function getInitials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || "").join("") || "?";
}

/* ---------------- Copy to clipboard ---------------- */
function copyToClipboard(text) {
  navigator.clipboard?.writeText(text).then(() => showToast("Copied to clipboard", "success", 2000));
}
