"""
AttendX Backend — services/firestore_db.py
Centralized Firestore Admin SDK CRUD for subjects, timetables, and attendance logs.

Uses Firebase Admin SDK initialized in utils/firebase.py.
Falls back to in-memory storage when Firebase is unavailable (dev mode).

Collection structure:
  users/{uid}/subjects/{subjectId}
  users/{uid}/timetable/data
  users/{uid}/attendanceLogs/{logId}
"""

from typing import Optional

from firebase_admin import firestore
import firebase_admin

_db = None

# In-memory fallback for dev mode (when Firebase is unavailable)
_mem_store: dict[str, dict] = {"subjects": {}, "timetable": {}, "logs": {}}


def _get_db():
    global _db
    if _db is None:
        if not firebase_admin._apps:
            return None  # Dev mode
        _db = firestore.client()
    return _db


def _is_dev() -> bool:
    return _get_db() is None


# ── Subjects ────────────────────────────────────────────────

def get_subjects(uid: str) -> list[dict]:
    """Fetch all subjects for a user."""
    if _is_dev():
        return _mem_store["subjects"].get(uid, [])

    try:
        docs = _db.collection("users").document(uid).collection("subjects").stream()
        return [{"id": d.id, **d.to_dict()} for d in docs]
    except Exception as e:
        print(f"[AttendX] Firestore get_subjects error: {e}")
        return []


def save_subject(uid: str, subject: dict) -> dict:
    """Create or update a subject. Returns the saved subject dict."""
    subject_id = subject["id"]
    data = {k: v for k, v in subject.items() if k != "id"}
    data["updatedAt"] = data.get("updatedAt") or __now_iso()
    saved = {"id": subject_id, **data}

    if _is_dev():
        subjects = _mem_store["subjects"].setdefault(uid, [])
        idx = next((i for i, s in enumerate(subjects) if s["id"] == subject_id), None)
        if idx is not None:
            subjects[idx] = saved
        else:
            subjects.append(saved)
        return saved

    try:
        _db.collection("users").document(uid).collection("subjects").document(subject_id).set(data)
        return saved
    except Exception as e:
        print(f"[AttendX] Firestore save_subject error: {e}")
        return saved


def delete_subject(uid: str, subject_id: str) -> bool:
    """Delete a subject by ID. Returns True if successful."""
    if _is_dev():
        subjects = _mem_store["subjects"].get(uid, [])
        new_list = [s for s in subjects if s["id"] != subject_id]
        if len(new_list) == len(subjects):
            return False
        _mem_store["subjects"][uid] = new_list
        return True

    try:
        _db.collection("users").document(uid).collection("subjects").document(subject_id).delete()
        return True
    except Exception as e:
        print(f"[AttendX] Firestore delete_subject error: {e}")
        return False


def clear_all_subjects(uid: str) -> bool:
    """Delete all subjects for a user."""
    if _is_dev():
        _mem_store["subjects"][uid] = []
        return True

    try:
        docs = _db.collection("users").document(uid).collection("subjects").stream()
        batch = _db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
        return True
    except Exception as e:
        print(f"[AttendX] Firestore clear_all_subjects error: {e}")
        return False


# ── Timetable ───────────────────────────────────────────────

def get_timetable(uid: str) -> Optional[dict]:
    """Fetch the user's timetable data."""
    if _is_dev():
        return _mem_store["timetable"].get(uid)

    try:
        doc = _db.collection("users").document(uid).collection("timetable").document("data").get()
        return doc.to_dict() if doc.exists else None
    except Exception as e:
        print(f"[AttendX] Firestore get_timetable error: {e}")
        return None


def save_timetable(uid: str, timetable_data: dict) -> bool:
    """Save or update the user's timetable."""
    data = {**timetable_data, "updatedAt": __now_iso()}

    if _is_dev():
        _mem_store["timetable"][uid] = data
        return True

    try:
        _db.collection("users").document(uid).collection("timetable").document("data").set(data)
        return True
    except Exception as e:
        print(f"[AttendX] Firestore save_timetable error: {e}")
        return False


# ── Attendance Logs ─────────────────────────────────────────

def get_attendance_logs(uid: str, date: Optional[str] = None) -> list[dict]:
    """Fetch attendance logs for a user, optionally filtered by date."""
    if _is_dev():
        logs = _mem_store["logs"].get(uid, [])
        if date:
            return [l for l in logs if l.get("date") == date]
        return logs

    try:
        query = _db.collection("users").document(uid).collection("attendanceLogs")
        if date:
            query = query.where("date", "==", date)
        docs = query.stream()
        return [{"id": d.id, **d.to_dict()} for d in docs]
    except Exception as e:
        print(f"[AttendX] Firestore get_attendance_logs error: {e}")
        return []


def save_attendance_log(uid: str, log: dict) -> bool:
    """Save an attendance log entry."""
    if _is_dev():
        logs = _mem_store["logs"].setdefault(uid, [])
        log_id = log["id"]
        idx = next((i for i, l in enumerate(logs) if l.get("id") == log_id), None)
        entry = {**log, "loggedAt": __now_iso()}
        if idx is not None:
            logs[idx] = entry
        else:
            logs.append(entry)
        return True

    try:
        log_id = log["id"]
        data = {**log, "loggedAt": __now_iso()}
        _db.collection("users").document(uid).collection("attendanceLogs").document(log_id).set(data)
        return True
    except Exception as e:
        print(f"[AttendX] Firestore save_attendance_log error: {e}")
        return False


# ── Helpers ─────────────────────────────────────────────────

def __now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
