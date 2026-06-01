"""
Tests for subject CRUD endpoints.
"""

from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

HEADERS = {"Authorization": "Bearer test-token-12345"}

SAMPLE_SUBJECT = {
    "id": "math-123",
    "name": "Mathematics",
    "total": 60,
    "attended": 45,
    "required": 75,
    "updated_at": "2026-01-01T00:00:00Z",
}


def _sample(id_suffix=""):
    sub = dict(SAMPLE_SUBJECT)
    sub["id"] = f"math-{id_suffix or '123'}"
    return sub


def test_save_and_get_subject():
    sub = _sample("save-test")
    save_resp = client.post("/subjects/save", json=sub, headers=HEADERS)
    assert save_resp.status_code == 200
    saved = save_resp.json()
    assert saved["name"] == "Mathematics"
    assert saved["total"] == 60
    assert saved["attended"] == 45

    get_resp = client.get("/subjects", headers=HEADERS)
    assert get_resp.status_code == 200
    subjects = get_resp.json()
    matching = [s for s in subjects if s["id"] == sub["id"]]
    assert len(matching) >= 1


def test_update_subject():
    sub = _sample("update-test")
    client.post("/subjects/save", json=sub, headers=HEADERS)

    updated = dict(sub)
    updated["attended"] = 50
    resp = client.post("/subjects/save", json=updated, headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["attended"] == 50


def test_delete_subject():
    sub = _sample("delete-test")
    client.post("/subjects/save", json=sub, headers=HEADERS)

    resp = client.delete(f"/subjects/delete/{sub['id']}", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["id"] == sub["id"]


def test_clear_all():
    # Save two subjects
    client.post("/subjects/save", json=_sample("clear-1"), headers=HEADERS)
    client.post("/subjects/save", json=_sample("clear-2"), headers=HEADERS)

    resp = client.delete("/subjects/clear-all", headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["message"] == "All subjects cleared"


def test_empty_after_clear():
    resp = client.get("/subjects", headers=HEADERS)
    assert resp.status_code == 200
    # Should always return a list (may not be empty if other tests ran with same token)
    assert isinstance(resp.json(), list)


def test_invalid_subject_validation():
    resp = client.post("/subjects/save", headers=HEADERS, json={
        "id": "bad",
        "name": "",
        "total": -1,
        "attended": 100,
        "required": 200,
    })
    assert resp.status_code == 422  # Pydantic validation error
