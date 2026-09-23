from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient
from app.main import app
from app.db import get_db, Base
from app.security import get_current_user_id
from app import db as db_module
from app import storage as storage_module


def _override_get_db(tmp_path):
    db_path = tmp_path / "api_test.db"
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=engine)
    TestSessionLocal = sessionmaker(bind=engine)

    def override():
        db = TestSessionLocal()
        try:
            yield db
        finally:
            db.close()

    return override, TestSessionLocal


def test_create_and_fetch_job(tmp_path, sample_video, monkeypatch):
    override, TestSessionLocal = _override_get_db(tmp_path)
    app.dependency_overrides[get_db] = override
    app.dependency_overrides[get_current_user_id] = lambda: "test-user-1"
    db_module.SessionLocal = TestSessionLocal

    monkeypatch.setattr(
        storage_module,
        "upload_file",
        lambda path, data, content_type="application/octet-stream": path,
    )
    monkeypatch.setattr(
        storage_module,
        "get_signed_url",
        lambda path, expires_in=3600: f"https://fake-storage.test/{path}",
    )

    client = TestClient(app)

    with open(sample_video, "rb") as f:
        response = client.post(
            "/jobs",
            files={"file": ("sample.mp4", f, "video/mp4")},
            data={"source_language": "yo", "target_language": "en", "voice_clone": "false"},
        )

    assert response.status_code == 201
    job_id = response.json()["id"]

    status_response = client.get(f"/jobs/{job_id}")
    assert status_response.status_code == 200
    body = status_response.json()
    assert body["status"] == "done"
    assert body["output_video_url"] == f"https://fake-storage.test/jobs/{job_id}/output.mp4"
    assert body["output_srt_url"] == f"https://fake-storage.test/jobs/{job_id}/subtitles.srt"

    app.dependency_overrides.clear()


def test_create_job_rejects_unsupported_content_type(tmp_path, monkeypatch):
    override, TestSessionLocal = _override_get_db(tmp_path)
    app.dependency_overrides[get_db] = override
    app.dependency_overrides[get_current_user_id] = lambda: "test-user-1"
    db_module.SessionLocal = TestSessionLocal

    client = TestClient(app)

    response = client.post(
        "/jobs",
        files={"file": ("notes.txt", b"not a video", "text/plain")},
        data={"source_language": "yo", "target_language": "en", "voice_clone": "false"},
    )

    assert response.status_code == 400
    app.dependency_overrides.clear()
