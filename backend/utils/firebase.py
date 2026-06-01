"""
AttendX Backend — utils/firebase.py
Firebase Admin SDK token verification.

Setup:
  1. Go to Firebase Console → Project Settings → Service Accounts
  2. Click "Generate new private key" → downloads a JSON file
  3. Save that JSON as backend/serviceAccountKey.json
  4. Set the environment variable GOOGLE_APPLICATION_CREDENTIALS to the path
     (handled in .env or by your runner)

Alternatively, paste the private key fields directly into .env:
  FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
"""

import os
import json
from typing import Optional

import firebase_admin
from firebase_admin import credentials
from firebase_admin import auth as fb_auth

# ── Initialise once ───────────────────────────────────────────
_initialized = False


def _get_cred():
    """
    Load Firebase credentials from one of:
      1. GOOGLE_APPLICATION_CREDENTIALS env var (path to JSON key file)
      2. Manual env vars: FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
    """
    # Path-based credential (service account JSON file)
    cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if cred_path and os.path.exists(cred_path):
        return credentials.Certificate(cred_path)

    # Manual env-var credential (useful when key file isn't available locally)
    project_id     = os.getenv("FIREBASE_PROJECT_ID")
    client_email   = os.getenv("FIREBASE_CLIENT_EMAIL")
    private_key    = os.getenv("FIREBASE_PRIVATE_KEY")

    if project_id and client_email and private_key:
        # The private key from the JSON has escaped newlines; un-escape them
        pk = private_key.replace("\\n", "\n")
        return credentials.Certificate({
            "type": "service_account",
            "project_id": project_id,
            "client_email": client_email,
            "private_key": pk,
            "token_uri": "https://oauth2.googleapis.com/token",
        })

    return None


def _ensure_initialised():
    global _initialized
    if not _initialized:
        cred = _get_cred()
        if cred:
            firebase_admin.initialize_app(cred)
        else:
            # Development mode — skip Firebase verification
            pass
        _initialized = True


def verify_firebase_token(id_token: str) -> Optional[str]:
    """
    Verify a Firebase ID token and return the UID.
    Returns None if verification fails.

    In development mode (no Firebase credentials), returns the token
    itself as a fake UID so you can test without a real Firebase setup.
    """
    if not id_token:
        return None

    _ensure_initialised()

    try:
        decoded = fb_auth.verify_id_token(id_token)
        return decoded.get("uid")
    except Exception as e:
        # If Firebase isn't configured, fall back to dev mode
        # where any non-empty token is treated as valid with uid = "dev_<first 8 chars>"
        if _get_cred() is None:
            # Dev mode — accept any non-empty token
            return f"dev_{id_token[:8]}"
        # Real mode but token is invalid
        print(f"[AttendX] Token verification failed: {e}")
        return None