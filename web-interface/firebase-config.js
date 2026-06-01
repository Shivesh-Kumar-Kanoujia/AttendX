/**
 * AttendX — firebase-config.js
 * ─────────────────────────────────────────────────────────────
 * This file contains the Firebase project config — values are
 * intentionally public (they just tell the SDK which project to
 * connect to). Real security comes from:
 *   - Firebase Security Rules (Firestore)
 *   - Authorized domains (Authentication)
 *   - API key referrer restrictions (Cloud Console)
 * 
 * For production deployments, create a NEW Firebase project and
 * replace the config below with its values.
 * 
 * ── FIREBASE CONSOLE SECURITY CONFIGURATION ──────────────────
 * Before deploying to production, configure these in the
 * Firebase Console (console.firebase.google.com):
 * 
 * 1. API KEY RESTRICTIONS (APIs & Services > Credentials)
 *    - Restrict the API key to "HTTP referrers (websites)"
 *    - Add your production domain(s), e.g.:
 *        https://yourdomain.com/*
 *        http://localhost:*  (for local dev)
 *    - Under "API restrictions", select "Don't restrict key"
 *      (Firebase SDK uses multiple Google APIs dynamically)
 * 
 * 2. AUTHENTICATION > Settings > Authorized domains
 *    - Add your production domain if it differs from the
 *      default firebaseapp.com domain
 *    - Defaults allowed: projectId.firebaseapp.com
 * 
 * 3. AUTHENTICATION > Sign-in providers
 *    - Enable "Google" and "Email/Password"
 *    - For Google: add support email in "Public-facing name"
 * 
 * 4. FIRESTORE > Rules (paste the rules below)
 *    rules_version = '2';
 *    service cloud.firestore {
 *      match /databases/{database}/documents {
 *        // Only authenticated users can access their own data
 *        match /users/{userId}/{document=**} {
 *          allow read, write: if request.auth != null
 *                            && request.auth.uid == userId;
 *        }
 *      }
 *    }
 * 
 * 5. FIRESTORE > Indexes
 *    No composite indexes needed — all queries use single-field
 *    equality filters on the document ID.
 * 
 * ─────────────────────────────────────────────────────────────
 *
 * ── DEPLOYMENT ────────────────────────────────────────────────
 * Frontend → Vercel
 *   - Push repo, Vercel auto-detects from vercel.json
 *   - Set env var: ATTENDX_API_URL = https://your-backend.onrender.com
 *
 * Backend  → Render
 *   - Connect repo, set root to `backend/`
 *   - Build command: pip install -r requirements.txt
 *   - Start command: uvicorn main:app --host 0.0.0.0 --port $PORT
 *   - Set env vars: ENVIRONMENT=production, FRONTEND_URL, and Firebase creds
 *   - Render auto-assigns *.onrender.com — CORS already handles it
 *
 * ─────────────────────────────────────────────────────────────
 */

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const FIREBASE_VERSION = "10.12.2";

// ── PASTE YOUR CONFIG HERE ────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyB9PWvWIQKLK0x5nXkAHB5Yl6HEsJorQwo",
    authDomain: "attendx-b0cf6.firebaseapp.com",
    projectId: "attendx-b0cf6",
    storageBucket: "attendx-b0cf6.firebasestorage.app",
    messagingSenderId: "918785691364",
    appId: "1:918785691364:web:a3071f523c4359f9f2a6f1",
    measurementId: "G-MGS3LKB7YC"
  };

// ─────────────────────────────────────────────────────────────

const app  = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
