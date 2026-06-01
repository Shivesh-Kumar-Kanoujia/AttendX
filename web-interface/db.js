/**
 * AttendX — db.js
 * Firestore CRUD for subjects, timetable, and attendance logs.
 * Collections: users/{uid}/subjects, users/{uid}/timetable, users/{uid}/attendanceLogs
 */

import {
  collection,
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db } from "./firebase-config.js";

// ── Timetable ────────────────────────────────────────────────
function timetableRef(uid) {
  return doc(db, "users", uid, "timetable", "data");
}

export async function getTimetable(uid) {
  const snap = await getDocs(collection(db, "users", uid, "timetable"));
  if (snap.empty) return null;
  return snap.docs[0].data();
}

export function subscribeTimetable(uid, callback) {
  return onSnapshot(timetableRef(uid), (snap) => {
    callback(snap.exists() ? snap.data() : null);
  });
}

export async function saveTimetable(uid, timetableData) {
  await setDoc(timetableRef(uid), {
    ...timetableData,
    updatedAt: new Date().toISOString(),
  });
}

export async function clearTimetable(uid) {
  const snap = await getDocs(collection(db, "users", uid, "timetable"));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ── Attendance Logs ───────────────────────────────────────────
function logsRef(uid) {
  return collection(db, "users", uid, "attendanceLogs");
}

function logDocRef(uid, id) {
  return doc(db, "users", uid, "attendanceLogs", id);
}

export async function getAttendanceLogs(uid, date = null) {
  const snap = await getDocs(logsRef(uid));
  const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (date) return logs.filter((l) => l.date === date);
  return logs;
}

export function subscribeAttendanceLogs(uid, callback) {
  return onSnapshot(logsRef(uid), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function saveAttendanceLog(uid, log) {
  await setDoc(logDocRef(uid, log.id), {
    ...log,
    loggedAt: new Date().toISOString(),
  });
}

// ── Subjects ────────────────────────────────────────────────
function subjectsRef(uid) {
  return collection(db, "users", uid, "subjects");
}

function subjectDocRef(uid, id) {
  return doc(db, "users", uid, "subjects", id);
}

export async function getSubjects(uid) {
  const snap = await getDocs(subjectsRef(uid));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeSubjects(uid, callback) {
  return onSnapshot(subjectsRef(uid), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function saveSubject(uid, subject) {
  const { id, ...data } = subject;
  await setDoc(subjectDocRef(uid, id), { ...data, updatedAt: new Date().toISOString() });
}

export async function deleteSubjectDb(uid, id) {
  await deleteDoc(subjectDocRef(uid, id));
}

export async function clearAllSubjects(uid) {
  const snap = await getDocs(subjectsRef(uid));
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

// ── Data Migration ───────────────────────────────────────────

/**
 * Import guest data into the authenticated user's Firestore account.
 * @param {string} uid - The authenticated user's UID
 * @param {Object} guestData - { subjects, timetable, logs }
 */
export async function importGuestData(uid, guestData) {
  const batch = writeBatch(db);

  // Import subjects
  if (guestData.subjects && guestData.subjects.length > 0) {
    for (const subject of guestData.subjects) {
      const { id, ...data } = subject;
      const ref = doc(db, "users", uid, "subjects", id);
      batch.set(ref, { ...data, migratedAt: new Date().toISOString() });
    }
  }

  // Import timetable
  if (guestData.timetable) {
    const ref = doc(db, "users", uid, "timetable", "data");
    batch.set(ref, {
      ...guestData.timetable,
      migratedAt: new Date().toISOString(),
    });
  }

  // Import attendance logs
  if (guestData.logs && guestData.logs.length > 0) {
    for (const log of guestData.logs) {
      const ref = doc(db, "users", uid, "attendanceLogs", log.id);
      batch.set(ref, { ...log, migratedAt: new Date().toISOString() });
    }
  }

  await batch.commit();
}