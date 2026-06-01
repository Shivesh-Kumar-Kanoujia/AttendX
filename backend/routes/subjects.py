"""
AttendX Backend — routes/subjects.py
POST /save-subject   — create or update a subject
GET  /get-subjects   — fetch all subjects for the authenticated user
DELETE /delete-subject/{subject_id} — delete a subject
DELETE /clear-all    — delete all subjects

Uses Firestore Admin SDK for persistence (via services/firestore_db.py).
Falls back to in-memory if Firestore is unavailable (dev mode).
"""

from fastapi import APIRouter, HTTPException, Depends, status

from models.subject import SubjectPayload, SubjectResponse
from utils.auth import get_uid
from services import firestore_db as fs

router = APIRouter()


# ── GET /subjects ─────────────────────────────────────────────
@router.get("", response_model=list[SubjectResponse])
def get_subjects(uid: str = Depends(get_uid)):
    """Return all subjects for the authenticated user."""
    return fs.get_subjects(uid)


# ── POST /subjects/save ────────────────────────────────────────
@router.post("/save", response_model=SubjectResponse)
def save_subject(payload: SubjectPayload, uid: str = Depends(get_uid)):
    """Upsert a subject (create or update by subject_id)."""
    subject_dict = {
        "id":        payload.id,
        "name":      payload.name,
        "total":     payload.total,
        "attended":  payload.attended,
        "required":  payload.required,
        "updatedAt": payload.updated_at,
    }
    return fs.save_subject(uid, subject_dict)


# ── DELETE /subjects/delete/{subject_id} ──────────────────────
@router.delete("/delete/{subject_id}")
def delete_subject(subject_id: str, uid: str = Depends(get_uid)):
    """Delete one subject by ID."""
    deleted = fs.delete_subject(uid, subject_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Subject not found or could not be deleted")
    return {"message": "Deleted", "id": subject_id}


# ── DELETE /subjects/clear-all ─────────────────────────────────
@router.delete("/clear-all")
def clear_all(uid: str = Depends(get_uid)):
    """Delete all subjects for the authenticated user."""
    fs.clear_all_subjects(uid)
    return {"message": "All subjects cleared"}