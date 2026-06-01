/**
 * AttendX — script.js  (guest-mode-first + no auth timeout)
 * ─────────────────────────────────────────────────────────────
 * Auth:       Firebase (Google + Email/Password) — optional
 * Backend:    FastAPI on http://127.0.0.1:8000
 * Storage:    localStorage fallback when in guest mode
 *
 * Core flow:
 *   Page loads → auth loading spinner shows immediately
 *   onAuthStateChanged fires → showApp (always in guest mode first)
 *   If user is already logged in → showApp with user info
 *   Guest can click "Sign In" → login overlay appears
 *   Sign in succeeds → navbar updates to show avatar + sign-out
 * ─────────────────────────────────────────────────────────────
 */

import {
  watchAuthState,
  loginWithGoogle,
  loginWithEmail,
  registerWithEmail,
  logout,
} from "./auth.js";

import * as storage from "./storage.js";
import * as db from "./db.js";

// Shared utils
import { escHtml, generateId, showToast } from "./utils.js";

// Timetable modules
import { showUploadModal, initUpload } from "./timetable-upload.js";
import { parseTimetable, showManualEntryModal, initParser } from "./timetable-parser.js";
import { renderTodayView, renderFullTimetableView } from "./timetable-view.js";
import * as ttEngine from "./timetable-engine.js";

// ── Adapters: choose Firestore, API, or localStorage based on guest mode ──
function subscribeSubjectsAdapter(uid, isGuest, callback) {
  if (isGuest) return storage.subscribeSubjects(uid, callback);

  // Use Firestore real-time listener for logged-in users (cross-device sync)
  return db.subscribeSubjects(uid, callback);
}

function saveSubjectAdapter(uid, subject, isGuest) {
  if (isGuest) return storage.saveSubject(uid, subject);
  return db.saveSubject(uid, subject);
}

function deleteSubjectAdapter(uid, id, isGuest) {
  if (isGuest) return storage.deleteSubjectDb(uid, id);
  return db.deleteSubjectDb(uid, id);
}

function clearAllAdapter(uid, isGuest) {
  if (isGuest) return storage.clearAllSubjects(uid);
  return db.clearAllSubjects(uid);
}

// ── Show auth loading immediately so user sees something while Firebase resolves ──
function showAuthLoading() {
  document.getElementById("auth-loading").classList.remove("hidden");
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.add("hidden");
}

showAuthLoading(); // show spinner immediately on page load

// ============================================================
//  STATE
// ============================================================
let currentUid          = null;
let isGuestMode         = true;
let unsubscribeSnapshot = null;
let _localSubjects      = [];

// ============================================================
//  BOOT — Firebase auth state observer
// ============================================================
watchAuthState(
  function onSignIn(user) {
    currentUid  = user.uid;
    isGuestMode = false;
    updateNavbar(user);
     showAppShell();
     startSubscription();
     checkAndShowMigration(user.uid);
  },
  function onSignOut() {
    currentUid  = null;
    isGuestMode = true;
    updateNavbar(null);
    showAppShell();   // still show the app — just in guest mode
    ttEngine.stopTimetableEngine();
    startSubscription();
  }
);

function startSubscription() {
  if (unsubscribeSnapshot) { unsubscribeSnapshot(); unsubscribeSnapshot = null; }
  const uid = currentUid || "guest";
  unsubscribeSnapshot = subscribeSubjectsAdapter(uid, isGuestMode, (subjects) => {
    _localSubjects = subjects;
    renderDashboard(subjects).catch(error => {
      console.error("[AttendX] Failed to render dashboard:", error);
    });
    try {
      renderSubjectList(subjects);
    } catch (error) {
      console.error("[AttendX] Failed to render subject list:", error);
    }
   });
 
 // Init timetable engine
 ttEngine.initTimetableEngine(
    uid,
    isGuestMode,
    () => _localSubjects,
    (uid2, subject, isGuest) => saveSubjectAdapter(uid2, subject, isGuest),
    showAttendancePrompt
  );

  // Render today's view if on timetable tab
  renderTimetableTab();
}

// ============================================================
//  SCREEN MANAGEMENT
// ============================================================
function showAppShell() {
  document.getElementById("auth-loading").classList.add("hidden");
  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
}

// ── Update navbar based on auth state ──────────────────────
function updateNavbar(user) {
  const signInBtn = document.getElementById("btn-nav-signin");
  const signOutBtn = document.getElementById("btn-signout");
  const userInfo   = document.getElementById("user-info");
  const avatarEl   = document.getElementById("user-avatar");
  const nameEl     = document.getElementById("user-name");
  const footerEl   = document.getElementById("footer-user");

  if (user) {
    // Logged in — hide Sign In button, show avatar + name + Sign Out
    signInBtn.classList.add("hidden");
    signOutBtn.classList.remove("hidden");
    userInfo.classList.remove("hidden");
    userInfo.classList.add("flex");

    if (user.photoURL) {
      const img = document.createElement("img");
      img.src = user.photoURL;
      img.alt = "avatar";
      img.referrerPolicy = "no-referrer";
      avatarEl.textContent = "";
      avatarEl.appendChild(img);
    } else {
      const initials = (user.displayName || user.email || "U")
        .split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
      avatarEl.textContent = initials;
    }
    const displayName = user.displayName || user.email || "Student";
    nameEl.textContent = displayName;
    if (footerEl) footerEl.textContent = `Signed in as ${user.email || displayName}`;
  } else {
    // Guest — show Sign In button, hide user info
    signInBtn.classList.remove("hidden");
    signOutBtn.classList.add("hidden");
    userInfo.classList.add("hidden");
    userInfo.classList.remove("flex");
    nameEl.textContent = "";
    if (footerEl) footerEl.textContent = "Guest mode — sign in to sync";
  }
}

// ── Close login screen and return to app ────────────────────
window.closeLoginScreen = function () {
  document.getElementById("login-screen").classList.add("hidden");
  showAppShell();
  clearAuthForm();
  clearAuthError();
};

// ── Open login screen (triggered by Sign In button) ─────────
function openLoginScreen() {
  document.getElementById("auth-loading").classList.add("hidden");
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  setAuthMode("signin");
  clearAuthForm();
  clearAuthError();
}

// ── Mobile menu ─────────────────────────────────────────────
window.toggleMobileMenu = function () {
  document.getElementById("mobile-menu").classList.toggle("hidden");
};
window.closeMobileMenu = function () {
  document.getElementById("mobile-menu").classList.add("hidden");
};

// ============================================================
//  AUTH FORM LOGIC
// ============================================================
let authMode = "signin";

window.setAuthMode = function (mode) {
  authMode = mode;
  const signinTab   = document.getElementById("tab-signin");
  const registerTab = document.getElementById("tab-register");
  const submitBtn   = document.getElementById("btn-email-submit");
  const nameField   = document.getElementById("field-displayname");

  signinTab  .classList.toggle("tab-active", mode === "signin");
  signinTab  .classList.toggle("text-muted",  mode !== "signin");
  registerTab.classList.toggle("tab-active", mode === "register");
  registerTab.classList.toggle("text-muted",  mode !== "register");

  submitBtn.textContent = mode === "signin" ? "Sign In" : "Create Account";
  nameField.classList.toggle("hidden", mode !== "register");
  clearAuthError();
};

// Google Sign-In
document.getElementById("btn-google-login").addEventListener("click", async () => {
  setAuthBusy(true);
  const err = await loginWithGoogle();
  setAuthBusy(false);
  if (err) showAuthError(err);
});

// Email submit
document.getElementById("btn-email-submit").addEventListener("click", async () => {
  const email       = document.getElementById("auth-email").value.trim();
  const password    = document.getElementById("auth-password").value;
  const displayName = document.getElementById("auth-displayname").value.trim();

  if (!email || !password) { showAuthError("Please enter your email and password."); return; }

  setAuthBusy(true);
  let err;
  if (authMode === "signin") {
    err = await loginWithEmail(email, password);
  } else {
    if (!displayName) { setAuthBusy(false); showAuthError("Please enter your name."); return; }
    err = await registerWithEmail(email, password, displayName);
  }
  setAuthBusy(false);
  if (err) showAuthError(err);
});

// Enter key in auth form
["auth-email", "auth-password", "auth-displayname"].forEach(id => {
  document.getElementById(id)?.addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("btn-email-submit").click();
  });
});

// Sign-out
document.getElementById("btn-signout").addEventListener("click", () => logout());

// Sign In from nav (opens login overlay)
document.getElementById("btn-nav-signin").addEventListener("click", openLoginScreen);

// ── Auth helpers ─────────────────────────────────────────────
function showAuthError(msg) {
  const el = document.getElementById("auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearAuthError() {
  document.getElementById("auth-error").classList.add("hidden");
}
function clearAuthForm() {
  ["auth-email", "auth-password", "auth-displayname"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  clearAuthError();
}
function setAuthBusy(busy) {
  const btn  = document.getElementById("btn-email-submit");
  const gBtn = document.getElementById("btn-google-login");
  btn.disabled  = busy;
  gBtn.disabled = busy;
  btn.textContent = busy ? "Please wait…" : (authMode === "signin" ? "Sign In" : "Create Account");
}

// ============================================================
//  CORE MATH  (same as project2.c)
// ============================================================
function currentPercent(attended, total) {
  if (total <= 0) return 0;
  return (attended * 100) / total;
}
function maxBunkable(attended, total, required) {
  if (required <= 0) return Infinity;
  const x = Math.floor((attended * 100) / required - total);
  return x > 0 ? x : 0;
}
function minAttendRequired(attended, total, required) {
  if (required <= 0) return 0;
  if (required >= 100) return Infinity;
  const cur = currentPercent(attended, total);
  if (cur >= required) return 0;
  const numerator = (required * total) / 100 - attended;
  const denom = 1 - required / 100;
  if (denom <= 0) return Infinity;
  const y = Math.ceil(numerator / denom);
  return y > 0 ? y : 0;
}
function getStatus(pct, required) {
  if (pct >= required) return "safe";
  if (pct >= required - 5) return "warn";
  return "danger";
}

// ============================================================
//  TAB NAVIGATION
// ============================================================
const TABS = ["dashboard", "subjects", "quick", "timetable"];

window.switchTab = function (tab) {
  TABS.forEach(t => {
    document.getElementById(`tab-${t}-content`).classList.toggle("hidden", t !== tab);
    document.getElementById(`tab-${t}`).classList.toggle("tab-active", t === tab);
  });
  closeMobileMenu();

  // Refresh timetable view whenever it becomes visible
  if (tab === "timetable") {
    renderTimetableTab();
  }
};

// ============================================================
//  DASHBOARD RENDERING
// ============================================================
let chartInstance = null;

async function renderDashboard(subjects) {
  const grid      = document.getElementById("subject-cards-grid");
  const empty     = document.getElementById("dashboard-empty");
  const analytics = document.getElementById("analytics-section");

  let totalAttended = 0, totalClasses = 0, atRisk = 0;
  subjects.forEach(s => {
    totalAttended += s.attended || 0;
    totalClasses  += s.total || 0;
    if (currentPercent(s.attended || 0, s.total || 0) < (s.required || 75)) atRisk++;
  });

  document.getElementById("dash-total-subjects").textContent = subjects.length;
  document.getElementById("dash-overall").textContent =
    totalClasses > 0 ? ((totalAttended / totalClasses) * 100).toFixed(1) + "%" : "—";
  document.getElementById("dash-at-risk").textContent = atRisk;

  if (subjects.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    analytics.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  analytics.classList.remove("hidden");

  grid.innerHTML = subjects.map(s => subjectDashCard(s)).join("");

  grid.querySelectorAll(".subject-card").forEach((el, i) => {
    el.style.animationDelay = `${i * 60}ms`;
    el.classList.add("anim-in");
  });

  requestAnimationFrame(() => {
    subjects.forEach(s => {
      const fill = document.getElementById(`bar-${s.id}`);
      if (fill) fill.style.width = Math.min(currentPercent(s.attended, s.total), 100) + "%";
    });
  });

  await renderChart(subjects);
}

function subjectDashCard(s) {
  const pct      = currentPercent(s.attended, s.total);
  const status   = getStatus(pct, s.required);
  const canBunk  = status === "safe" ? maxBunkable(s.attended, s.total, s.required) : 0;
  const needAtt  = status !== "safe" ? minAttendRequired(s.attended, s.total, s.required) : 0;

  const barClass   = { safe: "progress-safe", warn: "progress-warn", danger: "progress-danger" }[status];
  const badgeClass = { safe: "badge-safe", warn: "badge-warn", danger: "badge-danger" }[status];
  const badgeText  = { safe: `✓ ${pct.toFixed(1)}%`, warn: `⚠ ${pct.toFixed(1)}%`, danger: `✕ ${pct.toFixed(1)}%` }[status];

  return `
    <div class="glass-card subject-card rounded-2xl sm:rounded-3xl p-4 sm:p-5">
      <div class="flex items-start justify-between mb-3">
        <div>
          <p class="text-ink font-semibold text-sm">${escHtml(s.name)}</p>
          <p class="text-muted text-xs mt-0.5">${s.attended} / ${s.total} classes</p>
        </div>
        <span class="${badgeClass} text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full">${badgeText}</span>
      </div>
      <div class="progress-track">
        <div id="bar-${s.id}" class="progress-fill ${barClass}" style="width:0%"></div>
      </div>
      <div class="flex justify-between mt-1">
        <span class="text-muted text-[9px] sm:text-[10px]">0%</span>
        <span class="text-muted text-[9px] sm:text-[10px]">Target: ${s.required}%</span>
        <span class="text-muted text-[9px] sm:text-[10px]">100%</span>
      </div>
      <div class="mt-3 sm:mt-4 pt-2 sm:pt-3 border-t border-gray-100 grid grid-cols-2 gap-2">
        ${status === "safe" ? `
          <div class="glass-result rounded-xl p-2.5 text-center">
            <p class="text-ink font-bold text-base sm:text-lg">${canBunk}</p>
            <p class="text-muted text-[9px] uppercase tracking-wider font-medium mt-0.5">Can Skip</p>
          </div>
          <div class="glass-result rounded-xl p-2.5 text-center">
            <p class="text-ink font-bold text-base sm:text-lg">+${(pct - s.required).toFixed(1)}%</p>
            <p class="text-muted text-[9px] uppercase tracking-wider font-medium mt-0.5">Buffer</p>
          </div>
        ` : `
          <div class="glass-result rounded-xl p-2.5 text-center col-span-2">
            <p style="color:#dc2626" class="font-bold text-base sm:text-lg">${needAtt === Infinity ? "∞" : needAtt} classes</p>
            <p class="text-muted text-[9px] uppercase tracking-wider font-medium mt-0.5">Must Attend</p>
          </div>
        `}
      </div>
    </div>
  `;
}

async function renderChart(subjects) {
  try {
    const ctx = document.getElementById("attendanceChart").getContext("2d");
    if (!ctx) {
      console.warn("[AttendX] Could not get chart context");
      return;
    }

    // Load Chart.js via script tag (works with UMD builds)
    let Chart = null;
    const chartUrls = [
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/chart.js/4.4.0/chart.umd.min.js",
    ];
    let chartErr;
    for (const url of chartUrls) {
      try {
        Chart = await loadChartJs(url);
        if (Chart) break;
      } catch (e) { chartErr = e; }
    }
    if (!Chart) {
      throw chartErr || new Error("Chart.js failed to load from all CDNs");
    }

    const colors = subjects.map(s => {
      const st = getStatus(currentPercent(s.attended, s.total), s.required);
      return { safe: "rgba(17,17,17,0.80)", warn: "rgba(217,119,6,0.80)", danger: "rgba(220,38,38,0.80)" }[st];
    });

    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: subjects.map(s => s.name),
        datasets: [
          {
            label: "Your Attendance (%)",
            data: subjects.map(s => parseFloat(currentPercent(s.attended, s.total).toFixed(1))),
            backgroundColor: colors,
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 24,
          },
          {
            label: "Required (%)",
            data: subjects.map(s => s.required),
            backgroundColor: "rgba(0,0,0,0)",
            borderColor: "rgba(136,136,136,0.60)",
            borderWidth: 1.5,
            borderDash: [5, 3],
            type: "line",
            pointRadius: 0,
            tension: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        devicePixelRatio: window.devicePixelRatio || 2,
        resizeDelay: 100,
        plugins: {
          legend: { labels: { font: { family: "Inter", size: 11 }, color: "#888", boxWidth: 14, padding: 16 } },
          tooltip: { backgroundColor: "#111", titleFont: { family: "Inter", weight: "600" }, bodyFont: { family: "Inter" }, padding: 10, cornerRadius: 10 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: "Inter", size: 11 }, color: "#888" } },
          y: { min: 0, max: 100, grid: { color: "rgba(0,0,0,0.05)" }, ticks: { font: { family: "Inter", size: 10 }, color: "#888", callback: v => v + "%" } },
        },
      },
    });
  } catch (error) {
    console.error("[AttendX] Failed to load Chart.js:", error);
    const analyticsSection = document.getElementById("analytics-section");
    if (analyticsSection) {
      analyticsSection.innerHTML = `
        <div class="text-center py-8">
          <div class="text-2xl mb-4">📊</div>
          <p class="text-muted">Charts unavailable. This may be due to:</p>
          <ul class="text-left text-sm space-y-1 mt-2">
            <li>Network connectivity issues</li>
            <li>Ad-blocker or privacy extension blocking the chart library</li>
            <li>Corporate/network firewall restrictions</li>
          </ul>
          <p class="text-xs text-muted mt-2">Try disabling ad-blockers or using a different network.</p>
        </div>
      `;
    }
  }
}

// Load Chart.js UMD via dynamic script tag (reliable with all CDNs)
function loadChartJs(url) {
  return new Promise((resolve, reject) => {
    // If already loaded, use it
    if (window.Chart) {
      resolve(window.Chart);
      return;
    }
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve(window.Chart);
    script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
    document.head.appendChild(script);
    // Timeout after 10 seconds
    setTimeout(() => reject(new Error(`Timed out loading: ${url}`)), 10000);
  });
}

// ============================================================
//  SUBJECTS TAB
// ============================================================
let editingSubjectId = null;

function renderSubjectList(subjects) {
  try {
    const list     = document.getElementById("subject-list");
    const emptyMsg = document.getElementById("subjects-empty");

    if (subjects.length === 0) {
      list.innerHTML = "";
      emptyMsg.classList.remove("hidden");
      return;
    }

    emptyMsg.classList.add("hidden");

    list.innerHTML = subjects.map(s => {
      const pct      = currentPercent(s.attended, s.total);
      const status   = getStatus(pct, s.required);
      const badClass = { safe: "badge-safe", warn: "badge-warn", danger: "badge-danger" }[status];
      const barClass = { safe: "progress-safe", warn: "progress-warn", danger: "progress-danger" }[status];

      return `
        <div class="glass-card subject-row rounded-xl sm:rounded-2xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <p class="text-ink font-semibold text-sm truncate">${escHtml(s.name)}</p>
              <span class="${badClass} text-[10px] font-semibold px-2 py-0.5 rounded-full">${pct.toFixed(1)}%</span>
            </div>
            <p class="text-muted text-xs mt-0.5">${s.attended}/${s.total} attended · Target: ${s.required}%</p>
            <div class="progress-track mt-2" style="max-width:180px">
              <div class="progress-fill ${barClass}" style="width:${Math.min(pct, 100)}%"></div>
            </div>
          </div>
            <div class="flex items-center gap-1 sm:gap-2 shrink-0">
            <button data-action="edit" data-id="${escAttr(s.id)}"
              class="px-2.5 py-1.5 rounded-xl hover:bg-soft/80 transition-colors text-muted hover:text-ink text-xs font-medium" title="Edit">Edit</button>
            <button data-action="delete" data-id="${escAttr(s.id)}"
              class="px-2.5 py-1.5 rounded-xl hover:bg-red-50 transition-colors text-muted hover:text-red-500 text-xs font-medium" title="Delete">Delete</button>
          </div>
        </div>
      `;
    }).join("");
  } catch (error) {
    console.error("[AttendX] Failed to render subject list:", error);
  }
}

// Event delegation for subject list buttons (Edit / Delete)
document.getElementById("subject-list")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  if (action === "edit") openEdit(id);
  else if (action === "delete") deleteSubject(id);
});

// ── Guard: must be logged in to save ─────────────────────────
function requireLogin() {
  if (isGuestMode || !currentUid) {
    openLoginScreen();
    showAuthError("Sign in to save your subjects.");
    return false;
  }
  return true;
}

window.addOrUpdateSubject = async function () {
  if (!requireLogin()) return;

  const name      = document.getElementById("sub-name").value.trim();
  const total     = parseInt(document.getElementById("sub-total").value, 10);
  const attended  = parseInt(document.getElementById("sub-attended").value, 10);
  const required  = parseInt(document.getElementById("sub-required").value, 10) || 75;

  document.getElementById("sub-error").classList.add("hidden");

  if (!name)                                               { showSubError("Subject name is required."); return; }
  if (isNaN(total) || total <= 0)                          { showSubError("Total classes must be > 0."); return; }
  if (isNaN(attended) || attended < 0 || attended > total) { showSubError("Attended must be 0–total."); return; }
  if (required < 0 || required > 100)                      { showSubError("Required % must be 0–100."); return; }

  const isDup = _localSubjects.some(s =>
    s.name.toLowerCase().trim() === name.toLowerCase().trim() && s.id !== editingSubjectId
  );
  if (isDup) { showSubError("A subject with this name already exists."); return; }

  const id = editingSubjectId || generateId();
  editingSubjectId = null;
  document.querySelector('[onclick="addOrUpdateSubject()"]').textContent = "+ Save Subject";

  try {
    await saveSubjectAdapter(currentUid, { id, name, total, attended, required }, isGuestMode);
    clearSubjectForm();
    showToast("Subject saved ✓");
  } catch (e) {
    console.warn("[AttendX] Save failed, falling back to localStorage:", e.message);
    await storage.saveSubject(currentUid, { id, name, total, attended, required });
    clearSubjectForm();
    showToast("Saved locally (offline)");
  }
};

window.deleteSubject = async function (id) {
  if (!requireLogin()) return;
  const btn = document.querySelector(`[data-action="delete"][data-id="${escAttr(id)}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "…"; }
  try {
    await deleteSubjectAdapter(currentUid, id, isGuestMode);
    showToast("Subject removed");
  } catch (e) {
    showToast("Delete failed.");
    console.error(e);
  }
};

window.openEdit = function (id) {
  const s = _localSubjects.find(s => s.id === id);
  if (!s) return;

  document.getElementById("edit-name").value     = s.name;
  document.getElementById("edit-total").value    = s.total;
  document.getElementById("edit-attended").value = s.attended;
  document.getElementById("edit-required").value = s.required;
  editingSubjectId = id;

  const modal = document.getElementById("edit-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
  untrap = trapFocus(modal);
};

window.closeModal = function () {
  const modal = document.getElementById("edit-modal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  editingSubjectId = null;
  if (untrap) { untrap(); untrap = null; }
};

window.saveEdit = async function () {
  if (!editingSubjectId) return;

  const name     = document.getElementById("edit-name").value.trim();
  const total    = parseInt(document.getElementById("edit-total").value, 10);
  const attended = parseInt(document.getElementById("edit-attended").value, 10);
  const required = parseInt(document.getElementById("edit-required").value, 10) || 75;

  if (!name || isNaN(total) || total <= 0 || isNaN(attended) || attended < 0 || attended > total) {
    showToast("Please check all fields."); return;
  }

  const btn = document.querySelector('[onclick="saveEdit()"]');
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }

  try {
    await saveSubjectAdapter(currentUid, { id: editingSubjectId, name, total, attended, required }, isGuestMode);
    closeModal();
    showToast("Subject updated ✓");
  } catch (e) {
    showToast("Update failed.");
    console.error(e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Save"; }
  }
};

window.clearAllData = async function () {
  if (!requireLogin()) return;
  if (!confirm("Clear ALL subjects? This cannot be undone.")) return;
  try {
    await clearAllAdapter(currentUid, isGuestMode);
    showToast("All data cleared");
  } catch (e) {
    showToast("Clear failed.");
    console.error(e);
   }
 
 document.getElementById("sub-error").classList.add("hidden");
}

// ============================================================
//  QUICK CALCULATOR  (always available — no login needed)
// ============================================================
window.quickCalculate = function () {
  const total    = parseFloat(document.getElementById("q-total").value);
  const attended = parseFloat(document.getElementById("q-attended").value);
  const required = parseFloat(document.getElementById("q-required").value) || 75;

  document.getElementById("q-error").classList.add("hidden");

  if (isNaN(total) || isNaN(attended)) { showQError("Fill in Total and Attended."); return; }
  if (total <= 0)                       { showQError("Total must be > 0."); return; }
  if (attended < 0 || attended > total) { showQError("Attended must be 0–total."); return; }
  if (required < 0 || required > 100)   { showQError("Required % must be 0–100."); return; }

  const pct    = currentPercent(attended, total);
  const status = getStatus(pct, required);

  document.getElementById("q-percent-display").textContent = pct.toFixed(1) + "%";

  const ring     = document.getElementById("q-ring");
  const ringPct  = Math.min(pct, 100);
  ring.style.strokeDasharray = `${ringPct} ${100 - ringPct}`;
  ring.style.stroke = { safe: "#111", warn: "#d97706", danger: "#dc2626" }[status];
  document.getElementById("q-ring-label").textContent = pct.toFixed(0) + "%";

  const badge = document.getElementById("q-status-badge");
  badge.className = "inline-block mt-3 px-3 sm:px-4 py-1.5 rounded-full text-[11px] font-semibold";
  const badgeMap = { safe: ["✓ Above Requirement", "badge-safe"], warn: ["⚠ Borderline", "badge-warn"], danger: ["✕ Below Requirement", "badge-danger"] };
  badge.textContent = badgeMap[status][0];
  badge.classList.add(badgeMap[status][1]);

  let html = "";
  if (status === "safe") {
    const canBunk = maxBunkable(attended, total, required);
    html += qStat("Can Skip",   canBunk > 0 ? canBunk + " classes" : "None", "🎉");
    html += qStat("Buffer",     "+" + (pct - required).toFixed(1) + "%", "📊");
  } else {
    const need = minAttendRequired(attended, total, required);
    html += qStat("Must Attend", need === Infinity ? "∞" : need + " classes", "📚");
    html += qStat("Deficit",     "-" + (required - pct).toFixed(1) + "%", "⚠️");
  }
  html += qStat("Target",   required + "%", "🎯");
  html += qStat("Ratio",     `${attended}/${total}`, "📋");

  document.getElementById("q-stats").innerHTML = html;
  document.getElementById("quick-result").classList.remove("hidden");
};

function qStat(label, value, icon) {
  return `
    <div class="stat-pill glass-result rounded-xl p-2.5 sm:p-3 text-center">
      <div class="text-base mb-1">${icon}</div>
      <p class="text-ink text-sm font-bold">${value}</p>
      <p class="text-muted text-[9px] mt-0.5 leading-tight uppercase tracking-wider">${label}</p>
    </div>
  `;
}

function showQError(msg) {
  const el = document.getElementById("q-error");
  el.textContent = msg;
  el.classList.remove("hidden");
  document.getElementById("quick-result").classList.add("hidden");
}

// ============================================================
//  KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "1") { e.preventDefault(); switchTab("dashboard"); }
  if ((e.ctrlKey || e.metaKey) && e.key === "2") { e.preventDefault(); switchTab("subjects"); }
  if ((e.ctrlKey || e.metaKey) && e.key === "3") { e.preventDefault(); switchTab("quick"); }
  if ((e.ctrlKey || e.metaKey) && e.key === "4") { e.preventDefault(); switchTab("timetable"); }
  if (e.key === "Enter" && !document.getElementById("tab-quick-content").classList.contains("hidden")) {
    quickCalculate();
  }
});

// Modal backdrop close
document.getElementById("edit-modal").addEventListener("click", function (e) {
  if (e.target === this) closeModal();
});

// Mobile menu close on outside click
document.addEventListener("click", (e) => {
  const menu = document.getElementById("mobile-menu");
  const btn  = e.target.closest("[onclick='toggleMobileMenu()']");
  if (!btn && !e.target.closest("#mobile-menu")) {
    menu.classList.add("hidden");
  }
});

// ── Focus trap for edit modal ────────────────────────────────
const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function trapFocus(el) {
  const focusables = [...el.querySelectorAll(focusableSelectors)];
  if (!focusables.length) return;
  const first = focusables[0];
  const last  = focusables[focusables.length - 1];

  function onKeydown(e) {
    if (e.key !== "Tab") return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
    }
  }

  el.addEventListener("keydown", onKeydown);
  first.focus();
  return () => el.removeEventListener("keydown", onKeydown);
}

const editModal = document.getElementById("edit-modal");
let untrap = null;

editModal.addEventListener("transitionend", () => {
  if (!editModal.classList.contains("hidden")) {
    untrap = trapFocus(editModal);
  } else if (untrap) {
    untrap();
    untrap = null;
  }
});

// ============================================================
//  TIMETABLE INTEGRATION
// ============================================================

// Expose for HTML onclick handlers
window.showUploadModal = () => showUploadModal();
window.showManualEntryModal = () => {
  const existing = ttEngine.getTimetableData();
  const classes = existing && existing.classes ? existing.classes : null;
  if (!classes || classes.length === 0) {
    showToast("No saved timetable. Upload one or use Manual Entry to create it.");
    return;
  }
  showManualEntryModal(classes);
};

// Store the class being prompted for so respondToPrompt can access it
let _promptClass = null;

function showAttendancePrompt(cls) {
  _promptClass = cls;
  const promptEl = document.getElementById("timetable-prompt");
  const card = document.getElementById("prompt-card");
  const nameEl = document.getElementById("prompt-class-name");
  const timeEl = document.getElementById("prompt-class-time");
  const countdownEl = document.getElementById("prompt-countdown");

  card.style.borderLeftColor = cls.color || "#6366F1";
  nameEl.textContent = cls.name;
  timeEl.textContent = `${cls.startTime} – ${cls.endTime}${cls.room ? " · " + cls.room : ""}`;

  promptEl.classList.remove("hidden");
  requestAnimationFrame(() => promptEl.classList.add("show"));

  // Countdown timer (auto-dismiss after 60s)
  let remaining = 60;
  countdownEl.textContent = `Auto-dismiss in ${remaining}s`;
  clearInterval(_promptCountdown);
  _promptCountdown = setInterval(() => {
    remaining--;
    countdownEl.textContent = remaining > 0 ? `Auto-dismiss in ${remaining}s` : "";
    if (remaining <= 0) {
      clearInterval(_promptCountdown);
      dismissAttendancePrompt();
    }
  }, 1000);
}

window.respondToPrompt = function (status) {
  clearInterval(_promptCountdown);
  if (_promptClass) {
    ttEngine.markAttendance(_promptClass.id, status);
    showToast(status === "attended" ? "Marked as attended ✓" : "Marked as absent ✗");
  }
  dismissAttendancePrompt();
};

window.dismissAttendancePrompt = function () {
  clearInterval(_promptCountdown);
  const promptEl = document.getElementById("timetable-prompt");
  promptEl.classList.remove("show");
  setTimeout(() => promptEl.classList.add("hidden"), 300);
  ttEngine.dismissPrompt();
  _promptClass = null;
};

window.markClassAttendance = function (classId) {
  const cls = ttEngine.getTodayClasses().find(c => c.id === classId);
  if (!cls) return;
  ttEngine.manualMarkAttendance(classId, "attended");
  showToast("Attendance marked ✓");
};

function renderTimetableTab() {
  try {
    const container = document.getElementById("timetable-today-container");
    const todayClasses = ttEngine.getTodayClasses();
    const logs = ttEngine.getLogsForDate();
    renderTodayView(todayClasses, logs, container);

    const notesSection = document.getElementById("timetable-notes-section");
    const textarea = document.getElementById("timetable-notes-textarea");
    if (ttEngine.getTimetableData().classes.length > 0) {
      notesSection.classList.remove("hidden");
      textarea.value = ttEngine.getNotes();
    } else {
      notesSection.classList.add("hidden");
    }
  } catch (error) {
    console.error("[AttendX] Failed to render timetable tab:", error);
  }
}

// Wire up timetable upload buttons
document.getElementById("btn-upload-timetable")?.addEventListener("click", () => {
  showUploadModal();
});

document.getElementById("btn-manual-timetable")?.addEventListener("click", () => {
  const existing = ttEngine.getTimetableData();
  showManualEntryModal(existing && existing.classes ? existing.classes : undefined);
});

// Timetable file input (inline upload zone in timetable tab)
const ttFileInput = document.getElementById("timetable-file-input");
const ttUploadZone = document.getElementById("timetable-upload-zone");

if (ttUploadZone && ttFileInput) {
  ttUploadZone.addEventListener("click", () => ttFileInput.click());
  ttUploadZone.addEventListener("dragover", (e) => { e.preventDefault(); ttUploadZone.classList.add("drag-over"); });
  ttUploadZone.addEventListener("dragleave", () => ttUploadZone.classList.remove("drag-over"));
  ttUploadZone.addEventListener("drop", (e) => {
    e.preventDefault();
    ttUploadZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleTimetableFile(file);
  });
  ttFileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleTimetableFile(e.target.files[0]);
  });
}

async function handleTimetableFile(file) {
  const ACCEPTED = ["image/jpeg", "image/png", "application/pdf"];
  if (!ACCEPTED.includes(file.type)) {
    showToast("Please upload a JPG, PNG, or PDF file.");
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast("File is too large (max 10MB).");
    return;
  }
  showToast("Parsing timetable…");
  const reader = new FileReader();
  reader.onload = (e) => {
    const fileData = e.target.result;
    const fileType = file.type === "application/pdf" ? "pdf" : "image";
    parseTimetable(fileData, fileType, file);
  };
  reader.readAsDataURL(file);
}

// Notes panel save
document.getElementById("btn-save-notes")?.addEventListener("click", async () => {
  const btn = document.getElementById("btn-save-notes");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  const textarea = document.getElementById("timetable-notes-textarea");
  if (textarea) {
    await ttEngine.saveNotes(textarea.value);
    showToast("Notes saved");
  }
  if (btn) { btn.disabled = false; btn.textContent = "Save"; }
});

// Full Timetable modal
window.openFullTimetable = function () {
  const modal = document.getElementById("full-timetable-modal");
  const content = document.getElementById("full-tt-content");
  const allClasses = ttEngine.getAllClasses();
  renderFullTimetableView(allClasses, content);
  modal.classList.remove("hidden");
  modal.classList.add("flex");
};

document.getElementById("full-tt-modal-close")?.addEventListener("click", () => {
  const modal = document.getElementById("full-timetable-modal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
});

// Click outside to close full timetable modal
document.getElementById("full-timetable-modal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.classList.add("hidden");
    e.currentTarget.classList.remove("flex");
  }
});

// Init upload module callbacks
initUpload((fileData, fileType, file) => {
  parseTimetable(fileData, fileType, file);
});

initParser(async (classes) => {
  try {
    await ttEngine.saveTimetable({ classes });
    showToast("Timetable saved ✓");
  } catch (e) {
    console.error("[AttendX] Failed to save timetable:", e);
    showToast("Save failed. Try again.");
  }
  renderTimetableTab();
});

// ============================================================
//  GUEST DATA MIGRATION
// ============================================================
function checkAndShowMigration(uid) {
  if (!storage.hasGuestData()) return;

  const modal = document.getElementById("migration-modal");
  if (!modal) return;

  modal.classList.remove("hidden");
  modal.classList.add("flex");

  const importBtn = document.getElementById("btn-migration-import");
  const discardBtn = document.getElementById("btn-migration-discard");
  const statusEl = document.getElementById("migration-status");

  function hideMigration() {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
  }

  // Remove old listeners by cloning
  const newImport = importBtn.cloneNode(true);
  const newDiscard = discardBtn.cloneNode(true);
  importBtn.parentNode.replaceChild(newImport, importBtn);
  discardBtn.parentNode.replaceChild(newDiscard, discardBtn);

  newDiscard.addEventListener("click", () => {
    storage.clearGuestData();
    hideMigration();
    showToast("Local data discarded");
  });

  newImport.addEventListener("click", async () => {
    newImport.disabled = true;
    newImport.textContent = "Importing…";
    statusEl.classList.remove("hidden");
    statusEl.textContent = "Importing subjects…";

    try {
      // Use the guest UID that was active before sign-in
      const guestUid = "guest";
      const guestData = await storage.exportGuestData(guestUid);

       statusEl.textContent = "Saving to your account...";
      await db.importGuestData(uid, guestData);

      storage.clearGuestData();
      hideMigration();
      showToast("Data imported successfully ✓");
    } catch (e) {
      console.error("[AttendX] Migration failed:", e);
      statusEl.textContent = "Migration failed. Your local data is still available.";
      newImport.disabled = false;
      newImport.textContent = "Try Again";
    }
  });
}