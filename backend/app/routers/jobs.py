import json
import os
import shutil
import subprocess
import tempfile
from fastapi import APIRouter, UploadFile, Form, File, HTTPException, BackgroundTasks, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.db import get_db
from app.models import Job, Subscription
from app.security import get_current_user_id
from app import storage, worker

router = APIRouter(prefix="/jobs", tags=["jobs"])

MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024  # 2GB, per readme.md
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "video/x-msvideo"}


def _get_duration_seconds(path: str) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
        check=True,
        capture_output=True,
        text=True,
    )
    data = json.loads(result.stdout)
    return float(data["format"]["duration"])


class JobOut(BaseModel):
    id: int
    status: str
    current_step: str
    source_language: str
    target_language: str
    voice_clone: bool
    output_video_url: str | None = None
    output_srt_url: str | None = None
    error_message: str | None = None


def _job_to_out(job: Job) -> JobOut:
    return JobOut(
        id=job.id,
        status=job.status,
        current_step=job.current_step,
        source_language=job.source_language,
        target_language=job.target_language,
        voice_clone=job.voice_clone,
        output_video_url=storage.get_signed_url(job.output_video_path) if job.output_video_path else None,
        output_srt_url=storage.get_signed_url(job.output_srt_path) if job.output_srt_path else None,
        error_message=job.error_message,
    )


@router.post("", response_model=JobOut, status_code=201)
def create_job(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    source_language: str = Form(...),
    target_language: str = Form(...),
    voice_clone: bool = Form(False),
    db: Session = Depends(get_db),
    user_id: str = Depends(get_current_user_id),
):
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported file type. Please upload MP4, MOV, or AVI.")

    subscription = db.query(Subscription).filter(Subscription.user_id == user_id).first()
    videos_used = subscription.videos_used_this_month if subscription else 0
    max_videos = subscription.max_videos_per_month if subscription else 1
    max_video_minutes = subscription.max_video_minutes if subscription else 3
    if videos_used >= max_videos:
        raise HTTPException(status_code=402, detail="Monthly video limit reached. Please upgrade your plan.")

    suffix = os.path.splitext(file.filename or "")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp)
        local_video_path = tmp.name

    if os.path.getsize(local_video_path) > MAX_UPLOAD_BYTES:
        os.remove(local_video_path)
        raise HTTPException(status_code=413, detail="Video exceeds the 2GB upload limit.")

    duration_seconds = _get_duration_seconds(local_video_path)
    if duration_seconds > max_video_minutes * 60:
        os.remove(local_video_path)
        raise HTTPException(
            status_code=402,
            detail=f"Video exceeds the {max_video_minutes}-minute limit for your plan. Please upgrade or trim your video.",
        )

    with open(local_video_path, "rb") as f:
        input_storage_path = storage.upload_file(
            f"uploads/{os.path.basename(local_video_path)}",
            f.read(),
            file.content_type or "video/mp4",
        )

    job = Job(
        user_id=user_id,
        status="queued",
        current_step="queued",
        source_language=source_language,
        target_language=target_language,
        voice_clone=voice_clone,
        input_storage_path=input_storage_path,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    background_tasks.add_task(worker.run_pipeline, job.id, local_video_path)

    return _job_to_out(job)


@router.get("/{job_id}", response_model=JobOut)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_out(job)
