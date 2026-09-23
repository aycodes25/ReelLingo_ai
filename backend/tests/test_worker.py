from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app import db as db_module
from app.models import Job
from app import worker


def _setup_test_db(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}")
    db_module.Base.metadata.create_all(bind=engine)
    db_module.SessionLocal = sessionmaker(bind=engine)
    return db_module.SessionLocal


def _create_queued_job(SessionLocal):
    session = SessionLocal()
    job = Job(
        status="queued",
        current_step="queued",
        source_language="yo",
        target_language="en",
        voice_clone=False,
        input_storage_path="uploads/test.mp4",
    )
    session.add(job)
    session.commit()
    job_id = job.id
    session.close()
    return job_id


def test_run_pipeline_success(tmp_path, sample_video, monkeypatch):
    SessionLocal = _setup_test_db(tmp_path)
    monkeypatch.setattr(
        "app.storage.upload_file",
        lambda path, data, content_type="application/octet-stream": path,
    )
    job_id = _create_queued_job(SessionLocal)

    worker.run_pipeline(job_id, sample_video)

    session = SessionLocal()
    result = session.get(Job, job_id)
    assert result.status == "done"
    assert result.current_step == "done"
    assert result.output_video_path == f"jobs/{job_id}/output.mp4"
    assert result.output_srt_path == f"jobs/{job_id}/subtitles.srt"
    session.close()


def test_run_pipeline_failure_marks_job_failed(tmp_path, sample_video, monkeypatch):
    SessionLocal = _setup_test_db(tmp_path)
    monkeypatch.setattr(
        "app.storage.upload_file",
        lambda path, data, content_type="application/octet-stream": path,
    )

    def _boom(*args, **kwargs):
        raise RuntimeError("ffmpeg exploded")

    monkeypatch.setattr("app.worker.extract_audio", _boom)
    job_id = _create_queued_job(SessionLocal)

    worker.run_pipeline(job_id, sample_video)

    session = SessionLocal()
    result = session.get(Job, job_id)
    assert result.status == "failed"
    assert "ffmpeg exploded" in result.error_message
    session.close()
