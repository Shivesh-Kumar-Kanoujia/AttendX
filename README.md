# AttendX — Smart Attendance Calculator

A full-stack attendance tracker with Firebase Auth + FastAPI backend + glassmorphism UI.

---

## Project Structure

```
project-2/
├── web-interface/          ← Frontend (HTML + Tailwind + ES modules)
│   ├── index.html          ← Main app shell
│   ├── style.css           ← Glassmorphism theme
│   ├── script.js           ← App logic (tabs, math, rendering)
│   ├── auth.js             ← Firebase Auth (Google + Email/Password)
│   ├── api.js              ← FastAPI HTTP client
│   ├── db.js               ← Firestore CRUD (original)
│   ├── storage.js          ← localStorage fallback (offline mode)
│   └── firebase-config.js  ← Your Firebase project config
│
└── backend/                ← FastAPI backend
    ├── main.py             ← FastAPI app entry point
    ├── requirements.txt    ← Python dependencies
    ├── .env                ← Firebase credentials (local)
    ├── .env.example        ← Template for .env
    ├── routes/
    │   └── subjects.py     ← /save-subject, /get-subjects, /delete, /clear-all
    ├── models/
    │   └── subject.py      ← Pydantic request/response schemas
    └── utils/
        └── firebase.py    ← Firebase Admin SDK token verification
```

---

## Quick Start

### 1. Backend

```bash
cd backend
pip install -r requirements.txt

# Place your Firebase service account JSON file (from Firebase Console
# → Project Settings → Service Accounts → Generate new private key)
# as backend/serviceAccountKey.json

# Or set credentials manually in .env (see .env.example)
# Then run:
uvicorn main:app --reload --port 8000
```

Backend runs at `http://127.0.0.1:8000`

API docs available at `http://127.0.0.1:8000/docs`

---

### 2. Frontend

Open `web-interface/index.html` directly in a browser
(or serve via VS Code Live Server / any static file server):

```bash
# Using Python's built-in server (from project root):
python -m http.server 5500 --directory web-interface
# Then visit http://localhost:5500
```

**No build step needed** — pure HTML/CSS/JS with ES module imports.

---

## Features

| Feature | Description |
|---------|-------------|
| **Optional Login** | Use the calculator without an account. Sign in to sync data. |
| **Guest Mode** | Full calculator access, data saved to localStorage |
| **Google Sign-In** | One-click OAuth via Firebase |
| **Email/Password** | Traditional registration + login |
| **FastAPI Backend** | RESTful API with Firebase ID token auth |
| **Offline Fallback** | If FastAPI is unreachable, falls back to localStorage |
| **Real-time Updates** | Firebase Firestore listener (or 2s polling when using API) |
| **Glassmorphism UI** | Off-white + black glass cards, blur effects, smooth animations |

---

## Firebase Setup (Frontend)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a project (or use existing)
3. Project Settings → Your apps → Web → Register app
4. Copy the `firebaseConfig` object into `web-interface/firebase-config.js`
5. Enable Authentication:
   - Sign-in Methods: **Google**, **Email/Password**
6. For Firestore (original mode): Create database, set rules to allow authenticated reads/writes

---

## Firebase Admin Setup (Backend)

1. Firebase Console → Project Settings → Service Accounts
2. Click **"Generate new private key"** → download the JSON
3. Save as `backend/serviceAccountKey.json`
4. Set in `.env`:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
   ```

Alternatively, paste fields from the JSON directly into `.env` (see `.env.example`).

---

## API Endpoints

All endpoints require `Authorization: Bearer <firebase_id_token>` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/subjects` | Get all subjects for the authenticated user |
| POST | `/subjects/save` | Create or update a subject |
| DELETE | `/subjects/delete/{id}` | Delete a subject by ID |
| DELETE | `/subjects/clear-all` | Delete all subjects |
| POST | `/timetable/extract` | Extract timetable from PDF/image |

---

## Deployment

### Frontend → Vercel

1. Push the repo to GitHub
2. Import project in Vercel
3. Set **Root Directory** to `web-interface`
4. Add env variable `ATTENDX_API_URL` → your Railway backend URL
5. Deploy — Vercel auto-detects static files

Or from CLI:
```bash
npx vercel --prod
```

### Backend → Railway

1. Create new Railway project from GitHub
2. Set **Root Directory** to `backend`
3. Add environment variables:
   - `ENVIRONMENT=production`
   - `GOOGLE_APPLICATION_CREDENTIALS` → content of your `serviceAccountKey.json`
   - `FRONTEND_URL` → your Vercel frontend URL
4. Railway auto-detects the `Dockerfile` and deploys

---

## Auth Bug Fixes Applied

1. **Removed broken 3-second timeout** — auth state was silently swallowed
2. **Added `setPersistence(auth, browserLocalPersistence)`** — login survives page refresh
3. **Simplified `onAuthStateChanged` flow** — single observer, no race conditions
4. **Proper error mapping** — all Firebase auth error codes mapped to human-readable messages

---

## UI Changes

- "Sign In" button always visible in navbar (top-right)
- User avatar + name shown only when logged in
- "Sign Out" button appears after login
- Guest users see "Guest mode — sign in to sync" in footer
- Saving a subject while logged out → prompts login screen
- Quick Calculator accessible without any login