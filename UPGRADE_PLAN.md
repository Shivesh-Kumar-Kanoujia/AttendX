# AttendX — Upgrade & Implementation Plan

## Chosen Architecture
- **Backend DB:** Firestore Admin SDK (single source of truth, real-time)
- **Deployment:** Vercel (frontend) + Railway (backend)
- **Image Parsing:** Heuristic grid detection client-side (Canvas API), manual editor fallback

---

## Phase 1 — Security & Secrets (Days 1–2)

### 1.1 Fix `.gitignore`
Add secrets patterns to prevent leaking credentials.

**Files**: `.gitignore`

**Tasks:**
- Add `serviceaccountkey.json`, `backend/serviceaccountkey.json`
- Add `backend/.env`, `.env`
- Add `*.key` glob pattern
- Ensure `web-interface/firebase-config.js` is listed (already present)

### 1.2 Auth on `/timetable/extract`
Apply Firebase ID token verification to the PDF/image extraction endpoint.

**Files**: `backend/routes/timetable.py`

**Tasks:**
- Import `get_uid` from subjects router (or extract to shared dependency)
- Add `Authorization: Bearer <token>` requirement to extract endpoint
- Return 401 if no valid token

### 1.3 Fix Guest Storage Key Collision
Guest users on the same browser share timetable and logs data because keys lack a UID prefix.

**Files**: `web-interface/storage.js`

**Tasks:**
- Prefix `LS_KEY_TIMETABLE` and `LS_KEY_LOGS` keys with the guest UID
- Update all functions that read/write these keys

### 1.4 Backend File Validation
Server-side file validation for the extract endpoint.

**Files**: `backend/routes/timetable.py`

**Tasks:**
- Enforce file size limit (e.g., 10MB)
- Validate MIME type server-side
- Add proper error messages

### 1.5 Firestore Security Rules
Guidelines for Firestore security rules in Firebase Console.

**Rules to apply:**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## Phase 2 — Backend Refactor + Firestore Admin (Days 3–4)

### 2.1 Firestore Admin Service Layer
Create a centralized service for Firestore CRUD operations.

**Files**: `backend/services/firestore_db.py` **[NEW]**

**Tasks:**
- Initialize Firestore Admin client
- `get_subjects(uid)` — fetch all subjects for a user
- `save_subject(uid, subject)` — upsert a subject
- `delete_subject(uid, id)` — delete by ID
- `clear_all_subjects(uid)` — delete all
- `save_timetable(uid, data)` — store timetable
- `get_timetable(uid)` — fetch timetable
- `save_attendance_log(uid, log)` — log attendance

### 2.2 Replace In-Memory Store
Swap the `_store` dict in subjects router with Firestore calls.

**Files**: `backend/routes/subjects.py`

**Tasks:**
- Remove `_store` global dict
- Call `firestore_db` service for all operations
- Keep response models unchanged

### 2.3 Railway Port Config
Use the port Railway provides via env variable.

**Files**: `backend/main.py`

**Tasks:**
- Read `PORT` from environment, default to 8000
- Pass to uvicorn in `if __name__ == "__main__"` block

### 2.4 Production CORS
Restrict CORS in production to the Vercel deployment URL.

**Files**: `backend/main.py`

**Tasks:**
- Check `ENVIRONMENT` env var
- If production, set `allow_origins` to Vercel URL
- If development, keep `["*"]`

---

## Phase 3 — Deployment Config (Days 5–6)

### 3.1 Configurable API URL
Frontend should use production API URL when deployed.

**Files**: `web-interface/api.js`

**Tasks:**
- Read `window.ATTENDX_API_URL` or fallback to `http://127.0.0.1:8000`
- In production, set this via Vercel env variable or global script

### 3.2 Vercel Config
Static file deployment for the frontend.

**Files**: `vercel.json` **[NEW]**

**Content:**
```json
{
  "version": 2,
  "builds": [
    { "src": "web-interface/**", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "web-interface/$1" }
  ]
}
```

### 3.3 Railway Dockerfile
Containerize the FastAPI backend for Railway.

**Files**: `Dockerfile` **[NEW]**, `runtime.txt` **[NEW]**

**Tasks:**
- Use `python:3.12-slim` base
- Install dependencies from `requirements.txt`
- Expose port from env
- Run uvicorn with `main:app`

### 3.4 Deployment Documentation
Update README with deployment instructions.

**Files**: `README.md`

**Tasks:**
- Add Vercel deployment steps
- Add Railway deployment steps
- Note: `serviceAccountKey.json` must be added as Railway secret/env

---

## Phase 4 — Heuristic Image Grid Detection (Days 7–9)

### 4.1 Image Grid Detector Module
Canvas-based heuristic detection of table grids in timetable images.

**Files**: `web-interface/image-grid-detector.js` **[NEW]**

**Algorithm:**
1. Load image onto hidden Canvas at reduced scale
2. Use `getImageData` to scan pixel rows/columns for repeated color transitions (grid lines)
3. Detect horizontal lines: scan across each row, find consistent rows with high contrast changes
4. Detect vertical lines: scan down each column, find consistent columns with high contrast changes
5. Infer table cell boundaries from intersecting lines
6. Return array of cell regions with their (x, y, width, height) coordinates
7. For each cell, determine if it contains significant non-white/non-background pixels (text presence)
8. Map cells to a structured grid with day columns and time rows

**Limitations recognized upfront:**
- No text recognition — cells detected as "has content" or "empty"
- Works best with high-contrast printed table grids
- Falls through to manual editor if no grid found

### 4.2 Integrate into Parser Pipeline
Insert the image detector into the existing parse flow.

**Files**: `web-interface/timetable-parser.js`

**Tasks:**
- Add image detection step between client-side pdf parsing and manual editor
- For image uploads: try backend → try image grid detector → manual editor
- Pass detected cell structure to the editor modal for user confirmation/correction

### 4.3 Backend Image Endpoint
Optionally accept images on the backend for storage/preprocessing.

**Files**: `backend/routes/timetable.py`

**Tasks:**
- Accept both PDF and image files
- Return metadata about the file (dimensions, type)
- Primary detection runs client-side for responsiveness

---

## Phase 5 — Guest Data Migration (Days 10–11)

### 5.1 Migration Detection
Detect existing localStorage data when a guest signs up or logs in.

**Files**: `web-interface/auth.js`, `web-interface/script.js`

**Tasks:**
- After successful login, check if localStorage has data for the temporary guest UID
- If yes, show a migration prompt

### 5.2 Migration UI
Prompt the user to import local data.

**Files**: `web-interface/index.html`, `web-interface/script.js`

**Tasks:**
- Add a modal: "We found local data. Import to your account?"
- Buttons: "Import & Continue" / "Discard Local Data"
- Show progress during import

### 5.3 Migration Logic
Copy all data from localStorage to Firestore.

**Files**: `web-interface/db.js`, `web-interface/storage.js`

**Tasks:**
- `migrateGuestData(uid)` — reads all localStorage data
- Writes to Firestore under the authenticated user's collections
- On success, clears localStorage and shows success toast

---

## Phase 6 — Testing & CI (Days 12–13)

### 6.1 Backend Tests
pytest with FastAPI TestClient.

**Files**: `backend/tests/test_subjects.py` **[NEW]**, `backend/tests/test_auth.py` **[NEW]**, `backend/tests/test_timetable.py` **[NEW]**, `backend/tests/__init__.py` **[NEW]**

**Test cases:**
- Health check returns 200
- GET /subjects without auth returns 401
- GET /subjects with valid token returns list
- POST /subjects/save creates and updates
- DELETE /subjects/delete/{id} removes a subject
- POST /timetable/extract with valid PDF returns extracted data
- POST /timetable/extract without auth returns 401
- POST /timetable/extract with invalid file returns 400

### 6.2 Frontend Math Tests
Core math function tests.

**Files**: `web-interface/tests/math.test.js` **[NEW]**, `web-interface/tests/package.json` **[NEW]**

**Test cases:**
- `currentPercent(45, 60)` → 75
- `currentPercent(0, 0)` → 0
- `maxBunkable(45, 60, 75)` → 0
- `maxBunkable(57, 60, 75)` → 16
- `minAttendRequired(30, 60, 75)` → 60
- `minAttendRequired(45, 60, 75)` → 0
- `getStatus(80, 75)` → "safe"
- `getStatus(72, 75)` → "warn"
- `getStatus(60, 75)` → "danger"

### 6.3 GitHub Actions CI
Automated testing on push and PR.

**Files**: `.github/workflows/ci.yml` **[NEW]**

**Workflow:**
- Trigger: push to main, pull requests
- Backend: setup Python, install deps, run pytest
- Frontend: setup Node, install vitest, run math tests
- Optional: linting step

---

## Phase 7 — UX Polish (Days 14–16)

### 7.1 Weekly Timetable View
A 7-day grid view alongside the existing daily timeline.

**Files**: `web-interface/timetable-week-view.js` **[NEW]**

**Features:**
- Grid with 7 columns (days) and time rows
- Color-coded class cards in each cell
- Click a class to see details or mark attendance
- Navigation: "This Week" / arrows to next/previous week

### 7.2 Lazy-Load Chart.js
Only load Chart.js when the Dashboard tab is activated.

**Files**: `web-interface/index.html`, `web-interface/script.js`

**Tasks:**
- Remove Chart.js `<script>` tag from HTML
- Dynamically import in `renderChart()`: `const Chart = await import("https://...")`

### 7.3 Shared Utils Module
Deduplicate helper functions.

**Files**: `web-interface/utils.js` **[NEW]**

**Functions to extract:**
- `escHtml(str)` — currently in 3 files
- `generateId()` — currently in script.js
- `todayYMD()` — currently in timetable-engine.js and timetable-view.js
- `showToast(msg)` — currently in script.js and timetable-parser.js

### 7.4 Reduce localStorage Polling
Improve the polling-based subscription in storage.js.

**Files**: `web-interface/storage.js`

**Tasks:**
- Change interval from 500ms to 2000ms
- Add `StorageEvent` listener for cross-tab sync when supported

### 7.5 Class Start Notifications
Optional browser notifications for upcoming classes.

**Files**: `web-interface/timetable-engine.js`

**Tasks:**
- Add notification check in `tick()`: if a class starts in 5 minutes and Notification permission granted, show notification
- Add "Notify me" toggle in the timetable tab
- Request Notification permission on first class detection

---

## Files to Create (11 new)

```
backend/
├── services/
│   └── firestore_db.py
├── tests/
│   ├── __init__.py
│   ├── test_subjects.py
│   ├── test_auth.py
│   └── test_timetable.py

web-interface/
├── image-grid-detector.js
├── timetable-week-view.js
├── utils.js
├── tests/
│   ├── package.json
│   └── math.test.js

.github/
└── workflows/
    └── ci.yml

Dockerfile
vercel.json
runtime.txt
```

## Files to Modify (13 existing)

```
.gitignore
web-interface/index.html
web-interface/script.js
web-interface/api.js
web-interface/storage.js
web-interface/db.js
web-interface/timetable-parser.js
web-interface/timetable-engine.js
web-interface/timetable-view.js
web-interface/auth.js
backend/main.py
backend/routes/subjects.py
backend/routes/timetable.py
README.md
```

## Effort Estimate

| Phase | Estimated Time | Delivers |
|-------|---------------|----------|
| Phase 1 | 2 days | Secure app, no secrets leaking |
| Phase 2 | 2 days | Persistent backend, deployable |
| Phase 3 | 2 days | Live on Vercel + Railway |
| Phase 4 | 3 days | Images partially parseable |
| Phase 5 | 2 days | Guest data preserved on sign-up |
| Phase 6 | 2 days | Tests + CI pipeline |
| Phase 7 | 3 days | Polish + weekly view |
| **Total** | **~16 days** | Production-ready app |
