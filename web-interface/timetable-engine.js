/**
 * AttendX — timetable-engine.js
 * Core scheduling engine: detects class-end events, triggers attendance prompts,
 * auto-logs absent after window closes, and updates subject counters.
 */

import * as db from "./db.js";
import * as storage from "./storage.js";
import { todayYMD } from "./utils.js";

// ── State ────────────────────────────────────────────────────
let _uid = null;
let _isGuest = true;
let _classes = [];
let _logs = [];
let _timetableNotes = "";
let _getSubjects = null;        // () => subject[]
let _saveSubject = null;        // (subject) => promise
let _intervalId = null;
let _pendingPrompts = {};        // key: "clsId_date", value: { cls, endTimeMs }
let _promptQueue = [];           // queue of classObjs waiting to be shown
let _currentPrompt = null;      // { cls, endTimeMs } currently shown
let _onPromptReady = null;       // callback from script.js to show prompt UI

const PROMPT_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes after class ends
const TICK_MS = 60 * 1000;                // poll every 60 seconds

// ── Init / Stop ──────────────────────────────────────────────
export function initTimetableEngine(uid, isGuest, getSubjects, saveSubject, onPromptReady) {
  _uid = uid || "guest";
  _isGuest = isGuest;
  _getSubjects = getSubjects;
  _saveSubject = saveSubject;
  _onPromptReady = onPromptReady;

  // Subscribe to timetable changes
  const sub = isGuest ? storage : db;
  sub.subscribeTimetable(_uid, (timetable) => {
    if (timetable !== null) {
      if (timetable.classes !== null) {
        _classes = timetable.classes;
      }
      _timetableNotes = timetable.notes || "";
    }
  });

  // Subscribe to attendance logs
  sub.subscribeAttendanceLogs(_uid, (logs) => {
    _logs = logs;
  });

  // Start polling
  stopPolling();
  _intervalId = setInterval(tick, TICK_MS);
  tick(); // run immediately
}

export function stopTimetableEngine() {
  stopPolling();
  _classes = [];
  _logs = [];
  _timetableNotes = "";
  _pendingPrompts = {};
  _promptQueue = [];
  _currentPrompt = null;
}

function stopPolling() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
}

// ── Core tick (runs every TICK_MS) ──────────────────────────
let _ticking = false;
async function tick() {
  if (_ticking) return;
  _ticking = true;
  try {
    const now = Date.now();
    const today = todayYMD();
    const dayOfWeek = new Date().getDay(); // 0=Sun

    // 1. Check for classes that just ended → add to prompt queue
    for (const cls of _classes) {
      if (!cls.dayOfWeek.includes(dayOfWeek)) continue;

      const endMs = classEndMs(cls, today);
      const key = `${cls.id}_${today}`;
      const alreadyLogged = _logs.some(l => l.classId === cls.id && l.date === today);

      // Within prompt window?
      if (now >= endMs && now < endMs + PROMPT_WINDOW_MS && !alreadyLogged) {
        if (!_pendingPrompts[key] && !_currentPrompt) {
          _pendingPrompts[key] = { cls, endTimeMs: endMs };
          _promptQueue.push({ cls, endTimeMs: endMs });
          flushPromptQueue();
        }
      }
    }

    // 2. Auto-expire pending prompts after window closes
    for (const [key, { cls, endTimeMs }] of Object.entries(_pendingPrompts)) {
      if (now >= endTimeMs + PROMPT_WINDOW_MS) {
        const [clsId, date] = key.split("_");
        const alreadyLogged = _logs.some(l => l.classId === clsId && l.date === date);
        if (!alreadyLogged) {
          await autoLogAbsent(cls, date);
        }
        delete _pendingPrompts[key];
      }
    }
  } finally {
    _ticking = false;
  }
}

function flushPromptQueue() {
  if (_currentPrompt || _promptQueue.length === 0) return;
  const next = _promptQueue.shift();
  _currentPrompt = next;
  if (_onPromptReady) _onPromptReady(next.cls, next.endTimeMs);
}

// ── User responded to prompt ─────────────────────────────────
export function markAttendance(classId, status) { // status: "attended" | "absent"
  const today = todayYMD();
  const cls = _classes.find(c => c.id === classId);
  if (!cls) return;

  const log = {
    id: `${classId}_${today}`,
    classId,
    subjectName: cls.name,
    date: today,
    scheduledStart: cls.startTime,
    scheduledEnd: cls.endTime,
    status,
    promptShownAt: new Date(_pendingPrompts[`${classId}_${today}`]?.endTimeMs || Date.now()).toISOString(),
    autoLogged: false,
  };

  const sub = _isGuest ? storage : db;
  sub.saveAttendanceLog(_uid, log).then(() => {
    delete _pendingPrompts[`${classId}_${today}`];
    _currentPrompt = null;
    syncToSubject(cls.name, status);
    flushPromptQueue();
  }).catch(e => console.error("[AttendX] markAttendance save failed:", e));
}

// Called from script.js when user manually marks attendance before/during class
export function manualMarkAttendance(classId, status) {
  const today = todayYMD();
  const cls = _classes.find(c => c.id === classId);
  if (!cls) return;

  const logId = `${classId}_${today}`;
  const sub = _isGuest ? storage : db;

  // Upsert log
  sub.saveAttendanceLog(_uid, {
    id: logId,
    classId,
    subjectName: cls.name,
    date: today,
    scheduledStart: cls.startTime,
    scheduledEnd: cls.endTime,
    status,
    autoLogged: false,
  }).then(() => {
    delete _pendingPrompts[logId];
    syncToSubject(cls.name, status);
  }).catch(e => console.error("[AttendX] manualMarkAttendance save failed:", e));
}

// ── Sync class attendance → subject counter ─────────────────
async function syncToSubject(subjectName, status) {
  if (!_getSubjects || !_saveSubject) return;
  const subjects = _getSubjects();
  const sub = subjects.find(s => s.name.toLowerCase() === subjectName.toLowerCase());
  if (!sub) return;

  const updated = {
    ...sub,
    total: sub.total + 1,
    attended: status === "attended" ? sub.attended + 1 : sub.attended,
  };
  await _saveSubject(_uid, updated, _isGuest);
}

async function autoLogAbsent(cls, date) {
  const sub = _isGuest ? storage : db;
  await sub.saveAttendanceLog(_uid, {
    id: `${cls.id}_${date}`,
    classId: cls.id,
    subjectName: cls.name,
    date,
    scheduledStart: cls.startTime,
    scheduledEnd: cls.endTime,
    status: "absent",
    autoLogged: true,
  });
  await syncToSubject(cls.name, "absent").catch(e => console.error("[AttendX] syncToSubject failed:", e));
}

// ── Getters for UI ───────────────────────────────────────────
export function getAllClasses() {
  return _classes;
}

export function getTimetableData() {
  return { classes: _classes };
}

export function getNotes() {
  return _timetableNotes;
}

export async function saveNotes(notes) {
  _timetableNotes = notes;
  const sub = _isGuest ? storage : db;
  const data = { classes: _classes, notes };
  await sub.saveTimetable(_uid, data);
}

export function getTodayClasses() {
  const dayOfWeek = new Date().getDay();
  return _classes
    .filter(c => c.dayOfWeek.includes(dayOfWeek))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export function getLogsForDate(date = null) {
  return _logs.filter(l => !date || l.date === date);
}

export function getLogForClass(classId, date = null) {
  const d = date || todayYMD();
  return _logs.find(l => l.classId === classId && l.date === d) || null;
}

export function getClassStatus(cls) {
  const now = new Date();
  const today = todayYMD();
  const log = getLogForClass(cls.id, today);

  const [sh, sm] = cls.startTime.split(":").map(Number);
  const [eh, em] = cls.endTime.split(":").map(Number);
  const startMs = new Date(now); startMs.setHours(sh, sm, 0, 0);
  const endMs = new Date(now); endMs.setHours(eh, em, 0, 0);

  if (log) return log.status; // attended / absent
  if (now < startMs) return "upcoming";
  if (now >= startMs && now < endMs) return "ongoing";
  return "ended";
}

// ── Helpers ──────────────────────────────────────────────────
function classEndMs(cls, dateStr) {
  const [h, m] = cls.endTime.split(":").map(Number);
  const d = new Date(dateStr);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// ── Dismiss current prompt (user ignored it) ─────────────────
export function dismissPrompt() {
  _currentPrompt = null;
  flushPromptQueue();
}

// ── Timetable CRUD wrappers ─────────────────────────────────
export async function saveTimetable(timetableData) {
  const sub = _isGuest ? storage : db;
  const data = { ...timetableData, notes: _timetableNotes };
  await sub.saveTimetable(_uid, data);
  _classes = (timetableData && timetableData.classes) || [];
}

export async function clearTimetable() {
  const sub = _isGuest ? storage : db;
  await sub.clearTimetable(_uid);
  _classes = [];
}