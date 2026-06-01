/**
 * AttendX — api.js
 * FastAPI backend integration. All calls send Firebase ID token
 * in the Authorization: Bearer <token> header.
 *
 * When not logged in, guest subjects are kept in memory only
 * (no backend required for guest mode).
 */

import { currentUser } from "./auth.js";

// ── Config ───────────────────────────────────────────────────
const API_HOST = window.ATTENDX_API_URL;
if (!API_HOST) {
  console.warn("[AttendX] ATTENDX_API_URL not set. API calls will fail unless running locally.");
}
const API_BASE = API_HOST ? `${API_HOST}/subjects` : null;
const API_TIMETABLE = API_HOST ? `${API_HOST}/timetable` : null;

// ── Helper: fetch with auth header ──────────────────────────
async function apiFetch(method, path, body = null) {
  const headers = { "Content-Type": "application/json" };

  // Always send Firebase ID token when available (user is signed in)
  if (currentUser) {
    const idToken = await getIdToken();
    if (idToken) {
      headers["Authorization"] = `Bearer ${idToken}`;
    }
  }

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

async function getIdToken() {
  // Dynamic import to avoid circular issues
  const { auth } = await import("./firebase-config.js");
  return auth?.currentUser?.getIdToken() || null;
}

// ── GET /subjects ─────────────────────────────────────────────
export async function apiGetSubjects() {
  return apiFetch("GET", "");
}

// ── POST /subjects/save ───────────────────────────────────────
export async function apiSaveSubject(subject) {
  return apiFetch("POST", "/save", {
    id:        subject.id,
    name:      subject.name,
    total:     subject.total,
    attended:  subject.attended,
    required:  subject.required,
    updated_at: new Date().toISOString(),
  });
}

// ── DELETE /subjects/delete/{id} ───────────────────────────
export async function apiDeleteSubject(id) {
  return apiFetch("DELETE", `/delete/${id}`);
}

// ── DELETE /subjects/clear-all ───────────────────────────────
export async function apiClearAll() {
  return apiFetch("DELETE", "/clear-all");
}

// ── POST /timetable/extract (PDF Upload) ─────────────────────
export async function apiExtractPdf(file) {
  const formData = new FormData();
  formData.append("file", file);

  const headers = {};
  // Always send Firebase ID token when available
  if (currentUser) {
    const idToken = await getIdToken();
    if (idToken) headers["Authorization"] = `Bearer ${idToken}`;
  }

  const res = await fetch(`${API_TIMETABLE}/extract`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}