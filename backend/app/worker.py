import os
import tempfile
from app import db as db_module
from app import storage
from app.models import Job
from app.config import settings
from app.pipeline.extract_audio import extract_audio
from app.pipeline.merge import merge_audio_video
from app.pipeline.transcribe import transcribe
from app.pipeline.translate import translate
from app.pipeline.dub import dub
from app.pipeline.subtitles import generate_srt


def run_pipeline(job_id: int, local_video_path: str) -> None:
    session = db_module.SessionLocal()
    try:
        job = session.get(Job, job_id)
        if job is None:
            return

        try:
            with tempfile.TemporaryDirectory() as workdir:
                job.status = "processing"
                job.current_step = "extracting_audio"
                session.commit()
                audio_path = extract_audio(local_video_path, os.path.join(workdir, "audio.wav"))

                job.current_step = "transcribing"
                session.commit()
                segments = transcribe(audio_path, job.source_language, settings.mock_mode)

                job.current_step = "translating"
                session.commit()
                translated_segments = translate(segments, job.target_language, settings.mock_mode)

                job.current_step = "dubbing"
                session.commit()
                dubbed_audio_path = dub(
                    translated_segments,
                    audio_path,
                    os.path.join(workdir, "dubbed_audio.wav"),
                    voice_id="default",
                    mock_mode=settings.mock_mode,
                )

                job.current_step = "merging"
                session.commit()
                output_video_path = merge_audio_video(
                    local_video_path, dubbed_audio_path, os.path.join(workdir, "output.mp4")
                )

                job.current_step = "generating_subtitles"
                session.commit()
                srt_content = generate_srt(translated_segments)

                with open(output_video_path, "rb") as f:
                    video_storage_path = storage.upload_file(
                        f"jobs/{job_id}/output.mp4", f.read(), "video/mp4"
                    )
                srt_storage_path = storage.upload_file(
                    f"jobs/{job_id}/subtitles.srt", srt_content.encode("utf-8"), "text/plain"
                )

                job.output_video_path = video_storage_path
                job.output_srt_path = srt_storage_path
                job.status = "done"
                job.current_step = "done"
                session.commit()
        except Exception as exc:
            job.status = "failed"
            job.error_message = str(exc)
            session.commit()
    finally:
        session.close()
        if os.path.exists(local_video_path):
            os.remove(local_video_path)
