"""
Tests for the timetable extract endpoint.
"""

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
HEADERS = {"Authorization": "Bearer test-token-12345"}


def test_extract_without_file():
    resp = client.post("/timetable/extract", headers=HEADERS)
    assert resp.status_code == 422  # Missing required file field


def test_extract_with_invalid_file_type():
    resp = client.post(
        "/timetable/extract",
        headers=HEADERS,
        files={"file": ("test.txt", b"hello world", "text/plain")},
    )
    assert resp.status_code == 400
    assert "Unsupported" in resp.json()["detail"]


def test_extract_with_empty_pdf():
    from io import BytesIO
    # Minimal valid PDF (empty)
    minimal_pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
        b"xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n"
        b"0000000058 00000 n \ntrailer<</Size 3/Root 1 0 R>>\nstartxref\n118\n%%EOF"
    )
    resp = client.post(
        "/timetable/extract",
        headers=HEADERS,
        files={"file": ("empty.pdf", minimal_pdf, "application/pdf")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "text" in data
    assert "tables" in data


def test_extract_image_success():
    # 1x1 valid PNG
    minimal_png = (
        b"\x89PNG\r\n\x1a\n"  # PNG signature
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    resp = client.post(
        "/timetable/extract",
        headers=HEADERS,
        files={"file": ("test.png", minimal_png, "image/png")},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["contentType"] == "image/png"
    assert data["message"].startswith("Image uploaded")
