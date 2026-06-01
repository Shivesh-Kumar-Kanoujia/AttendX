"""
Tests for authentication on protected endpoints.
"""

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

HEADERS = {"Authorization": "Bearer test-token-12345"}


def test_get_subjects_without_auth():
    response = client.get("/subjects")
    assert response.status_code == 401


def test_get_subjects_with_auth():
    response = client.get("/subjects", headers=HEADERS)
    # Dev mode accepts any Bearer token
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_save_subject_without_auth():
    response = client.post("/subjects/save", json={
        "id": "test-1",
        "name": "Mathematics",
        "total": 60,
        "attended": 45,
        "required": 75,
        "updated_at": "2026-01-01T00:00:00Z",
    })
    assert response.status_code == 401


def test_delete_without_auth():
    response = client.delete("/subjects/delete/test-1")
    assert response.status_code == 401


def test_clear_all_without_auth():
    response = client.delete("/subjects/clear-all")
    assert response.status_code == 401


def test_timetable_extract_without_auth():
    response = client.post("/timetable/extract")
    assert response.status_code == 401
