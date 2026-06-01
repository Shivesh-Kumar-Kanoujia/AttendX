"""
AttendX Backend — main.py
FastAPI app with Firebase ID token authentication.
"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import subjects, timetable

app = FastAPI(
    title="AttendX API",
    description="Attendance Calculator backend — Firebase-authenticated CRUD",
    version="1.0.0",
)

# CORS — restrict in production, allow all in development
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
ALLOWED_ORIGINS = ["*"] if ENVIRONMENT == "development" else [
    "https://attendx.vercel.app",
    os.getenv("FRONTEND_URL", ""),
]
# Also allow Railway-assigned domain if present
for var in ("RAILWAY_PUBLIC_DOMAIN", "RAILWAY_STATIC_URL"):
    if val := os.getenv(var):
        ALLOWED_ORIGINS.append(f"https://{val}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in ALLOWED_ORIGINS if o],
    allow_origin_regex=r"https://attendx-git-.*attendx\.vercel\.app" if ENVIRONMENT != "development" else None,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Health check ─────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "attendx-api", "environment": ENVIRONMENT}

# ── Mount routers ─────────────────────────────────────────────
app.include_router(subjects.router, prefix="/subjects", tags=["Subjects"])
app.include_router(timetable.router, prefix="/timetable", tags=["Timetable"])


# ── Entry point — used by Railway ─────────────────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")
    uvicorn.run("main:app", host=host, port=port, reload=(ENVIRONMENT == "development"))