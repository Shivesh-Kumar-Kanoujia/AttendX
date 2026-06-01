"""
AttendX Backend — routes/timetable.py
PDF text extraction using pdfplumber with multiple strategies:
  1. Table extraction (best for grid-based timetables)
  2. Word-level extraction with bounding boxes (for layout reconstruction)
  3. Raw text fallback

Image uploads: stored for later reference (parsing happens client-side).
"""

import io
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
import pdfplumber

from utils.auth import get_uid

router = APIRouter(tags=["Timetable"])

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_CONTENT_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
}


@router.post("/extract")
async def extract_file(file: UploadFile = File(...), uid: str = Depends(get_uid)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    # File size check
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)}MB.",
        )

    # Content type validation
    content_type = file.content_type or ""
    if content_type not in ALLOWED_CONTENT_TYPES and not content_type.startswith("image/"):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Only PDF, JPEG, and PNG are allowed.",
        )

    # PDF extraction
    if content_type == "application/pdf":
        return _extract_pdf(contents, file.filename)

    # Image — store metadata, return file info (parsing done client-side)
    return {
        "text": "",
        "lines": [],
        "tables": [],
        "words": [],
        "filename": file.filename,
        "fileSize": len(contents),
        "contentType": content_type,
        "message": "Image uploaded. Parsing will be done on the client side."
    }


def _extract_pdf(contents: bytes, filename: str) -> dict:
    """Extract text, tables, and word positions from a PDF buffer."""
    tables_data = []
    words_data = []
    raw_text = ""

    try:
        with pdfplumber.open(io.BytesIO(contents)) as pdf:
            for page in pdf.pages:
                # Strategy 1: Table extraction
                tables = page.extract_tables()
                for table in tables:
                    rows = []
                    for row in table:
                        rows.append([cell.strip() if cell else "" for cell in row])
                    if rows:
                        tables_data.append({
                            "page": page.page_number,
                            "rows": rows,
                        })

                # Strategy 2: Word-level extraction with positions
                words = page.extract_words(keep_blank_chars=True, x_tolerance=3)
                for w in words:
                    words_data.append({
                        "text": w["text"],
                        "x0": round(w["x0"], 1),
                        "y0": round(w["top"], 1),
                        "x1": round(w["x1"], 1),
                        "y1": round(w["bottom"], 1),
                        "page": page.page_number,
                    })

                # Strategy 3: Raw text
                extracted = page.extract_text()
                if extracted:
                    raw_text += extracted + "\n"

        lines = [line.strip() for line in raw_text.split("\n") if line.strip()]

        return {
            "text": raw_text,
            "lines": lines,
            "tables": tables_data,
            "words": words_data,
            "filename": filename,
            "message": "ok" if raw_text.strip() else "No text could be extracted from this PDF."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract PDF: {str(e)}")
