"""
AttendX Backend — utils/auth.py
Shared FastAPI dependency for Firebase ID token verification.
"""

from fastapi import HTTPException, Header, status
from typing import Optional

from utils.firebase import verify_firebase_token


def get_uid(authorization: Optional[str] = Header(None)) -> str:
    """Validate Bearer token and return the Firebase UID."""
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Authorization format — use: Bearer <token>",
        )
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty token",
        )
    uid = verify_firebase_token(token)
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Firebase ID token",
        )
    return uid
