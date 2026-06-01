/**
 * AttendX — storage.js
 * localStorage-based data layer (offline fallback).
 * Mirrors Firestore APIs so script.js can use either transparently.
 */

const LS_KEY_SUBJECTS = "attendx_subjects";
const LS_KEY_TIMETABLE = "attendx_timetable";
const LS_KEY_LOGS = "attendx_logs";

// ── Subjects ─────────────────────────────────────────────────
function subjectsKey(uid) {
  return `${LS_KEY_SUBJECTS}_${uid}`;
}

export async function getSubjects(uid) {
  const raw = localStorage.getItem(subjectsKey(uid));
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

let _subjectIntervals = {};

export function subscribeSubjects(uid, callback) {
  getSubjects(uid).then(callback).catch(e => console.error("[AttendX] subscribeSubjects error:", e));
  const key = subjectsKey(uid);
  let last = localStorage.getItem(key);

  _subjectIntervals[uid] = setInterval(() => {
    const current = localStorage.getItem(key);
    if (current !== last) { last = current; getSubjects(uid).then(callback).catch(e => console.error("[AttendX] subscribeSubjects poll error:", e)); }
  }, 2000);

  return () => clearInterval(_subjectIntervals[uid]);
}

export async function saveSubject(uid, subject) {
  const { id, ...data } = subject;
  const all = await getSubjects(uid);
  const idx = all.findIndex(s => s.id === id);
  if (idx >= 0) { all[idx] = { id, ...data, updatedAt: new Date().toISOString() }; }
  else { all.push({ id, ...data, updatedAt: new Date().toISOString() }); }
  localStorage.setItem(subjectsKey(uid), JSON.stringify(all));
}

export async function deleteSubjectDb(uid, id) {
  const all = await getSubjects(uid);
  localStorage.setItem(subjectsKey(uid), JSON.stringify(all.filter(s => s.id !== id)));
}

export async function clearAllSubjects(uid) {
  localStorage.removeItem(subjectsKey(uid));
}

// ── Timetable ───────────────────────────────────────────────
function timetableKey(uid) {
  return `${LS_KEY_TIMETABLE}_${uid}`;
}

export async function getTimetable(uid) {
  const raw = localStorage.getItem(timetableKey(uid));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

let _timetableIntervals = {};

export function subscribeTimetable(uid, callback) {
  getTimetable(uid).then(callback).catch(e => console.error("[AttendX] subscribeTimetable error:", e));
  const key = timetableKey(uid);
  let last = localStorage.getItem(key);

  _timetableIntervals[uid] = setInterval(() => {
    const current = localStorage.getItem(key);
    if (current !== last) { last = current; getTimetable(uid).then(callback).catch(e => console.error("[AttendX] subscribeTimetable poll error:", e)); }
  }, 2000);

  return () => clearInterval(_timetableIntervals[uid]);
}

export async function saveTimetable(uid, timetableData) {
  localStorage.setItem(timetableKey(uid), JSON.stringify({
    ...timetableData,
    updatedAt: new Date().toISOString(),
  }));
}

export async function clearTimetable(uid) {
  localStorage.removeItem(timetableKey(uid));
}

// ── Attendance Logs ─────────────────────────────────────────
function logsKey(uid) {
  return `${LS_KEY_LOGS}_${uid}`;
}

export async function getAttendanceLogs(uid, date = null) {
  const raw = localStorage.getItem(logsKey(uid));
  if (!raw) return [];
  try {
    const logs = JSON.parse(raw);
    return date ? logs.filter(l => l.date === date) : logs;
  } catch { return []; }
}

let _logIntervals = {};

export function subscribeAttendanceLogs(uid, callback) {
  getAttendanceLogs(uid).then(callback).catch(e => console.error("[AttendX] subscribeLogs error:", e));
  const key = logsKey(uid);
  let last = localStorage.getItem(key);

  _logIntervals[uid] = setInterval(() => {
    const current = localStorage.getItem(key);
    if (current !== last) { last = current; getAttendanceLogs(uid).then(callback).catch(e => console.error("[AttendX] subscribeLogs poll error:", e)); }
  }, 2000);

  return () => clearInterval(_logIntervals[uid]);
}

export async function saveAttendanceLog(uid, log) {
  const all = await getAttendanceLogs(uid);
  const idx = all.findIndex(l => l.id === log.id);
  if (idx >= 0) { all[idx] = { ...log, loggedAt: new Date().toISOString() }; }
  else { all.push({ ...log, loggedAt: new Date().toISOString() }); }
  localStorage.setItem(logsKey(uid), JSON.stringify(all));
}

// ── Data Migration (guest → authenticated user) ────────────

const GUEST_UID_PREFIX = "guest";

/**
 * Check if there's existing guest data that could be migrated.
 * Looks at all localStorage keys with the guest prefix.
 */
export function hasGuestData() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.includes(GUEST_UID_PREFIX)) return true;
  }
  return false;
}

/**
 * Export all data for a given guest UID as a portable object.
 */
export async function exportGuestData(guestUid) {
  const subjects = await getSubjects(guestUid);
  const timetable = await getTimetable(guestUid);
  const logs = await getAttendanceLogs(guestUid);
  return { subjects, timetable, logs };
}

/**
 * Clear all guest data after migration.
 */
export function clearGuestData() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith(LS_KEY_SUBJECTS + "_" + GUEST_UID_PREFIX) ||
        key.startsWith(LS_KEY_TIMETABLE + "_" + GUEST_UID_PREFIX) ||
        key.startsWith(LS_KEY_LOGS + "_" + GUEST_UID_PREFIX))) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}